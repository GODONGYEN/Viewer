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
  }
}

export {};
