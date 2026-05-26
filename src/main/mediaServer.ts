import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { URL } from "node:url";
import { randomUUID } from "node:crypto";
import { interfacePriority, ipv4ToInt, isPrivateIpv4 } from "../shared/network";

type ServedFile = {
  filePath: string;
  fileName: string;
  contentType: string;
};

let server: http.Server | null = null;
let port = 0;
const files = new Map<string, ServedFile>();

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png"
};

function isSameSubnet(address: string, targetIp: string, netmask: string) {
  return (ipv4ToInt(address) & ipv4ToInt(netmask)) === (ipv4ToInt(targetIp) & ipv4ToInt(netmask));
}

export function getMediaTypeForPath(filePath: string): "video" | "audio" | "image" | null {
  const extension = path.extname(filePath).toLowerCase();
  if ([".mp4", ".m4v", ".mov"].includes(extension)) return "video";
  if (extension === ".mp3") return "audio";
  if ([".jpg", ".jpeg", ".png"].includes(extension)) return "image";
  return null;
}

export function getContentTypeForPath(filePath: string) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export function getBestLocalIp(targetIp?: string) {
  const candidates = Object.entries(os.networkInterfaces())
    .flatMap(([name, entries]) =>
      (entries ?? [])
        .filter((entry) => entry.family === "IPv4" && !entry.internal && isPrivateIpv4(entry.address))
        .map((entry) => ({ name, address: entry.address, netmask: entry.netmask }))
    )
    .sort((a, b) => interfacePriority(a.name) - interfacePriority(b.name));

  if (targetIp) {
    const sameSubnet = candidates.find((candidate) => isSameSubnet(candidate.address, targetIp, candidate.netmask));
    if (sameSubnet) return sameSubnet.address;
  }

  return candidates[0]?.address ?? "127.0.0.1";
}

export async function ensureMediaServer() {
  if (server?.listening) return port;

  server = http.createServer((request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");
      const match = requestUrl.pathname.match(/^\/media\/([^/]+)$/);
      if (!match) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      const servedFile = files.get(match[1]);
      if (!servedFile) {
        response.writeHead(404);
        response.end("Media not found");
        return;
      }

      const stat = fs.statSync(servedFile.filePath);
      const range = request.headers.range;
      if (range) {
        const matchRange = range.match(/bytes=(\d*)-(\d*)/);
        const start = matchRange?.[1] ? Number(matchRange[1]) : 0;
        const end = matchRange?.[2] ? Number(matchRange[2]) : stat.size - 1;
        if (start >= stat.size || end >= stat.size || start > end) {
          response.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
          response.end();
          return;
        }
        response.writeHead(206, {
          "Content-Type": servedFile.contentType,
          "Content-Length": end - start + 1,
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store"
        });
        fs.createReadStream(servedFile.filePath, { start, end }).pipe(response);
        return;
      }

      response.writeHead(200, {
        "Content-Type": servedFile.contentType,
        "Content-Length": stat.size,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store"
      });
      fs.createReadStream(servedFile.filePath).pipe(response);
    } catch (error) {
      response.writeHead(500);
      response.end(error instanceof Error ? error.message : "Media server error");
    }
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

export async function addMediaFile(filePath: string, targetIp?: string) {
  const mediaType = getMediaTypeForPath(filePath);
  if (!mediaType) {
    throw new Error("지원하지 않는 미디어 파일입니다. mp4, m4v, mov, mp3, jpg, png만 선택하세요.");
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error("선택한 경로가 파일이 아닙니다.");
  }

  await ensureMediaServer();
  const id = randomUUID();
  const fileName = path.basename(filePath);
  files.set(id, { filePath, fileName, contentType: getContentTypeForPath(filePath) });

  return {
    id,
    fileName,
    mediaType,
    contentType: getContentTypeForPath(filePath),
    url: `http://${getBestLocalIp(targetIp)}:${port}/media/${id}`
  };
}

export async function stopMediaServer() {
  files.clear();
  if (!server) return;
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = null;
  port = 0;
}
