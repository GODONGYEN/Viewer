export type TVDiscoveryMethod = "mDNS" | "SSDP" | "manual" | "unknown";
export type DiscoveryMethod = TVDiscoveryMethod;

export type TVProtocol = "AirPlay" | "Chromecast" | "DLNA" | "Miracast possible" | "Unknown";

export type TVCapability =
  | "screen-mirroring-guide"
  | "browser-cast-guide"
  | "media-playback-experimental"
  | "wireless-display-guide"
  | "device-info";

export type TVActionAvailability = "available" | "guide-only" | "experimental" | "unsupported";

export type TVAction = {
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

export type TVConnectionGuide = {
  title: string;
  steps: string[];
  possibleActions: string[];
  unavailableActions: string[];
  securityNotes: string[];
};

export type TVDevice = {
  id: string;
  name: string;
  ipAddress: string;
  discoveryMethod: TVDiscoveryMethod;
  discoveryMethods?: TVDiscoveryMethod[];
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

export type TVDiscoveryStatus = {
  status: "idle" | "searching" | "error" | "stopped";
  message?: string;
  startedAt?: number;
};
