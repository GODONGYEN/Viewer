import { BrowserWindow, ipcMain, shell } from "electron";
import Bonjour from "bonjour-service";
import dgram from "node:dgram";
import { URL } from "node:url";
import { isPrivateOrLoopback, normalizeIpAddress } from "../shared/network";
import { enrichTvDevice } from "../shared/tvActions";
import { TVDevice, TVDiscoveryStatus, TVProtocol } from "../shared/tvTypes";

const SSDP_ADDRESS = "239.255.255.250";
const SSDP_PORT = 1900;
const SSDP_INTERVAL_MS = 8000;
const MDNS_SERVICE_TYPES = ["airplay", "googlecast", "raop"];
const SSDP_SEARCH_TARGETS = ["ssdp:all", "urn:schemas-upnp-org:device:MediaRenderer:1", "urn:dial-multiscreen-org:service:dial:1"];

let bonjour: Bonjour | null = null;
let browsers: Array<{ stop: () => void }> = [];
let ssdpSocket: dgram.Socket | null = null;
let ssdpTimer: NodeJS.Timeout | null = null;
let status: TVDiscoveryStatus = { status: "idle" };
let ownerWindow: BrowserWindow | null = null;
let ipcRegistered = false;

function sendDevice(device: TVDevice) {
  ownerWindow?.webContents.send("tv-discovery:device-found", enrichTvDevice(device));
}

function sendStatus(nextStatus: TVDiscoveryStatus) {
  status = nextStatus;
  ownerWindow?.webContents.send("tv-discovery:status", status);
}

function getServiceAddress(service: { addresses?: string[]; referer?: { address?: string } }) {
  const fromAddresses = service.addresses?.find((address) => isPrivateOrLoopback(address));
  return normalizeIpAddress(fromAddresses ?? service.referer?.address ?? "");
}

function classifyMdnsService(type: string): { protocol: TVProtocol; action: string; connectable: TVDevice["connectable"] } {
  if (type === "airplay" || type === "raop") {
    return {
      protocol: "AirPlay",
      connectable: "guide-only",
      action: "Use macOS Screen Mirroring or AirPlay controls and choose this TV manually."
    };
  }

  if (type === "googlecast") {
    return {
      protocol: "Chromecast",
      connectable: "guide-only",
      action: "Use Chrome or OS Cast for screen mirroring. App-level casting can be added later for specific media."
    };
  }

  return {
    protocol: "Unknown",
    connectable: "unknown",
    action: "Review the device details and use the TV vendor's official casting method."
  };
}

function startMdnsDiscovery() {
  bonjour = new Bonjour();

  for (const type of MDNS_SERVICE_TYPES) {
    const browser = bonjour.find({ type }, (service) => {
      const ipAddress = getServiceAddress(service);
      if (!ipAddress) return;

      const classification = classifyMdnsService(type);
      sendDevice({
        id: `mdns:${type}:${service.name}:${ipAddress}`,
        name: service.name || `${classification.protocol} device`,
        ipAddress,
        discoveryMethod: "mDNS",
        protocol: classification.protocol,
        connectable: classification.connectable,
        recommendedAction: classification.action,
        details: service.host,
        serviceType: type,
        raw: {
          host: service.host,
          serviceType: type
        },
        lastSeenAt: Date.now()
      });
    });

    browser.start();
    browsers.push(browser);
  }
}

function parseSsdpHeaders(message: Buffer) {
  const lines = message.toString("utf8").split(/\r?\n/);
  const headers = new Map<string, string>();

  for (const line of lines) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    headers.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim());
  }

  return headers;
}

function extractXmlTag(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, "i"));
  return match?.[1]?.trim();
}

async function fetchSsdpDescription(location: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(location, { signal: controller.signal });
    const text = await response.text();
    return {
      friendlyName: extractXmlTag(text, "friendlyName"),
      manufacturer: extractXmlTag(text, "manufacturer"),
      modelName: extractXmlTag(text, "modelName")
    };
  } catch {
    return {};
  } finally {
    clearTimeout(timeout);
  }
}

function classifySsdp(
  headers: Map<string, string>,
  location: string,
  descriptionText = ""
): { protocol: TVProtocol; action: string; connectable: TVDevice["connectable"] } {
  const haystack =
    `${headers.get("st") ?? ""} ${headers.get("nt") ?? ""} ${headers.get("server") ?? ""} ${headers.get("usn") ?? ""} ${location} ${descriptionText}`.toLowerCase();

  if (haystack.includes("google") || haystack.includes("chromecast") || haystack.includes("googlecast") || haystack.includes("dial-multiscreen")) {
    return {
      protocol: "Chromecast",
      connectable: "guide-only",
      action: "Use Chrome or OS Cast for screen mirroring. Direct desktop casting is not implemented in this Electron app."
    };
  }

  if (haystack.includes("mediarenderer") || haystack.includes("dlna")) {
    return {
      protocol: "DLNA",
      connectable: "media-only",
      action: "DLNA is best for playing media files on the TV, not full screen mirroring."
    };
  }

  if (haystack.includes("miracast") || haystack.includes("wfd")) {
    return {
      protocol: "Miracast possible",
      connectable: "guide-only",
      action: "On Windows, try Wireless Display. On macOS, AirPlay is usually the supported path."
    };
  }

  return {
    protocol: "Unknown",
    connectable: "unknown",
    action: "Detected by UPnP/SSDP. Check the TV's official casting feature."
  };
}

