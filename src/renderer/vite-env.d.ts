/// <reference types="vite/client" />

declare global {
  type LanAddressInfo = {
    name: string;
    address: string;
    family: "IPv4";
    internal: boolean;
    netmask: string;
    broadcast: string;
    likelyVirtual: boolean;
  };

  type LanNetworkInfo = {
    hostName: string;
    discoveryPort: number;
    addresses: LanAddressInfo[];
  };

  type LanDiscoveryHost = {
    type: "SCREEN_SHARE_HOST";
    version: 1;
    hostId: string;
    hostName: string;
    wsUrl: string;
    ipAddress: string;
    pinRequired: boolean;
    expiresAt: number;
    remoteAddress: string;
    lastSeenAt: number;
  };

  type LanDiscoveryEvent = {
    type: string;
    message: string;
    hostId?: string;
    hostName?: string;
    wsUrl?: string;
  };

  type SignalingStatus = {
    status: "starting" | "running" | "error" | "stopped";
    port?: number;
    urls?: string[];
    message?: string;
  };

  type TVProtocol = "AirPlay" | "Chromecast" | "DLNA" | "Miracast possible" | "Unknown";
  type DiscoveryMethod = "mDNS" | "SSDP" | "manual" | "unknown";
  type TVCapability = "screen-mirroring-guide" | "browser-cast-guide" | "media-playback-experimental" | "wireless-display-guide" | "device-info";
  type TVActionAvailability = "available" | "guide-only" | "experimental" | "unsupported";
  type TVAction = {
    id:
      | "airplay-guide"
      | "airplay-start"
      | "open-display-settings"
      | "open-screen-recording-settings"
      | "copy-device-info"
      | "chromecast-guide"
      | "chromecast-connect"
      | "chromecast-test-media"
      | "chromecast-screen-experiment"
      | "cast-stop"
      | "media-cast-placeholder"
      | "dlna-media-experiment"
      | "dlna-info"
      | "miracast-windows-guide"
      | "miracast-start"
      | "airplay-on-macos-guide"
      | "manual-guide";
    label: string;
    availability: TVActionAvailability;
    description: string;
    protocol?: TVProtocol;
    disabled?: boolean;
  };
  type TVDevice = {
    id: string;
    name: string;
    ipAddress: string;
    discoveryMethod: DiscoveryMethod;
    discoveryMethods?: DiscoveryMethod[];
    protocol: TVProtocol;
    protocols?: TVProtocol[];
    capabilities?: TVCapability[];
    connectable: "guide-only" | "media-only" | "unknown";
    recommendedAction: string;
    actions?: TVAction[];
    possibleActions?: string[];
    unavailableActions?: string[];
    securityNotes?: string[];
    details?: string;
    serviceType?: string;
    serviceTypes?: string[];
    location?: string;
    raw?: Record<string, string | undefined>;
    lastSeenAt: number;
  };
  type TVDiscoveryStatus = {
    status: "idle" | "searching" | "error" | "stopped";
    message?: string;
    startedAt?: number;
  };
  type TVConnectorKind = "chromecast" | "airplay" | "dlna" | "miracast" | "diagnostic";
  type TVConnectionAction =
    | "connect"
    | "cast-test-media"
    | "start-screen-cast-experiment"
    | "play-dlna-media"
    | "airplay-start"
    | "miracast-start";
  type TVConnectionStatus =
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
  type TVConnectionEvent = {
    connectionId: string;
    deviceId: string;
    connector: TVConnectorKind;
    status: TVConnectionStatus;
    message: string;
    step: string;
    timestamp: number;
    details?: Record<string, string | number | boolean | undefined>;
  };
  type TVConnectionOptions = {
    action?: TVConnectionAction;
    testMediaUrl?: string;
    mediaFilePath?: string;
    contentType?: string;
    streamType?: "BUFFERED" | "LIVE";
    screenStreamStrategy?: "auto" | "webm" | "hls";
    screenStreamOptions?: ScreenStreamOptions;
    screenStreamSources?: ScreenStreamSource[];
  };
  type ScreenStreamOptions = {
    strategy: "auto" | "webm" | "hls";
    preset: "balanced" | "low-latency" | "low-cpu";
    resolution: "540p" | "720p" | "1080p";
    fps: 10 | 15 | 30;
    bitrateMbps: 1 | 2 | 4 | 6;
  };
  type ScreenStreamSession = {
    ok: boolean;
    id?: string;
    url?: string;
    contentType?: string;
    strategy?: "webm" | "hls";
    message?: string;
  };
  type ScreenStreamSource = {
    id: string;
    url: string;
    contentType: string;
    strategy: "webm" | "hls";
  };
  type ScreenStreamRequestLog = {
    timestamp: number;
    method: string;
    path: string;
    status: number;
    userAgent?: string;
    message?: string;
    file?: string;
  };
  type ScreenStreamDiagnostics = {
    ok: boolean;
    webm: Array<{
      id: string;
      strategy: "webm";
      exists: boolean;
      contentType?: string;
      startedAt?: number;
      initChunkReady: boolean;
      queuedChunks: number;
      totalBytes: number;
      clients: number;
      recentRequests: ScreenStreamRequestLog[];
    }>;
    hls: Array<{
      id: string;
      strategy: "hls";
      exists: boolean;
      startedAt?: number;
      playlistReady: boolean;
      segmentReady: boolean;
      segmentCount: number;
      lastError?: string;
      ffmpegSpeed?: number;
      slowEncodingWarning?: boolean;
      estimatedLatencySeconds?: number;
      firstPlaylistAt?: number;
      firstSegmentAt?: number;
      firstPlaylistRequestAt?: number;
      firstSegmentRequestAt?: number;
      recentRequests: ScreenStreamRequestLog[];
    }>;
  };
  type DLNAMediaSelection = {
    ok: boolean;
    fileName?: string;
    filePath?: string;
    mediaType?: "video" | "audio" | "image";
    message?: string;
  };
  type ScreenCaptureSourceInfo = {
    id: string;
    name: string;
    thumbnailDataUrl?: string;
    displayId?: string;
  };
  type ScreenCaptureEnvironmentInfo = {
    platform: NodeJS.Platform;
    isElectron: boolean;
    electronVersion?: string;
    chromeVersion?: string;
  };

  interface Window {
    lanViewer?: {
      platform: NodeJS.Platform;
      getSignalingStatus: () => Promise<SignalingStatus>;
      onSignalingStatus: (callback: (status: SignalingStatus) => void) => () => void;
      openViewerWindow: () => Promise<{ ok: true }>;
    };
    lanDiscovery?: {
      getLocalNetworkInfo: () => Promise<LanNetworkInfo>;
      startHostBroadcast: (payload: {
        type: "SCREEN_SHARE_HOST";
        version: 1;
        hostId: string;
        hostName: string;
        wsUrl: string;
        ipAddress: string;
        pinRequired: boolean;
        expiresAt: number;
      }) => Promise<{ ok: true }>;
      stopHostBroadcast: () => Promise<{ ok: true }>;
      startViewerDiscovery: () => Promise<{ ok: true }>;
      stopViewerDiscovery: () => Promise<{ ok: true }>;
      onHostFound: (callback: (host: LanDiscoveryHost) => void) => () => void;
      onEvent: (callback: (event: LanDiscoveryEvent) => void) => () => void;
    };
    tvDiscovery?: {
      startTvDiscovery: () => Promise<{ ok: true }>;
      stopTvDiscovery: () => Promise<{ ok: true }>;
      getTvDiscoveryStatus: () => Promise<TVDiscoveryStatus>;
      openMacDisplaySettings: () => Promise<{ ok: boolean; message?: string }>;
      openMacScreenRecordingSettings: () => Promise<{ ok: boolean; message?: string }>;
      onTvDeviceFound: (callback: (device: TVDevice) => void) => () => void;
      onTvDiscoveryStatus: (callback: (status: TVDiscoveryStatus) => void) => () => void;
    };
    tvConnection?: {
      connectToTv: (payload: { device: TVDevice; options?: TVConnectionOptions }) => Promise<{ ok: boolean; connectionId?: string; message?: string }>;
      stopConnection: (connectionId: string) => Promise<{ ok: boolean; message?: string }>;
      selectDlnaMedia: () => Promise<DLNAMediaSelection>;
      startScreenStream: (payload: { targetIp?: string; deviceId?: string; contentType: string; strategy: "webm" | "hls"; options: ScreenStreamOptions }) => Promise<ScreenStreamSession>;
      pushScreenStreamChunk: (payload: { streamId: string; chunk: ArrayBuffer }) => Promise<{ ok: boolean; message?: string }>;
      stopScreenStream: (streamId: string) => Promise<{ ok: boolean; message?: string }>;
      getScreenStreamDiagnostics: (payload: { streamIds?: string[] }) => Promise<ScreenStreamDiagnostics>;
      stopAllConnections: () => Promise<{ ok: boolean }>;
      onConnectionEvent: (callback: (event: TVConnectionEvent) => void) => () => void;
    };
    screenCapture?: {
      getSources: () => Promise<ScreenCaptureSourceInfo[]>;
      openScreenRecordingSettings: () => Promise<{ ok: boolean; message?: string }>;
      getEnvironmentInfo: () => Promise<ScreenCaptureEnvironmentInfo>;
    };
  }
}

export {};
