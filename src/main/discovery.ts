import { BrowserWindow, ipcMain } from "electron";
import dgram from "node:dgram";
import os from "node:os";
import { DISCOVERY_PORT, DiscoveryPayload, DiscoveryPayloadSchema, HostFoundPayload } from "../shared/schemas";
import { getDirectedBroadcast, interfacePriority, isLikelyVirtualInterface, isPrivateIpv4, normalizeIpAddress } from "../shared/network";
import { LanNetworkInfo } from "../shared/types";

const BROADCAST_INTERVAL_MS = 1500;

let hostSocket: dgram.Socket | null = null;
let hostTimer: NodeJS.Timeout | null = null;
let viewerSocket: dgram.Socket | null = null;
let currentWindow: BrowserWindow | null = null;
let ipcHandlersRegistered = false;

export function getLocalNetworkInfo(): LanNetworkInfo {
  const addresses: LanNetworkInfo["addresses"] = [];

  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal || !isPrivateIpv4(entry.address)) continue;
      addresses.push({
        name,
        address: entry.address,
        family: "IPv4",
        internal: entry.internal,
        netmask: entry.netmask,
        broadcast: getDirectedBroadcast(entry.address, entry.netmask),
        likelyVirtual: isLikelyVirtualInterface(name)
      });
    }
  }

  return {
    hostName: os.hostname(),
    discoveryPort: DISCOVERY_PORT,
    addresses: addresses.sort((a, b) => interfacePriority(a.name) - interfacePriority(b.name))
  };
}

function isValidDiscoveryPayload(value: unknown): value is DiscoveryPayload {
  return DiscoveryPayloadSchema.safeParse(value).success;
}

function parseDiscoveryMessage(raw: Buffer) {
  try {
    return JSON.parse(raw.toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

function stopHostBroadcast() {
  if (hostTimer) {
    clearInterval(hostTimer);
    hostTimer = null;
  }

  if (hostSocket) {
    hostSocket.close();
    hostSocket = null;
  }

  currentWindow?.webContents.send("lan-discovery:event", { type: "host-broadcast-stopped", message: "Discovery stopped" });
}

function startHostBroadcast(payload: DiscoveryPayload) {
  if (!isValidDiscoveryPayload(payload)) {
    throw new Error("Discovery broadcast payload is invalid.");
  }

  stopHostBroadcast();

  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const network = getLocalNetworkInfo();
  const targets = Array.from(new Set(["255.255.255.255", ...network.addresses.map((entry) => entry.broadcast)]));
  const message = Buffer.from(JSON.stringify(payload), "utf8");

  socket.bind(() => {
    socket.setBroadcast(true);
    currentWindow?.webContents.send("lan-discovery:event", {
      type: "host-broadcast-started",
      message: "UDP discovery broadcast started",
      wsUrl: payload.wsUrl
    });

    const send = () => {
      for (const target of targets) {
        socket.send(message, DISCOVERY_PORT, target);
      }
    };

    send();
    hostTimer = setInterval(send, BROADCAST_INTERVAL_MS);
  });

  hostSocket = socket;
}

function stopViewerDiscovery() {
  if (viewerSocket) {
    viewerSocket.close();
    viewerSocket = null;
    currentWindow?.webContents.send("lan-discovery:event", { type: "viewer-discovery-stopped", message: "Discovery stopped" });
  }
}

function startViewerDiscovery(window: BrowserWindow) {
  stopViewerDiscovery();

  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

  socket.on("message", (raw, remote) => {
    const remoteAddress = normalizeIpAddress(remote.address);
    if (!isPrivateIpv4(remoteAddress) && remoteAddress !== "127.0.0.1") return;

    const parsed = parseDiscoveryMessage(raw);
    if (!isValidDiscoveryPayload(parsed)) {
      window.webContents.send("lan-discovery:event", { type: "invalid-packet", message: "Invalid discovery packet ignored" });
      return;
    }

    const payload: HostFoundPayload = {
      ...parsed,
      remoteAddress,
      lastSeenAt: Date.now()
    };

    window.webContents.send("lan-discovery:event", {
      type: "host-broadcast-received",
      message: "Host broadcast received",
      hostId: payload.hostId,
      hostName: payload.hostName
    });
    window.webContents.send("lan-discovery:host-found", payload);
  });

  socket.on("error", (error) => {
    window.webContents.send("lan-discovery:event", { type: "viewer-discovery-error", message: error.message });
  });

  socket.bind(DISCOVERY_PORT, "0.0.0.0", () => {
    window.webContents.send("lan-discovery:event", { type: "viewer-discovery-started", message: "UDP discovery listening started" });
  });
  viewerSocket = socket;
}

export function setupDiscoveryIpc(window: BrowserWindow) {
  currentWindow = window;
  if (!ipcHandlersRegistered) {
    ipcHandlersRegistered = true;
    ipcMain.handle("lan-discovery:get-local-network-info", () => getLocalNetworkInfo());
    ipcMain.handle("lan-discovery:start-host-broadcast", (event, payload: DiscoveryPayload) => {
      currentWindow = BrowserWindow.fromWebContents(event.sender) ?? currentWindow;
      startHostBroadcast(payload);
      return { ok: true };
    });
    ipcMain.handle("lan-discovery:stop-host-broadcast", (event) => {
      currentWindow = BrowserWindow.fromWebContents(event.sender) ?? currentWindow;
      stopHostBroadcast();
      return { ok: true };
    });
    ipcMain.handle("lan-discovery:start-viewer-discovery", (event) => {
      const owner = BrowserWindow.fromWebContents(event.sender) ?? window;
      startViewerDiscovery(owner);
      return { ok: true };
    });
    ipcMain.handle("lan-discovery:stop-viewer-discovery", () => {
      stopViewerDiscovery();
      return { ok: true };
    });
  }

  window.on("closed", () => {
    if (currentWindow === window) {
      currentWindow = null;
    }
  });
}

export function stopDiscovery() {
  stopHostBroadcast();
  stopViewerDiscovery();
}
