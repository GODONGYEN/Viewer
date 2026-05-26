export type LanAddressInfo = {
  name: string;
  address: string;
  family: "IPv4";
  internal: boolean;
  netmask: string;
  broadcast: string;
  likelyVirtual: boolean;
};

export type LanNetworkInfo = {
  hostName: string;
  discoveryPort: number;
  addresses: LanAddressInfo[];
};

export type LanDiscoveryEvent = {
  type: string;
  message: string;
  hostId?: string;
  hostName?: string;
  wsUrl?: string;
};