async function handleSsdpMessage(message: Buffer, remote: dgram.RemoteInfo) {
  const headers = parseSsdpHeaders(message);
  const location = headers.get("location") ?? "";
  const remoteAddress = normalizeIpAddress(remote.address);
  let ipAddress = remoteAddress;

  if (location) {
    try {
      const url = new URL(location);
      ipAddress = normalizeIpAddress(url.hostname);
    } catch {
      ipAddress = remoteAddress;
    }
  }

  if (!isPrivateOrLoopback(ipAddress)) return;

  const description = location ? await fetchSsdpDescription(location) : {};
  const descriptionText = [description.friendlyName, description.manufacturer, description.modelName].filter(Boolean).join(" ");
  const classification = classifySsdp(headers, location, descriptionText);
  const name = description.friendlyName ?? headers.get("server") ?? `${classification.protocol} device`;
  const details = [description.manufacturer, description.modelName, headers.get("server")].filter(Boolean).join(" / ");
  const raw = Object.fromEntries(headers.entries());

  sendDevice({
    id: `ssdp:${headers.get("usn") ?? location ?? ipAddress}`,
    name,
    ipAddress,
    discoveryMethod: "SSDP",
    protocol: classification.protocol,
    connectable: classification.connectable,
    recommendedAction: classification.action,
    details,
    location,
    serviceType: headers.get("st") ?? headers.get("nt"),
    raw,
    lastSeenAt: Date.now()
  });
}

function sendSsdpSearch() {
  if (!ssdpSocket) return;

  for (const target of SSDP_SEARCH_TARGETS) {
    const search = [
      "M-SEARCH * HTTP/1.1",
      `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
      'MAN: "ssdp:discover"',
      "MX: 2",
      `ST: ${target}`,
      "",
      ""
    ].join("\r\n");

    ssdpSocket.send(Buffer.from(search), SSDP_PORT, SSDP_ADDRESS);
  }
}

function startSsdpDiscovery() {
  ssdpSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  ssdpSocket.on("message", (message, remote) => {
    void handleSsdpMessage(message, remote);
  });
  ssdpSocket.on("error", (error) => {
    sendStatus({ status: "error", message: error.message });
  });
  ssdpSocket.bind(() => {
    ssdpSocket?.setMulticastTTL(2);
    sendSsdpSearch();
    ssdpTimer = setInterval(sendSsdpSearch, SSDP_INTERVAL_MS);
  });
}

function startTvDiscovery(window: BrowserWindow) {
  stopTvDiscovery();
  ownerWindow = window;
  sendStatus({ status: "searching", startedAt: Date.now(), message: "Searching with mDNS and SSDP." });
  startMdnsDiscovery();
  startSsdpDiscovery();
}

function stopTvDiscovery() {
  for (const browser of browsers) {
    browser.stop();
  }
  browsers = [];

  if (bonjour) {
    bonjour.destroy();
    bonjour = null;
  }

  if (ssdpTimer) {
    clearInterval(ssdpTimer);
    ssdpTimer = null;
  }

  if (ssdpSocket) {
    ssdpSocket.close();
    ssdpSocket = null;
  }

  sendStatus({ status: "stopped", message: "TV discovery stopped." });
}

export function setupTvDiscoveryIpc(window: BrowserWindow) {
  ownerWindow = window;
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle("tv-discovery:start", (event) => {
    const caller = BrowserWindow.fromWebContents(event.sender) ?? window;
    startTvDiscovery(caller);
    return { ok: true };
  });
  ipcMain.handle("tv-discovery:stop", () => {
    stopTvDiscovery();
    return { ok: true };
  });
  ipcMain.handle("tv-discovery:get-status", () => status);
  ipcMain.handle("tv-discovery:open-display-settings", async () => {
    if (process.platform !== "darwin") {
      return { ok: false, message: "macOS display settings are only available on macOS." };
    }
    await shell.openExternal("x-apple.systempreferences:com.apple.Displays-Settings.extension");
    return { ok: true };
  });
  ipcMain.handle("tv-discovery:open-screen-recording-settings", async () => {
    if (process.platform !== "darwin") {
      return { ok: false, message: "macOS Screen Recording settings are only available on macOS." };
    }
    await shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
    return { ok: true };
  });
}

export function stopTvDiscoveryService() {
  stopTvDiscovery();
}
