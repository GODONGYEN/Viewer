import { TVDevice, TVProtocol } from "./tvTypes";

export type TVConnectorKind = "chromecast" | "airplay" | "dlna" | "miracast" | "diagnostic";

export type TVConnectionAction =
  | "connect"
  | "cast-test-media"
  | "start-screen-cast-experiment"
  | "play-dlna-media"
  | "airplay-start"
  | "miracast-start";

export type TVConnectionStatus =
  | "created"
  | "analyzing"
  | "connector-selected"
  | "connecting"
  | "receiver-starting"
  | "media-server-starting"
  | "media-url-created"
  | "media-loading"
  | "playing"
  | "user-action-required"
  | "stopping"
  | "stopped"
  | "failed"
  | "unsupported";

export type TVConnectionEvent = {
  connectionId: string;
  deviceId: string;
  connector: TVConnectorKind;
  status: TVConnectionStatus;
  message: string;
  step: string;
  timestamp: number;
  details?: Record<string, string | number | boolean | undefined>;
};

export type TVConnectionOptions = {
  action?: TVConnectionAction;
  testMediaUrl?: string;
  mediaFilePath?: string;
  contentType?: string;
  streamType?: "BUFFERED" | "LIVE";
  screenStreamStrategy?: "auto" | "webm" | "hls";
  screenStreamOptions?: ScreenStreamOptions;
  screenStreamSources?: ScreenStreamSource[];
};

export type ScreenStreamOptions = {
  strategy: "auto" | "webm" | "hls";
  resolution: "720p" | "1080p";
  fps: 15 | 30;
  bitrateMbps: 2 | 4 | 6;
};

export type ScreenStreamSession = {
  ok: boolean;
  id?: string;
  url?: string;
  contentType?: string;
  strategy?: "webm" | "hls";
  message?: string;
};

export type ScreenStreamSource = {
  id: string;
  url: string;
  contentType: string;
  strategy: "webm" | "hls";
};

export type TVConnectionStartRequest = {
  device: TVDevice;
  options?: TVConnectionOptions;
};

export type TVConnectionStartResponse = {
  ok: boolean;
  connectionId?: string;
  message?: string;
};

export type DLNAMediaSelection = {
  ok: boolean;
  fileName?: string;
  filePath?: string;
  mediaType?: "video" | "audio" | "image";
  message?: string;
};

export type TVConnectorAttempt = {
  connector: TVConnectorKind;
  protocol: TVProtocol;
  canAttempt: boolean;
  reason?: string;
};
