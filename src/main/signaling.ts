import cors from "cors";
import express from "express";
import http from "node:http";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import type { RawData } from "ws";
import {
  DisconnectPeerMessageSchema,
  HostDecisionMessageSchema,
  HostRegisterMessageSchema,
  PinSchema,
  SIGNALING_PORT,
  SignalMessageSchema,
  ViewerRequestMessageSchema
} from "../shared/schemas";
import { isPrivateOrLoopback, normalizeIpAddress } from "../shared/network";

type Role = "host" | "viewer";

type ClientMeta = {
  id: string;
  role?: Role;
  pin?: string;
  pinExpiresAt?: number;
  requestId?: string;
};

type PeerRequest = {
  requestId: string;
  pin: string;
  host: WebSocket;
  viewer: WebSocket;
  viewerName: string;
  accepted: boolean;
};

type SignalingServerEvent =
  | { type: "started"; port: number; urls: string[] }
  | { type: "error"; message: string }
  | { type: "stopped" };

type StartOptions = {
  preferredPort?: number;
  onEvent?: (event: SignalingServerEvent) => void;
};

export type RunningSignalingServer = {
  port: number;
  urls: string[];
  close: () => Promise<void>;
};

function localUrls(port: number) {
  const urls = ["http://localhost:" + port];

  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        urls.push(`http://${entry.address}:${port}`);
      }
    }
  }

  return urls;
}

