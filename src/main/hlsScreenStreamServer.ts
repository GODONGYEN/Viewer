import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import ffmpegPath from "ffmpeg-static";
import { getBestLocalIp } from "./mediaServer";
import { ScreenStreamOptions } from "../shared/tvConnectionTypes";

const MAX_CHUNK_BYTES = 4 * 1024 * 1024;

type HlsSession = {
  id: string;
  directory: string;
  process: ChildProcessWithoutNullStreams;
  startedAt: number;
  lastError?: string;
  requestLog: StreamHttpRequestLog[];
};

export type StreamHttpRequestLog = {
  timestamp: number;
  method: string;
  path: string;
  status: number;
  userAgent?: string;
  message?: string;
  file?: string;
};

let server: http.Server | null = null;
let port = 0;
const sessions = new Map<string, HlsSession>();
const orphanRequestLog: StreamHttpRequestLog[] = [];
let eventSink: ((event: { streamId: string; type: string; message: string; details?: Record<string, string | number | boolean | undefined> }) => void) | null = null;

export function setHlsStreamEventSink(sink: typeof eventSink) {
  eventSink = sink;
}

function emitHlsEvent(streamId: string, type: string, message: string, details?: Record<string, string | number | boolean | undefined>) {
  eventSink?.({ streamId, type, message, details });
}

function pushRequestLog(streamId: string, log: Omit<StreamHttpRequestLog, "timestamp">) {
  const entry = { ...log, timestamp: Date.now() };
  const session = sessions.get(streamId);
  const target = session?.requestLog ?? orphanRequestLog;
  target.unshift(entry);
  target.splice(20);
  return entry;
}

async function ensureHlsServer() {
  if (server?.listening) return port;

  server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    if (requestUrl.pathname === "/health") {
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
      response.end(JSON.stringify({ ok: true, service: "hls-screen-stream" }));
      return;
    }

    const match = requestUrl.pathname.match(/^\/hls\/([^/]+)\/(.+)$/);
    if (!match) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    const session = sessions.get(match[1]);
    if (!session) {
      pushRequestLog(match[1], { method: request.method ?? "GET", path: requestUrl.pathname, status: 404, userAgent: request.headers["user-agent"]?.slice(0, 120), message: "session not found" });
      emitHlsEvent(match[1], "stream-http-404", "HLS session을 찾지 못했습니다.", { method: request.method ?? "GET", path: requestUrl.pathname, status: 404 });
      response.writeHead(404);
      response.end("HLS session not found");
      return;
    }

    const requestedFile = path.basename(match[2]);
    const filePath = path.join(session.directory, requestedFile);
    if (!fs.existsSync(filePath)) {
      pushRequestLog(session.id, { method: request.method ?? "GET", path: requestUrl.pathname, status: 404, file: requestedFile, userAgent: request.headers["user-agent"]?.slice(0, 120), message: "file not ready" });
      emitHlsEvent(session.id, "stream-http-404", "HLS 파일이 아직 준비되지 않았습니다.", { method: request.method ?? "GET", path: requestUrl.pathname, status: 404, file: requestedFile });
      response.writeHead(404, { "Access-Control-Allow-Origin": "*" });
      response.end("HLS segment not ready");
      return;
    }

    const contentType = requestedFile.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : requestedFile.endsWith(".m4s") ? "video/iso.segment" : "video/mp2t";
    pushRequestLog(session.id, { method: request.method ?? "GET", path: requestUrl.pathname, status: 200, file: requestedFile, userAgent: request.headers["user-agent"]?.slice(0, 120), message: requestedFile.endsWith(".m3u8") ? "playlist requested" : "segment requested" });
    emitHlsEvent(session.id, requestedFile.endsWith(".m3u8") ? "chromecast-requested-playlist" : "chromecast-requested-segment", "Chromecast 또는 클라이언트가 HLS 파일을 요청했습니다.", {
      method: request.method ?? "GET",
      path: requestUrl.pathname,
      status: 200,
      file: requestedFile,
      userAgent: request.headers["user-agent"]?.slice(0, 120)
    });

    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    fs.createReadStream(filePath).pipe(response);
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

export async function startHlsScreenStream(targetIp: string | undefined, options: ScreenStreamOptions) {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static 경로를 찾지 못했습니다.");
  }

  await ensureHlsServer();
  const id = randomUUID();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `viewer-hls-${id}-`));
  const playlistPath = path.join(directory, "index.m3u8");
  const segmentPattern = path.join(directory, "segment-%05d.ts");
  const scale = options.resolution === "1080p" ? "scale=-2:1080" : "scale=-2:720";
  const fps = String(options.fps);
  const bitrate = `${options.bitrateMbps}M`;

  const child = spawn(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-fflags",
    "+genpts",
    "-i",
    "pipe:0",
    "-an",
    "-vf",
    `${scale},fps=${fps}`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-tune",
    "zerolatency",
    "-profile:v",
    "baseline",
    "-pix_fmt",
    "yuv420p",
    "-b:v",
    bitrate,
    "-maxrate",
    bitrate,
    "-bufsize",
    `${options.bitrateMbps * 2}M`,
    "-f",
    "hls",
    "-hls_time",
    "2",
    "-hls_list_size",
    "5",
    "-hls_flags",
    "delete_segments+append_list+omit_endlist+independent_segments",
    "-hls_segment_filename",
    segmentPattern,
    playlistPath
  ]);

  const session: HlsSession = { id, directory, process: child, startedAt: Date.now(), requestLog: [] };
  sessions.set(id, session);
  child.stderr.on("data", (chunk) => {
    session.lastError = chunk.toString("utf8").trim().slice(0, 500);
  });
  child.once("exit", () => {
    emitHlsEvent(id, "hls-ffmpeg-exit", "ffmpeg HLS process가 종료되었습니다.", { lastError: session.lastError });
    sessions.delete(id);
  });

  return {
    id,
    strategy: "hls" as const,
    contentType: "application/vnd.apple.mpegurl",
    url: `http://${getBestLocalIp(targetIp)}:${port}/hls/${id}/index.m3u8`
  };
}

