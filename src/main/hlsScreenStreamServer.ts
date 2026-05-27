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
import { getScreenStreamTuning, parseFfmpegSpeed, shouldWarnForSlowEncoding, ScreenStreamTuning } from "../shared/screenStreamTuning";

const MAX_CHUNK_BYTES = 4 * 1024 * 1024;

type HlsSession = {
  id: string;
  directory: string;
  process: ChildProcessWithoutNullStreams;
  startedAt: number;
  lastError?: string;
  latestSpeed?: number;
  slowSince?: number;
  firstPlaylistAt?: number;
  firstSegmentAt?: number;
  firstPlaylistRequestAt?: number;
  firstSegmentRequestAt?: number;
  tuning: ScreenStreamTuning;
  latestGeneratedSegment?: number;
  latestRequestedSegment?: number;
  segment404Count: number;
  stdinBackpressureCount: number;
  lastPlaylistWindow?: string;
  lastRewrittenWindow?: string;
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
  segmentNumber?: number;
};

type PlaylistInfo = {
  originalWindow?: string;
  rewrittenWindow?: string;
  latestSegment?: number;
  mediaSequence?: number;
  segmentNumbers: number[];
  text: string;
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

function noCacheHeaders(contentType: string) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "Access-Control-Allow-Origin": "*",
    "Accept-Ranges": "none"
  };
}

export function extractSegmentNumber(file: string) {
  const match = file.match(/segment-(\d+)\.(?:ts|m4s)$/);
  return match ? Number(match[1]) : null;
}

export function parsePlaylistWindow(playlist: string) {
  const mediaSequenceMatch = playlist.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
  const mediaSequence = mediaSequenceMatch ? Number(mediaSequenceMatch[1]) : 0;
  const segmentNumbers = [...playlist.matchAll(/segment-(\d+)\.(?:ts|m4s)/g)].map((match) => Number(match[1]));
  return {
    mediaSequence,
    segmentNumbers,
    originalWindow: segmentNumbers.length ? `${segmentNumbers[0]}-${segmentNumbers[segmentNumbers.length - 1]}` : undefined,
    latestSegment: segmentNumbers.at(-1)
  };
}

