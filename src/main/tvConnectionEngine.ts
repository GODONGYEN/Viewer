import { BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { TVConnectionStartRequestSchema } from "../shared/tvConnectionSchemas";
import { getTvConnectorPlan } from "../shared/tvConnectionPlan";
import {
  DLNAMediaSelection,
  TVConnectionEvent,
  TVConnectionOptions,
  TVConnectionStartResponse,
  TVConnectorKind
} from "../shared/tvConnectionTypes";
import { TVDevice } from "../shared/tvTypes";
import { getMediaTypeForPath, stopMediaServer } from "./mediaServer";
import { hasScreenStream, pushScreenStreamChunk, setScreenStreamEventSink, startScreenStream, stopAllScreenStreams, stopScreenStream } from "./screenStreamServer";
import { hasHlsScreenStream, pushHlsScreenStreamChunk, setHlsStreamEventSink, startHlsScreenStream, stopAllHlsScreenStreams, stopHlsScreenStream } from "./hlsScreenStreamServer";
import { airplayConnector } from "./connectors/airplayConnector";
import { chromecastConnector } from "./connectors/chromecastConnector";
import { dlnaConnector } from "./connectors/dlnaConnector";
import { miracastConnector } from "./connectors/miracastConnector";
import { TVConnector } from "./connectors/types";

const CONNECTORS: TVConnector[] = [chromecastConnector, airplayConnector, dlnaConnector, miracastConnector];
const MEDIA_EXTENSIONS = ["mp4", "m4v", "mov", "mp3", "jpg", "jpeg", "png"];

let ownerWindow: BrowserWindow | null = null;
let ipcRegistered = false;
const activeConnections = new Map<string, { device: TVDevice; connector?: TVConnectorKind; stopped: boolean }>();

function sendEvent(event: TVConnectionEvent) {
  ownerWindow?.webContents.send("tv-connection:event", event);
}

function emit(connectionId: string, deviceId: string, connector: TVConnectorKind, status: TVConnectionEvent["status"], step: string, message: string, details?: TVConnectionEvent["details"]) {
  sendEvent({ connectionId, deviceId, connector, status, step, message, timestamp: Date.now(), details });
}

export function getConnectorPlan(device: TVDevice, options: TVConnectionOptions = {}) {
  const allowed = getTvConnectorPlan(device, options)
    .filter((attempt) => attempt.canAttempt)
    .map((attempt) => attempt.connector);
  return allowed
    .map((kind) => CONNECTORS.find((connector) => connector.kind === kind))
    .filter((connector): connector is TVConnector => Boolean(connector))
    .filter((connector) => connector.canHandle(device, options));
}

async function runConnection(connectionId: string, device: TVDevice, options: TVConnectionOptions) {
  activeConnections.set(connectionId, { device, stopped: false });
  emit(connectionId, device.id, "diagnostic", "created", "TV selected", "TV가 선택되어 연결 엔진을 시작합니다.");
  emit(connectionId, device.id, "diagnostic", "analyzing", "Protocol analysis", "감지된 프로토콜을 분석하고 connector 우선순위를 정합니다.", {
    protocols: (device.protocols ?? [device.protocol]).join(", ")
  });

  const connectors = getConnectorPlan(device, options);
  if (connectors.length === 0) {
    const attempts = getTvConnectorPlan(device, options);
    emit(connectionId, device.id, "diagnostic", "unsupported", "No connector", "이 TV에 시도할 수 있는 connector가 없습니다.", {
      attemptedProtocols: attempts.map((attempt) => `${attempt.protocol}:${attempt.reason ?? "not available"}`).join(", ")
    });
    return;
  }

  for (const connector of connectors) {
    const active = activeConnections.get(connectionId);
    if (!active || active.stopped) {
      emit(connectionId, device.id, connector.kind, "stopped", "Stopped", "사용자가 연결 시도를 중지했습니다.");
      return;
    }

    activeConnections.set(connectionId, { ...active, connector: connector.kind });
    emit(connectionId, device.id, connector.kind, "connector-selected", "Connector selected", `${connector.kind} connector를 선택했습니다.`);

    try {
      const result = await connector.connect({
        connectionId,
        device,
        options,
        emit: (event) => sendEvent({ ...event, timestamp: Date.now() })
      });

      emit(connectionId, device.id, connector.kind, result.status, result.ok ? "Connection result" : "Connector failed", result.message, result.details);
      if (result.ok || !result.canFallback) return;
    } catch (error) {
      emit(connectionId, device.id, connector.kind, "failed", "Connector exception", error instanceof Error ? error.message : String(error));
    }
  }

  emit(connectionId, device.id, "diagnostic", "failed", "All connectors failed", "사용 가능한 모든 connector 시도가 실패했습니다. 로그를 확인하고 다른 프로토콜이나 네트워크 상태를 점검하세요.");
}

export function startTvConnection(device: TVDevice, options: TVConnectionOptions = {}): TVConnectionStartResponse {
  const connectionId = randomUUID();
  void runConnection(connectionId, device, options);
  return { ok: true, connectionId };
}

export async function stopTvConnection(connectionId: string) {
  const active = activeConnections.get(connectionId);
  if (!active) return { ok: false, message: "활성 TV 연결을 찾을 수 없습니다." };

  activeConnections.set(connectionId, { ...active, stopped: true });
  const connector = CONNECTORS.find((entry) => entry.kind === active.connector);
  if (connector?.stop) {
    await connector.stop(connectionId);
  }

  emit(connectionId, active.device.id, active.connector ?? "diagnostic", "stopped", "Stop", "TV 연결 시도를 중지했습니다.");
  activeConnections.delete(connectionId);
  return { ok: true };
}

async function selectDlnaMediaFile(): Promise<DLNAMediaSelection> {
  const result = await dialog.showOpenDialog({
    title: "DLNA로 재생할 미디어 파일 선택",
    properties: ["openFile"],
    filters: [{ name: "Supported media", extensions: MEDIA_EXTENSIONS }]
  });

  if (result.canceled || !result.filePaths[0]) {
    return { ok: false, message: "파일 선택이 취소되었습니다." };
  }

  const filePath = result.filePaths[0];
  const mediaType = getMediaTypeForPath(filePath);
  if (!mediaType) {
    return { ok: false, message: "지원하지 않는 파일 형식입니다." };
  }

  return {
    ok: true,
    fileName: path.basename(filePath),
    filePath,
    mediaType
  };
}

export function setupTvConnectionIpc(window: BrowserWindow) {
  ownerWindow = window;
  if (ipcRegistered) return;
  ipcRegistered = true;

  const forwardStreamEvent = (event: { streamId: string; type: string; message: string; details?: Record<string, string | number | boolean | undefined> }) => {
    sendEvent({
      connectionId: event.streamId,
      deviceId: String(event.details?.deviceId ?? "screen-stream"),
      connector: "chromecast",
      status: event.type.includes("404") ? "failed" : "media-loading",
      step: event.type,
      message: event.message,
      timestamp: Date.now(),
      details: event.details
    });
  };
  setScreenStreamEventSink(forwardStreamEvent);
  setHlsStreamEventSink(forwardStreamEvent);

  ipcMain.handle("tv-connection:connect", (_event, payload) => {
    const parsed = TVConnectionStartRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return { ok: false, message: "잘못된 TV 연결 요청입니다." };
    }
    return startTvConnection(parsed.data.device, parsed.data.options);
  });

  ipcMain.handle("tv-connection:stop", (_event, connectionId: string) => stopTvConnection(connectionId));
  ipcMain.handle("tv-connection:select-dlna-media", () => selectDlnaMediaFile());
  ipcMain.handle(
    "tv-connection:screen-stream-start",
    async (_event, payload: { targetIp?: string; deviceId?: string; contentType?: string; strategy?: "webm" | "hls"; options?: { strategy: "auto" | "webm" | "hls"; resolution: "720p" | "1080p"; fps: 15 | 30; bitrateMbps: 2 | 4 | 6 } }) => {
    if (!payload?.contentType?.startsWith("video/webm")) {
      return { ok: false, message: "현재 화면 스트림 실험은 video/webm MediaRecorder 출력만 지원합니다." };
    }
      const strategy = payload.strategy ?? "webm";
      const options = payload.options ?? { strategy: "auto", resolution: "720p", fps: 15, bitrateMbps: 4 };
      const session = strategy === "hls" ? await startHlsScreenStream(payload.targetIp, options) : await startScreenStream(payload.targetIp, payload.contentType);
      sendEvent({
        connectionId: session.id,
        deviceId: payload.deviceId ?? "screen-stream",
        connector: "chromecast",
        status: "media-server-starting",
        step: strategy === "hls" ? "HLS server started" : "WebM server started",
        message: `${strategy === "hls" ? "HLS" : "WebM"} 화면 스트림 세션을 시작했습니다.`,
        timestamp: Date.now(),
        details: { url: session.url, strategy, deviceId: payload.deviceId }
      });
      return { ok: true, ...session };
    }
  );
  ipcMain.handle("tv-connection:screen-stream-push", (_event, payload: { streamId?: string; chunk?: ArrayBuffer }) => {
    if (!payload?.streamId || !payload.chunk) return { ok: false, message: "잘못된 화면 스트림 chunk입니다." };
    const chunk = Buffer.from(payload.chunk);
    const stats = hasScreenStream(payload.streamId)
      ? pushScreenStreamChunk(payload.streamId, chunk)
      : hasHlsScreenStream(payload.streamId)
        ? pushHlsScreenStreamChunk(payload.streamId, chunk)
        : undefined;
    if (!stats) return { ok: false, message: "활성 화면 스트림 세션을 찾지 못했습니다." };
    return { ok: true, clients: "clients" in stats ? stats.clients : 0 };
  });
  ipcMain.handle("tv-connection:screen-stream-stop", (_event, streamId: string) => {
    stopScreenStream(streamId);
    stopHlsScreenStream(streamId);
    return { ok: true };
  });
  ipcMain.handle("tv-connection:stop-all", async () => {
    for (const connectionId of activeConnections.keys()) {
      await stopTvConnection(connectionId);
    }
    await stopMediaServer();
    await stopAllScreenStreams();
    await stopAllHlsScreenStreams();
    return { ok: true };
  });
}

export async function stopTvConnectionService() {
  for (const connectionId of activeConnections.keys()) {
    await stopTvConnection(connectionId);
  }
  await stopMediaServer();
  await stopAllScreenStreams();
  await stopAllHlsScreenStreams();
}