export function hasHlsScreenStream(streamId: string) {
  return sessions.has(streamId);
}

export function pushHlsScreenStreamChunk(streamId: string, chunk: Buffer) {
  if (chunk.byteLength > MAX_CHUNK_BYTES) {
    throw new Error("HLS 입력 chunk가 너무 큽니다.");
  }

  const session = sessions.get(streamId);
  if (!session) {
    throw new Error("활성 HLS 화면 스트림을 찾을 수 없습니다.");
  }

  session.process.stdin.write(chunk);
  return { ok: true };
}

export function getHlsReadyState(streamId: string) {
  const session = sessions.get(streamId);
  if (!session) return { exists: false, playlistReady: false, segmentReady: false };
  const files = fs.existsSync(session.directory) ? fs.readdirSync(session.directory) : [];
  return {
    exists: true,
    playlistReady: files.includes("index.m3u8"),
    segmentReady: files.some((file) => file.endsWith(".ts") || file.endsWith(".m4s")),
    segmentCount: files.filter((file) => file.endsWith(".ts") || file.endsWith(".m4s")).length,
    lastError: session.lastError
  };
}

export function getHlsScreenStreamDiagnostics(streamIds?: string[]) {
  const ids = streamIds?.length ? streamIds : [...sessions.keys()];
  return ids.map((id) => {
    const session = sessions.get(id);
    const readyState = getHlsReadyState(id);
    return {
      id,
      strategy: "hls" as const,
      exists: Boolean(session),
      startedAt: session?.startedAt,
      playlistReady: readyState.playlistReady,
      segmentReady: readyState.segmentReady,
      segmentCount: readyState.segmentCount ?? 0,
      lastError: readyState.lastError,
      recentRequests: session?.requestLog ?? orphanRequestLog.filter((entry) => entry.path.includes(id)).slice(0, 20)
    };
  });
}

export async function waitForHlsReady(streamId: string, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = getHlsReadyState(streamId);
    if (state.playlistReady && state.segmentReady) {
      emitHlsEvent(streamId, "hls-ready", "HLS playlist와 첫 segment가 준비되었습니다.", { segmentCount: state.segmentCount });
      return state;
    }
    if (!state.exists) {
      throw new Error("HLS session이 종료되었습니다.");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const state = getHlsReadyState(streamId);
  throw new Error(`HLS 준비 시간이 초과되었습니다. playlist=${state.playlistReady} segment=${state.segmentReady} ${state.lastError ?? ""}`);
}

export async function verifyLocalStreamUrl(url: string) {
  const response = await fetch(url, { method: "HEAD" });
  if (!response.ok) {
    throw new Error(`stream URL health check 실패: HTTP ${response.status}`);
  }
  return true;
}

export function stopHlsScreenStream(streamId: string) {
  const session = sessions.get(streamId);
  if (!session) return;

  session.process.stdin.end();
  session.process.kill("SIGTERM");
  sessions.delete(streamId);
  fs.rmSync(session.directory, { recursive: true, force: true });
}

export async function stopAllHlsScreenStreams() {
  for (const streamId of sessions.keys()) {
    stopHlsScreenStream(streamId);
  }

  if (!server) return;
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = null;
  port = 0;
}
