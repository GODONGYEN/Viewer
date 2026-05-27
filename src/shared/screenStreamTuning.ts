export type ScreenStreamPreset = "experimental-ull-hls" | "balanced" | "low-latency" | "low-cpu";
export type ScreenStreamResolution = "540p" | "720p" | "1080p";
export type ScreenStreamFps = 10 | 15 | 30;
export type ScreenStreamBitrateMbps = 1 | 2 | 4 | 6;

export type ScreenStreamTuning = {
  preset: ScreenStreamPreset;
  resolution: ScreenStreamResolution;
  fps: ScreenStreamFps;
  bitrateMbps: ScreenStreamBitrateMbps;
  hlsTimeSeconds: number;
  hlsListSize: number;
  gop: number;
  keyintMin: number;
  ffmpegPreset: "ultrafast" | "superfast" | "veryfast";
  recorderTimesliceMs: number;
  targetHeight: number;
  latencyTargetSeconds: number;
  hlsStartBufferSegments: 1 | 2 | 3;
  rewritePlaylist: boolean;
};

const PRESETS: Record<ScreenStreamPreset, ScreenStreamTuning> = {
  "experimental-ull-hls": {
    preset: "experimental-ull-hls",
    resolution: "720p",
    fps: 15,
    bitrateMbps: 1,
    hlsTimeSeconds: 0.5,
    hlsListSize: 3,
    gop: 15,
    keyintMin: 15,
    ffmpegPreset: "ultrafast",
    recorderTimesliceMs: 250,
    targetHeight: 720,
    latencyTargetSeconds: 3,
    hlsStartBufferSegments: 2,
    rewritePlaylist: true
  },
  balanced: {
    preset: "balanced",
    resolution: "720p",
    fps: 15,
    bitrateMbps: 2,
    hlsTimeSeconds: 1,
    hlsListSize: 3,
    gop: 30,
    keyintMin: 15,
    ffmpegPreset: "superfast",
    recorderTimesliceMs: 500,
    targetHeight: 720,
    latencyTargetSeconds: 6,
    hlsStartBufferSegments: 2,
    rewritePlaylist: true
  },
  "low-latency": {
    preset: "low-latency",
    resolution: "720p",
    fps: 15,
    bitrateMbps: 2,
    hlsTimeSeconds: 1,
    hlsListSize: 2,
    gop: 15,
    keyintMin: 15,
    ffmpegPreset: "ultrafast",
    recorderTimesliceMs: 500,
    targetHeight: 720,
    latencyTargetSeconds: 4,
    hlsStartBufferSegments: 2,
    rewritePlaylist: true
  },
  "low-cpu": {
    preset: "low-cpu",
    resolution: "540p",
    fps: 10,
    bitrateMbps: 1,
    hlsTimeSeconds: 1,
    hlsListSize: 3,
    gop: 10,
    keyintMin: 10,
    ffmpegPreset: "ultrafast",
    recorderTimesliceMs: 1000,
    targetHeight: 540,
    latencyTargetSeconds: 8,
    hlsStartBufferSegments: 3,
    rewritePlaylist: false
  }
};

export function getScreenStreamTuning(options: {
  preset?: ScreenStreamPreset;
  resolution?: ScreenStreamResolution;
  fps?: ScreenStreamFps;
  bitrateMbps?: ScreenStreamBitrateMbps;
  hlsStartBufferSegments?: 1 | 2 | 3;
  rewritePlaylist?: boolean;
}) {
  const base = PRESETS[options.preset ?? "low-latency"];
  const resolution = options.resolution ?? base.resolution;
  const fps = options.fps ?? base.fps;
  const bitrateMbps = options.bitrateMbps ?? base.bitrateMbps;
  const hlsStartBufferSegments = options.hlsStartBufferSegments ?? base.hlsStartBufferSegments;
  const rewritePlaylist = options.rewritePlaylist ?? base.rewritePlaylist;
  return {
    ...base,
    resolution,
    fps,
    bitrateMbps,
    hlsStartBufferSegments,
    rewritePlaylist,
    targetHeight: resolution === "1080p" ? 1080 : resolution === "720p" ? 720 : 540
  } satisfies ScreenStreamTuning;
}

export function getRecorderTimesliceMs(options: { preset?: ScreenStreamPreset }) {
  return getScreenStreamTuning(options).recorderTimesliceMs;
}

export function parseFfmpegSpeed(line: string) {
  const match = line.match(/speed=\s*([0-9.]+)x/);
  return match ? Number(match[1]) : null;
}

export function shouldWarnForSlowEncoding(speed: number | null | undefined, secondsSlow: number) {
  return typeof speed === "number" && Number.isFinite(speed) && speed < 0.9 && secondsSlow >= 5;
}

export function shouldFallbackHlsPreset(params: { preset: ScreenStreamPreset; segment404Count: number; segmentLag?: number; speed?: number | null }) {
  if (params.preset === "low-cpu") return null;
  if (params.segment404Count >= 3) return params.preset === "experimental-ull-hls" ? "low-latency" : "balanced";
  if (typeof params.segmentLag === "number" && params.segmentLag > 8) return params.preset === "experimental-ull-hls" ? "low-latency" : "balanced";
  if (typeof params.speed === "number" && params.speed < 0.8) return "low-cpu";
  return null;
}