function send(socket: WebSocket, message: unknown) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function parseMessage(raw: RawData) {
  try {
    const parsed = JSON.parse(raw.toString()) as unknown;
    if (!parsed || typeof parsed !== "object" || typeof (parsed as { type?: unknown }).type !== "string") {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function startSignalingServer(options: StartOptions = {}): Promise<RunningSignalingServer> {
  const preferredPort = options.preferredPort ?? SIGNALING_PORT;

  for (let port = preferredPort; port < preferredPort + 10; port += 1) {
    try {
      return await createSignalingServer(port, options.onEvent);
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? (error as { code?: string }).code : "";
      if (code !== "EADDRINUSE") {
        throw error;
      }
    }
  }

  throw new Error(`No available signaling port found near ${preferredPort}.`);
}

function createSignalingServer(port: number, onEvent?: (event: SignalingServerEvent) => void) {
  return new Promise<RunningSignalingServer>((resolve, reject) => {
    const clients = new Map<WebSocket, ClientMeta>();
    const hostsByPin = new Map<string, WebSocket>();
    const requestsById = new Map<string, PeerRequest>();
    const app = express();
    const server = http.createServer(app);
    const wss = new WebSocketServer({ noServer: true });

    function cleanup(socket: WebSocket) {
      const meta = clients.get(socket);
      clients.delete(socket);

      if (meta?.role === "host" && meta.pin && hostsByPin.get(meta.pin) === socket) {
        hostsByPin.delete(meta.pin);
      }

      for (const [requestId, request] of requestsById) {
        if (request.host === socket || request.viewer === socket) {
          requestsById.delete(requestId);
          if (request.host !== socket) send(request.host, { type: "viewer-left", requestId });
          if (request.viewer !== socket) send(request.viewer, { type: "host-left", requestId });
        }
      }
    }

    function handleHostRegister(socket: WebSocket, pin: unknown, hostName: unknown, pinExpiresAt: unknown) {
      const parsedPin = PinSchema.safeParse(pin);
      if (!parsedPin.success) {
        send(socket, { type: "error", message: "PIN은 6자리 숫자여야 합니다." });
        return;
      }

      const safePin = parsedPin.data;
      const expiresAt = typeof pinExpiresAt === "number" && Number.isFinite(pinExpiresAt) ? pinExpiresAt : Date.now() + 10 * 60 * 1000;
      if (expiresAt <= Date.now()) {
        send(socket, { type: "error", message: "PIN 만료 시간이 이미 지났습니다." });
        return;
      }

      const existing = hostsByPin.get(safePin);
      if (existing && existing !== socket) {
        send(socket, { type: "error", message: "이미 사용 중인 PIN입니다. 새 PIN을 생성하세요." });
        return;
      }

      const meta = clients.get(socket);
      if (!meta) return;

      if (meta.pin && meta.pin !== safePin && hostsByPin.get(meta.pin) === socket) {
        hostsByPin.delete(meta.pin);
      }

      meta.role = "host";
      meta.pin = safePin;
      meta.pinExpiresAt = expiresAt;
      hostsByPin.set(safePin, socket);

      send(socket, {
        type: "host-registered",
        pin: safePin,
        pinExpiresAt: expiresAt,
        hostName: typeof hostName === "string" ? hostName : "Host",
        urls: localUrls(port)
      });
    }

    function handleViewerRequest(socket: WebSocket, pin: unknown, viewerName: unknown) {
      const parsedPin = PinSchema.safeParse(pin);
      if (!parsedPin.success) {
        send(socket, { type: "error", message: "PIN은 6자리 숫자여야 합니다." });
        return;
      }

      const safePin = parsedPin.data;
      const host = hostsByPin.get(safePin);
      if (!host) {
        send(socket, { type: "request-rejected", reason: "invalid-pin", message: "PIN이 올바르지 않습니다." });
        return;
      }

      const hostMeta = clients.get(host);
      if (!hostMeta?.pinExpiresAt || hostMeta.pinExpiresAt <= Date.now()) {
        hostsByPin.delete(safePin);
        send(socket, { type: "request-rejected", reason: "pin-expired", message: "PIN이 만료되었습니다. Host에게 새 PIN을 요청하세요." });
        return;
      }

      const requestId = randomUUID();
      const safeViewerName = typeof viewerName === "string" && viewerName.trim() ? viewerName.trim() : "Viewer";
      const request: PeerRequest = {
        requestId,
        pin: safePin,
        host,
        viewer: socket,
        viewerName: safeViewerName,
        accepted: false
      };

      const meta = clients.get(socket);
      if (!meta) return;

      meta.role = "viewer";
      meta.pin = safePin;
      meta.requestId = requestId;
      requestsById.set(requestId, request);

      send(socket, { type: "request-pending", requestId });
      send(host, { type: "viewer-request", requestId, viewerName: safeViewerName });
    }

    function handleHostDecision(socket: WebSocket, requestId: unknown, accepted: unknown) {
      if (typeof requestId !== "string") return;

      const request = requestsById.get(requestId);
      if (!request || request.host !== socket) return;

      if (accepted !== true) {
        requestsById.delete(requestId);
        send(request.viewer, { type: "request-rejected", requestId, message: "Host가 연결을 거절했습니다." });
        return;
      }

      request.accepted = true;
      send(request.viewer, { type: "request-accepted", requestId });
      send(request.host, { type: "viewer-accepted", requestId });
    }

    function handleSignal(socket: WebSocket, requestId: unknown, data: unknown) {
      if (typeof requestId !== "string") return;

      const request = requestsById.get(requestId);
      if (!request || !request.accepted) {
        send(socket, { type: "error", message: "수락된 연결에서만 WebRTC 시그널을 보낼 수 있습니다." });
        return;
      }

      if (socket === request.host) send(request.viewer, { type: "signal", requestId, data });
      if (socket === request.viewer) send(request.host, { type: "signal", requestId, data });
    }

    function handleDisconnectPeer(socket: WebSocket, requestId: unknown) {
      if (typeof requestId !== "string") return;

      const request = requestsById.get(requestId);
      if (!request || (socket !== request.host && socket !== request.viewer)) return;

      requestsById.delete(requestId);
      send(request.host, { type: "peer-disconnected", requestId });
      send(request.viewer, { type: "peer-disconnected", requestId });
    }

    app.use(cors());
    app.get("/health", (_req, res) => {
      res.json({ ok: true, urls: localUrls(port), activeHosts: hostsByPin.size, port });
    });

    server.on("upgrade", (request, socket, head) => {
      if (!isPrivateOrLoopback(request.socket.remoteAddress)) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    });

    wss.on("connection", (socket, request) => {
      const id = randomUUID();
      clients.set(socket, { id });
      send(socket, { type: "hello", id, urls: localUrls(port), remoteAddress: normalizeIpAddress(request.socket.remoteAddress), port });

      socket.on("message", (raw) => {
        const message = parseMessage(raw);
        if (!message) {
          send(socket, { type: "error", message: "잘못된 메시지입니다." });
          return;
        }

        switch (message.type) {
          case "host-register": {
            const parsed = HostRegisterMessageSchema.safeParse(message);
            if (!parsed.success) {
              send(socket, { type: "error", message: "Host 등록 메시지 형식이 올바르지 않습니다." });
              break;
            }
            handleHostRegister(socket, parsed.data.pin, parsed.data.hostName, parsed.data.pinExpiresAt);
            break;
          }
          case "viewer-request": {
            const parsed = ViewerRequestMessageSchema.safeParse(message);
            if (!parsed.success) {
              send(socket, { type: "error", message: "Viewer 요청 메시지 형식이 올바르지 않습니다." });
              break;
            }
            handleViewerRequest(socket, parsed.data.pin, parsed.data.viewerName);
            break;
          }
          case "host-decision": {
            const parsed = HostDecisionMessageSchema.safeParse(message);
            if (!parsed.success) {
              send(socket, { type: "error", message: "Host 결정 메시지 형식이 올바르지 않습니다." });
              break;
            }
            handleHostDecision(socket, parsed.data.requestId, parsed.data.accepted);
            break;
          }
          case "signal": {
            const parsed = SignalMessageSchema.safeParse(message);
            if (!parsed.success) {
              send(socket, { type: "error", message: "Signal 메시지 형식이 올바르지 않습니다." });
              break;
            }
            handleSignal(socket, parsed.data.requestId, parsed.data.data);
            break;
          }
          case "disconnect-peer": {
            const parsed = DisconnectPeerMessageSchema.safeParse(message);
            if (!parsed.success) {
              send(socket, { type: "error", message: "연결 종료 메시지 형식이 올바르지 않습니다." });
              break;
            }
            handleDisconnectPeer(socket, parsed.data.requestId);
            break;
          }
          default:
            send(socket, { type: "error", message: `지원하지 않는 메시지 타입: ${message.type}` });
        }
      });

      socket.on("close", () => cleanup(socket));
      socket.on("error", () => cleanup(socket));
    });

    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      server.off("error", reject);
      const urls = localUrls(port);
      onEvent?.({ type: "started", port, urls });
      resolve({
        port,
        urls,
        close: () =>
          new Promise<void>((closeResolve) => {
            for (const socket of clients.keys()) {
              socket.close();
            }
            wss.close(() => {
              server.close(() => {
                onEvent?.({ type: "stopped" });
                closeResolve();
              });
            });
          })
      });
    });
  });
}
