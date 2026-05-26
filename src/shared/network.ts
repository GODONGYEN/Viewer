export function normalizeIpAddress(address?: string) {
  if (!address) return "";
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

export function isPrivateIpv4(address: string) {
  if (address === "127.0.0.1") return true;
  if (address.startsWith("10.")) return true;
  if (address.startsWith("192.168.")) return true;

  const match172 = address.match(/^172\.(\d+)\./);
  if (!match172) return false;

  const second = Number(match172[1]);
  return second >= 16 && second <= 31;
}

export function isPrivateOrLoopback(address?: string) {
  const value = normalizeIpAddress(address);

  if (value === "127.0.0.1" || value === "::1" || value === "localhost") return true;
  if (isPrivateIpv4(value)) return true;
  if (value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd")) return true;
  return false;
}

export function ipv4ToInt(address: string) {
  return address.split(".").reduce((value, octet) => ((value << 8) + Number(octet)) >>> 0, 0);
}

export function intToIpv4(value: number) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
}

export function getDirectedBroadcast(address: string, netmask: string) {
  const ip = ipv4ToInt(address);
  const mask = ipv4ToInt(netmask);
  return intToIpv4((ip | (~mask >>> 0)) >>> 0);
}

export function isLikelyVirtualInterface(name: string) {
  return /^(bridge|docker|vbox|vmnet|utun|tap|tun|llw|awdl|zt|tailscale|wg|gif|stf)/i.test(name);
}

export function interfacePriority(name: string) {
  if (/^en\d+/i.test(name)) return 10;
  if (/^eth\d+/i.test(name)) return 20;
  if (/^wl/i.test(name)) return 30;
  if (isLikelyVirtualInterface(name)) return 90;
  return 50;
}
