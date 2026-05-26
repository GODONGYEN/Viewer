import http from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { getBestLocalIp } from "./mediaServer";

const MAX_REPLAY_CHUNKS = 8;
const MAX_CHUNK_BYTES = 4 * 1024 * 1024;

type StreamSession = {
  id: string;
  contentType: string;
  clients: Set<http.ServerResponse>;
  initChunk: Buffer | null;
  chunks: Buffer[];
  totalBytes: number;
  startedAt: number;
};

let server: http.Server | null = null;
let port = 0;
const sessions = new Map<string, StreamSession>();
const readyWaiters = new Map<string, Array<() => void>>();
let eventSink: ((event: { streamId: string; type: string; message: string; details?: Record<string, string | number | boolean | undefined> }) => void) | null = null;

export function setScreenStreamEventSink(sink: typeof eventSink) {
  eventSink = sink;
}

function emitStreamEvent(streamId: string, type: string, message: string, details?: Record<string, string | number | boolean | undefined>) {
  eventSink?.({ streamId, type, message, details });
}

async function ensureScreenStreamServer() {
  if (server?.listening) return port;

  server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    if (requestUrl.pathname === "/health") {
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
      response.end(JSON.stringify({ ok: true, service: "screen-stream" }));
      return;
    }

    const match = requestUrl.pathname.match(/^\/screen-stream\/([^/]+)(?:\/live\.webm)?$/);
    if (!match) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    const session = sessions.get(match[1]);
    if (!session) {
      emitStreamEvent(match[1], "stream-http-404", "WebM stream session을 찾지 못했습니다.", { method: request.method ?? "GET", path: requestUrl.pathname, status: 404 });
      response.writeHead(404);
      response.end("Screen stream not found");
      return;
    }

    emitStreamEvent(session.id, "webm-client-connected", "Chromecast 또는 클라이언트가 WebM stream URL을 요청했습니다.", {
      method: request.method ?? "GET",
      path: requestUrl.pathname,
      status: 200,
      userAgent: request.headers["user-agent"]?.slice(0, 120)
    });

    if (request.method === "HEAD") {
      response.writeHead(200, {
        "Content-Type": session.contentType,
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*"
      });
      response.end();
      return;
    }

    response.writeHead(200, {
      "Content-Type": session.contentType,
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      Connection: "keep-alive"
    });

    if (session.initChunk) {
      response.write(session.initChunk);
    } else {
      emitStreamEvent(session.id, "webm-no-init-chunk", "WebM init chunk가 아직 없어 클라이언트가 대기합니다.");
    }

    for (const chunk of session.chunks) {
      response.write(chunk);
    }

    session.clients.add(response);
    request.on("close", () => {
      session.clients.delete(response);
      emitStreamEvent(session.id, "webm-client-disconnected", "WebM stream 클라이언트 연결이 종료되었습니다.", { clients: session.clients.size });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server?.once("error", reject);
    server?.listen(0, "0.0.0.0", () => {
      const address = server?.address();
      port = typeof address === "object" && address ? address.port : 0;
      resolve();
    });
  });

  return port;
}

export async function startScreenStream(targetIp: string | undefined, contentType: string) {
  await ensureScreenStreamServer();
  const id = randomUUID();
  sessions.set(id, { id, contentType, clients: new Set(), initChunk: null, chunks: [], totalBytes: 0, startedAt: Date.now() });
  return {
    id,
    contentType,
    strategy: "webm" as const,
    url: `http://${getBestLocalIp(targetIp)}:${port}/screen-stream/${id}/live.webm`
  };
}

export function hasScreenStream(streamId: string) {
  return sessions.has(streamId);
}

export function pushScreenStreamChunk(streamId: string, chunk: Buffer) {
  if (chunk.byteLength > MAX_CHUNK_BYTES) {
    throw new Error("화면 스트림 chunk가 너무 큽니다.");
  }

  const session = sessions.get(streamId);
  if (!session) {
    throw new Error("활성 WebM 화면 스트림을 찾을 수 없습니다.");
  }

  if (!session.initChunk) {
    session.initChunk = chunk;
    emitStreamEvent(streamId, "webm-init-chunk-saved", "WebM init/header chunk를 저장했습니다.", { bytes: chunk.byteLength });
    for (const waiter of readyWaiters.get(streamId) ?? []) waiter();
    readyWaiters.delete(streamId);
  } else {
    session.chunks.push(chunk);
  }
  session.totalBytes += chunk.byteLength;
  while (session.chunks.length > MAX_REPLAY_CHUNKS) {
    const removed = session.chunks.shift();
    session.totalBytes -= removed?.byteLength ?? 0;
  }

  for (const client of session.clients) {
    client.write(chunk);
  }

  emitStreamEvent(streamId, "webm-chunk-sent", "WebM chunk를 stream clients에 전송했습니다.", { clients: session.clients.size, queuedChunks: session.chunks.length });
  return { clients: session.clients.size, queuedChunks: session.chunks.length, totalBytes: session.totalBytes };
}

export async function waitForWebMReady(streamId: string, timeoutMs = 5000) {
  const session = sessions.get(streamId);
  if (session?.initChunk) return { ready: true };

  await new Promise<void>((resolve, reject) => {
    let done: () => void;
    const timer = setTimeout(() => {
      const waiters = readyWaiters.get(streamId) ?? [];
      readyWaiters.set(
        streamId,
        waiters.filter((waiter) => waiter !== done)
      );
      reject(new Error("WebM init chunk 대기 시간이 초과되었습니다."));
    }, timeoutMs);
    done = () => {
      clearTimeout(timer);
      resolve();
    };
    readyWaiters.set(streamId, [...(readyWaiters.get(streamId) ?? []), done]);
  });

  return { ready: true };
}

export function stopScreenStream(streamId: string) {
  const session = sessions.get(streamId);
  if (!session) return;

  for (const client of session.clients) {
    client.end();
  }

  sessions.delete(streamId);
}

export async function stopAllScreenStreams() {
  for (const streamId of sessions.keys()) {
    stopScreenStream(streamId);
  }

  if (!server) return;
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = null;
  port = 0;
}

export function chooseScreenStreamMimeType(supported: (mimeType: string) => boolean) {
  const candidates = ["video/webm;codecs=vp8", "video/webm;codecs=vp9", "video/webm"];
  return candidates.find(supported) ?? "";
}

export function getScreenStreamLimits() {
  return { maxReplayChunks: MAX_REPLAY_CHUNKS, maxChunkBytes: MAX_CHUNK_BYTES };
}