export function rewritePlaylistToLatestSegments(playlist: string, count: number): PlaylistInfo {
  const lines = playlist.split(/\r?\n/).filter((line) => line.trim() !== "#EXT-X-ENDLIST");
  const groups: string[][] = [];
  const header: string[] = [];
  let pending: string[] = [];

  for (const line of lines) {
    if (line.startsWith("#EXTINF") || line.startsWith("#EXT-X-PROGRAM-DATE-TIME")) {
      pending.push(line);
      continue;
    }
    if (/segment-\d+\.(?:ts|m4s)/.test(line)) {
      groups.push([...pending, line]);
      pending = [];
      continue;
    }
    if (!line.startsWith("#EXT-X-MEDIA-SEQUENCE")) {
      header.push(line);
    }
  }

  const selected = groups.slice(-count);
  const segmentNumbers = selected
    .flat()
    .map(extractSegmentNumber)
    .filter((value): value is number => typeof value === "number");
  const first = segmentNumbers[0] ?? 0;
  const original = parsePlaylistWindow(playlist);
  const text = [...header, `#EXT-X-MEDIA-SEQUENCE:${first}`, ...selected.flat(), ""].join("\n");
  return {
    originalWindow: original.originalWindow,
    rewrittenWindow: segmentNumbers.length ? `${segmentNumbers[0]}-${segmentNumbers[segmentNumbers.length - 1]}` : undefined,
    latestSegment: segmentNumbers.at(-1),
    mediaSequence: first,
    segmentNumbers,
    text
  };
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
      const segmentNumber = extractSegmentNumber(requestedFile) ?? undefined;
      if (segmentNumber !== undefined) session.segment404Count += 1;
      pushRequestLog(session.id, { method: request.method ?? "GET", path: requestUrl.pathname, status: 404, file: requestedFile, segmentNumber, userAgent: request.headers["user-agent"]?.slice(0, 120), message: "file not ready" });
      emitHlsEvent(session.id, "stream-http-404", "HLS 파일이 아직 준비되지 않았습니다.", { method: request.method ?? "GET", path: requestUrl.pathname, status: 404, file: requestedFile, segmentNumber, segment404Count: session.segment404Count });
      response.writeHead(404, { "Access-Control-Allow-Origin": "*" });
      response.end("HLS segment not ready");
      return;
    }

    const contentType = requestedFile.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : requestedFile.endsWith(".m4s") ? "video/iso.segment" : "video/mp2t";
    if (requestedFile.endsWith(".m3u8")) {
      session.firstPlaylistRequestAt ??= Date.now();
    } else if (requestedFile.endsWith(".ts") || requestedFile.endsWith(".m4s")) {
      session.firstSegmentRequestAt ??= Date.now();
      session.latestRequestedSegment = extractSegmentNumber(requestedFile) ?? session.latestRequestedSegment;
    }
    const segmentNumber = extractSegmentNumber(requestedFile) ?? undefined;
    pushRequestLog(session.id, { method: request.method ?? "GET", path: requestUrl.pathname, status: 200, file: requestedFile, segmentNumber, userAgent: request.headers["user-agent"]?.slice(0, 120), message: requestedFile.endsWith(".m3u8") ? "playlist requested" : "segment requested" });
    emitHlsEvent(session.id, requestedFile.endsWith(".m3u8") ? "chromecast-requested-playlist" : "chromecast-requested-segment", "Chromecast 또는 클라이언트가 HLS 파일을 요청했습니다.", {
      method: request.method ?? "GET",
      path: requestUrl.pathname,
      status: 200,
      file: requestedFile,
      segmentNumber,
      latestGeneratedSegment: session.latestGeneratedSegment,
      segmentLag: typeof session.latestGeneratedSegment === "number" && typeof session.latestRequestedSegment === "number" ? session.latestGeneratedSegment - session.latestRequestedSegment : undefined,
      userAgent: request.headers["user-agent"]?.slice(0, 120)
    });

    if (requestedFile.endsWith(".m3u8")) {
      const original = fs.readFileSync(filePath, "utf8");
      const playlist = session.tuning.rewritePlaylist ? rewritePlaylistToLatestSegments(original, session.tuning.hlsListSize) : { ...parsePlaylistWindow(original), text: original };
      session.lastPlaylistWindow = playlist.originalWindow;
      session.lastRewrittenWindow = playlist.rewrittenWindow ?? playlist.originalWindow;
      session.latestGeneratedSegment = playlist.latestSegment ?? session.latestGeneratedSegment;
      emitHlsEvent(session.id, "playlist-window", "HLS playlist window를 기록했습니다.", {
        originalWindow: playlist.originalWindow,
        rewrittenWindow: playlist.rewrittenWindow,
        latestSegment: playlist.latestSegment,
        mediaSequence: playlist.mediaSequence,
        rewritePlaylist: session.tuning.rewritePlaylist
      });
      response.writeHead(200, noCacheHeaders(contentType));
      response.end(request.method === "HEAD" ? undefined : playlist.text);
      return;
    }

    const stat = fs.statSync(filePath);
    const range = request.headers.range;
    if (range) {
      const matchRange = range.match(/bytes=(\d+)-(\d*)/);
      const start = matchRange ? Number(matchRange[1]) : 0;
      const end = matchRange?.[2] ? Number(matchRange[2]) : stat.size - 1;
      response.writeHead(206, {
        "Content-Type": contentType,
        "Content-Length": Math.max(0, end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "Accept-Ranges": "bytes"
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      fs.createReadStream(filePath, { start, end }).pipe(response);
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Accept-Ranges": "bytes"
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
  const tuning = getScreenStreamTuning(options);
  const child = spawn(ffmpegPath, buildHlsFfmpegArgs(options, playlistPath, segmentPattern));

  const session: HlsSession = { id, directory, process: child, startedAt: Date.now(), tuning, requestLog: [], segment404Count: 0, stdinBackpressureCount: 0 };
  sessions.set(id, session);
  child.stderr.on("data", (chunk) => {
    const output = chunk.toString("utf8").trim();
    session.lastError = output.slice(0, 500);
    for (const line of output.split(/\r?\n/)) {
      const speed = parseFfmpegSpeed(line);
      if (speed === null) continue;
      session.latestSpeed = speed;
      if (speed < 0.9) {
        session.slowSince ??= Date.now();
        if (shouldWarnForSlowEncoding(speed, (Date.now() - session.slowSince) / 1000)) {
          emitHlsEvent(id, "hls-encoding-slow", "ffmpeg 인코딩 속도가 실시간보다 느립니다. Low CPU 모드를 권장합니다.", { speed });
        }
      } else {
        session.slowSince = undefined;
      }
    }
  });
  child.once("exit", () => {
    emitHlsEvent(id, "hls-ffmpeg-exit", "ffmpeg HLS process가 종료되었습니다.", { lastError: session.lastError });
    sessions.delete(id);
  });

  return {
    id,
    strategy: "hls" as const,
    contentType: "application/vnd.apple.mpegurl",
    url: `http://${getBestLocalIp(targetIp)}:${port}/hls/${id}/index.m3u8?session=${id}&start=${Date.now()}`,
    tuning
  };
}

export function buildHlsFfmpegArgs(options: ScreenStreamOptions, playlistPath: string, segmentPattern: string) {
  const tuning = getScreenStreamTuning(options);
  const scale = `scale=-2:${tuning.targetHeight}`;
  const fps = String(tuning.fps);
  const bitrate = `${tuning.bitrateMbps}M`;
  const flags = ["delete_segments", "omit_endlist", "independent_segments"];
  if (tuning.preset !== "low-cpu") flags.push("split_by_time");
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostats",
    "-progress",
    "pipe:2",
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
    tuning.ffmpegPreset,
    "-tune",
    "zerolatency",
    "-profile:v",
    "baseline",
    "-level",
    "3.1",
    "-pix_fmt",
    "yuv420p",
    "-r",
    fps,
    "-g",
    String(tuning.gop),
    "-keyint_min",
    String(tuning.keyintMin),
    "-sc_threshold",
    "0",
    "-b:v",
    bitrate,
    "-maxrate",
    bitrate,
    "-bufsize",
    `${Math.max(1, tuning.bitrateMbps)}M`,
    "-f",
    "hls",
    "-hls_time",
    String(tuning.hlsTimeSeconds),
    "-hls_list_size",
    String(tuning.hlsListSize),
    "-hls_flags",
    flags.join("+"),
    "-hls_delete_threshold",
    tuning.preset === "experimental-ull-hls" ? "1" : "2",
    "-start_number",
    "0",
    "-hls_segment_filename",
    segmentPattern,
    playlistPath
  ];
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

  const ok = session.process.stdin.write(chunk);
  if (!ok) {
    session.stdinBackpressureCount += 1;
    emitHlsEvent(streamId, "hls-stdin-backpressure", "ffmpeg stdin backpressure가 발생했습니다.", { stdinBackpressureCount: session.stdinBackpressureCount });
  }
  return { ok: true, backpressure: !ok };
}

export function getHlsReadyState(streamId: string) {
  const session = sessions.get(streamId);
  if (!session) return { exists: false, playlistReady: false, segmentReady: false };
  const files = fs.existsSync(session.directory) ? fs.readdirSync(session.directory) : [];
  const firstPlaylist = files.includes("index.m3u8") ? fs.statSync(path.join(session.directory, "index.m3u8")).mtimeMs : undefined;
  const segmentFiles = files.filter((file) => file.endsWith(".ts") || file.endsWith(".m4s"));
  const segmentNumbers = segmentFiles.map(extractSegmentNumber).filter((value): value is number => typeof value === "number");
  session.latestGeneratedSegment = segmentNumbers.length ? Math.max(...segmentNumbers) : session.latestGeneratedSegment;
  const firstSegment = segmentFiles.length ? Math.min(...segmentFiles.map((file) => fs.statSync(path.join(session.directory, file)).mtimeMs)) : undefined;
  if (firstPlaylist) session.firstPlaylistAt ??= firstPlaylist;
  if (firstSegment) session.firstSegmentAt ??= firstSegment;
  return {
    exists: true,
    playlistReady: files.includes("index.m3u8"),
    segmentReady: segmentFiles.length > 0,
    segmentCount: segmentFiles.length,
    lastError: session.lastError,
    ffmpegSpeed: session.latestSpeed,
    slowEncodingWarning: shouldWarnForSlowEncoding(session.latestSpeed, session.slowSince ? (Date.now() - session.slowSince) / 1000 : 0),
    firstPlaylistAt: session.firstPlaylistAt,
    firstSegmentAt: session.firstSegmentAt,
    firstPlaylistRequestAt: session.firstPlaylistRequestAt,
    firstSegmentRequestAt: session.firstSegmentRequestAt,
    estimatedLatencySeconds: session.firstSegmentRequestAt && session.startedAt ? Math.round(((session.firstSegmentRequestAt - session.startedAt) / 1000) * 10) / 10 : undefined
    ,
    latestGeneratedSegment: session.latestGeneratedSegment,
    latestRequestedSegment: session.latestRequestedSegment,
    segmentLag: typeof session.latestGeneratedSegment === "number" && typeof session.latestRequestedSegment === "number" ? session.latestGeneratedSegment - session.latestRequestedSegment : undefined,
    segment404Count: session.segment404Count,
    stdinBackpressureCount: session.stdinBackpressureCount,
    playlistWindow: session.lastPlaylistWindow,
    rewrittenWindow: session.lastRewrittenWindow
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
      ffmpegSpeed: readyState.ffmpegSpeed,
      slowEncodingWarning: readyState.slowEncodingWarning,
      estimatedLatencySeconds: readyState.estimatedLatencySeconds,
      latestGeneratedSegment: readyState.latestGeneratedSegment,
      latestRequestedSegment: readyState.latestRequestedSegment,
      segmentLag: readyState.segmentLag,
      segment404Count: readyState.segment404Count,
      stdinBackpressureCount: readyState.stdinBackpressureCount,
      playlistWindow: readyState.playlistWindow,
      rewrittenWindow: readyState.rewrittenWindow,
      firstPlaylistAt: readyState.firstPlaylistAt,
      firstSegmentAt: readyState.firstSegmentAt,
      firstPlaylistRequestAt: readyState.firstPlaylistRequestAt,
      firstSegmentRequestAt: readyState.firstSegmentRequestAt,
      recentRequests: session?.requestLog ?? orphanRequestLog.filter((entry) => entry.path.includes(id)).slice(0, 20)
    };
  });
}

export async function waitForHlsReady(streamId: string, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = getHlsReadyState(streamId);
    const session = sessions.get(streamId);
    const targetSegments = session?.tuning.hlsStartBufferSegments ?? 2;
    if (state.playlistReady && state.segmentReady && (state.segmentCount ?? 0) >= targetSegments) {
      emitHlsEvent(streamId, "hls-ready", "HLS initial segments가 준비되었습니다.", { segmentCount: state.segmentCount, targetSegments, latestGeneratedSegment: state.latestGeneratedSegment });
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
