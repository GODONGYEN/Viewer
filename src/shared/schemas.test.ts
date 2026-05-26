import { describe, expect, it } from "vitest";
import {
  DiscoveryPayloadSchema,
  HostRegisterMessageSchema,
  JoinPayloadSchema,
  PinSchema,
  ViewerRequestMessageSchema
} from "./schemas";
import { getDirectedBroadcast, isPrivateIpv4, isPrivateOrLoopback } from "./network";
import { mergeTvDevices } from "./tvActions";
import { DLNAMediaRequestSchema, TVActionRequestSchema, TVDeviceSchema } from "./tvSchemas";
import { getTvConnectorPlan } from "./tvConnectionPlan";
import { CastWebRtcSignalRequestSchema, CastWebRtcSignalSchema, TVConnectionEventSchema, TVConnectionStartRequestSchema } from "./tvConnectionSchemas";
import { buildDidlLiteMetadata, buildSoapEnvelope, extractDlnaAvTransportService } from "../main/connectors/dlnaConnector";
import { createCustomReceiverLaunchPayload, createMediaLoadPayload, createReceiverLaunchPayload, decodeCastMessage, encodeCastMessage } from "../main/connectors/castV2Client";
import { getBestLocalIp, getContentTypeForPath, getMediaTypeForPath } from "../main/mediaServer";
import { chooseScreenStreamMimeType, getScreenStreamDiagnostics, getScreenStreamLimits } from "../main/screenStreamServer";
import { buildHlsFfmpegArgs, getHlsReadyState, getHlsScreenStreamDiagnostics } from "../main/hlsScreenStreamServer";
import { chooseBestRecorderMimeType, getScreenCaptureSupport, isValidCaptureSource, normalizeCaptureError } from "../renderer/screenCapture";
import { getRecorderTimesliceMs, getScreenStreamTuning, parseFfmpegSpeed, shouldWarnForSlowEncoding } from "./screenStreamTuning";

describe("network helpers", () => {
  it("recognizes private IPv4 ranges", () => {
    expect(isPrivateIpv4("10.0.0.8")).toBe(true);
    expect(isPrivateIpv4("172.16.1.5")).toBe(true);
    expect(isPrivateIpv4("172.31.255.5")).toBe(true);
    expect(isPrivateIpv4("192.168.0.12")).toBe(true);
    expect(isPrivateIpv4("8.8.8.8")).toBe(false);
  });

  it("recognizes loopback and private addresses", () => {
    expect(isPrivateOrLoopback("127.0.0.1")).toBe(true);
    expect(isPrivateOrLoopback("::1")).toBe(true);
    expect(isPrivateOrLoopback("::ffff:192.168.1.10")).toBe(true);
    expect(isPrivateOrLoopback("1.1.1.1")).toBe(false);
  });

  it("computes directed broadcast addresses", () => {
    expect(getDirectedBroadcast("192.168.1.10", "255.255.255.0")).toBe("192.168.1.255");
  });
});

describe("schema validation", () => {
  it("validates PIN format", () => {
    expect(PinSchema.safeParse("123456").success).toBe(true);
    expect(PinSchema.safeParse("12345").success).toBe(false);
    expect(PinSchema.safeParse("abcdef").success).toBe(false);
  });

  it("accepts valid discovery payloads without PIN", () => {
    const payload = {
      type: "SCREEN_SHARE_HOST",
      version: 1,
      hostId: "host-123456",
      hostName: "Host",
      wsUrl: "ws://192.168.1.10:4173",
      ipAddress: "192.168.1.10",
      pinRequired: true,
      expiresAt: Date.now() + 60_000
    };

    expect(DiscoveryPayloadSchema.safeParse(payload).success).toBe(true);
    expect(DiscoveryPayloadSchema.safeParse({ ...payload, pin: "123456" }).success).toBe(false);
  });

  it("rejects expired QR connection payloads", () => {
    const payload = {
      type: "LAN_SCREEN_SHARE_JOIN",
      version: 1,
      hostId: "host-123456",
      hostName: "Host",
      wsUrl: "ws://192.168.1.10:4173",
      ipAddress: "192.168.1.10",
      pinRequired: true,
      expiresAt: Date.now() - 1
    };

    expect(JoinPayloadSchema.safeParse(payload).success).toBe(false);
    expect(JoinPayloadSchema.safeParse({ ...payload, expiresAt: Date.now() + 60_000 }).success).toBe(true);
    expect(JoinPayloadSchema.safeParse({ ...payload, expiresAt: Date.now() + 60_000, pin: "123456" }).success).toBe(true);
  });

  it("validates signaling messages", () => {
    expect(HostRegisterMessageSchema.safeParse({ type: "host-register", pin: "123456", pinExpiresAt: Date.now() + 60_000 }).success).toBe(true);
    expect(ViewerRequestMessageSchema.safeParse({ type: "viewer-request", pin: "000000", viewerName: "Viewer" }).success).toBe(true);
    expect(ViewerRequestMessageSchema.safeParse({ type: "viewer-request", pin: "bad" }).success).toBe(false);
  });

  it("validates TV discovery and action payloads", () => {
    const device = {
      id: "mdns:airplay:living-room",
      name: "Living Room TV",
      ipAddress: "192.168.1.30",
      discoveryMethod: "mDNS",
      protocol: "AirPlay",
      connectable: "guide-only",
      recommendedAction: "Use macOS Screen Mirroring.",
      lastSeenAt: Date.now()
    };

    expect(TVDeviceSchema.safeParse(device).success).toBe(true);
    expect(TVActionRequestSchema.safeParse({ deviceId: device.id, actionId: "copy-device-info", protocol: "AirPlay" }).success).toBe(true);
    expect(TVActionRequestSchema.safeParse({ deviceId: device.id, actionId: "force-connect" }).success).toBe(false);
  });

  it("validates DLNA media requests without claiming screen mirroring", () => {
    expect(
      DLNAMediaRequestSchema.safeParse({
        deviceId: "dlna-tv",
        ipAddress: "192.168.1.31",
        mediaPath: "/tmp/sample.mp4",
        mediaType: "video",
        fileName: "sample.mp4"
      }).success
    ).toBe(true);
    expect(
      DLNAMediaRequestSchema.safeParse({
        deviceId: "dlna-tv",
        ipAddress: "192.168.1.31",
        mediaPath: "/tmp/sample.exe",
        mediaType: "application",
        fileName: "sample.exe"
      }).success
    ).toBe(false);
  });

  it("merges the same TV found through multiple protocols", () => {
    const airplay = {
      id: "mdns:airplay:tv",
      name: "Living Room TV",
      ipAddress: "192.168.1.30",
      discoveryMethod: "mDNS" as const,
      protocol: "AirPlay" as const,
      connectable: "guide-only" as const,
      recommendedAction: "Use macOS Screen Mirroring.",
      serviceType: "airplay",
      lastSeenAt: 100
    };
    const dlna = {
      id: "ssdp:dlna:tv",
      name: "Living Room TV",
      ipAddress: "192.168.1.30",
      discoveryMethod: "SSDP" as const,
      protocol: "DLNA" as const,
      connectable: "media-only" as const,
      recommendedAction: "Use DLNA for media playback.",
      serviceType: "urn:schemas-upnp-org:device:MediaRenderer:1",
      lastSeenAt: 200
    };

    const merged = mergeTvDevices(airplay, dlna);
    expect(merged.protocol).toBe("AirPlay");
    expect(merged.protocols).toEqual(["AirPlay", "DLNA"]);
    expect(merged.discoveryMethods).toEqual(["mDNS", "SSDP"]);
  });

  it("plans connector priority by detected TV protocols", () => {
    const device = {
      id: "tv",
      name: "Living Room TV",
      ipAddress: "192.168.1.30",
      discoveryMethod: "mDNS" as const,
      protocol: "Chromecast" as const,
      protocols: ["DLNA", "Chromecast", "AirPlay"] as const,
      connectable: "guide-only" as const,
      recommendedAction: "Connect",
      lastSeenAt: Date.now()
    };

    expect(getTvConnectorPlan(device).filter((attempt) => attempt.canAttempt).map((attempt) => attempt.connector)).toEqual(["chromecast", "airplay", "dlna"]);
    expect(getTvConnectorPlan(device, { action: "play-dlna-media" }).filter((attempt) => attempt.canAttempt).map((attempt) => attempt.connector)).toEqual(["dlna"]);
  });

  it("validates TV connection requests and events", () => {
    const device = {
      id: "tv",
      name: "Living Room TV",
      ipAddress: "192.168.1.30",
      discoveryMethod: "mDNS",
      protocol: "Chromecast",
      connectable: "guide-only",
      recommendedAction: "Connect",
      lastSeenAt: Date.now()
    };
    expect(TVConnectionStartRequestSchema.safeParse({ device, options: { action: "connect" } }).success).toBe(true);
    expect(TVConnectionStartRequestSchema.safeParse({ device, options: { action: "force-connect" } }).success).toBe(false);
    expect(
      TVConnectionEventSchema.safeParse({
        connectionId: "conn",
        deviceId: "tv",
        connector: "chromecast",
        status: "connecting",
        step: "probe",
        message: "connecting",
        timestamp: Date.now()
      }).success
    ).toBe(true);
  });

  it("extracts DLNA AVTransport controlURL and builds SOAP envelopes", () => {
    const xml = `
      <root><device><serviceList>
        <service>
          <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
          <controlURL>/upnp/control/AVTransport1</controlURL>
        </service>
      </serviceList></device></root>`;
    const service = extractDlnaAvTransportService(xml, "http://192.168.1.30:1400/xml/device.xml");
    expect(service?.controlUrl).toBe("http://192.168.1.30:1400/upnp/control/AVTransport1");
    expect(buildSoapEnvelope("SetAVTransportURI", service?.serviceType ?? "", "http://192.168.1.2:5000/media/a&b")).toContain("a&amp;b");
    expect(buildDidlLiteMetadata("http://192.168.1.2:5000/media/movie.mp4", "video/mp4", "Movie")).toContain("object.item.videoItem");
  });

  it("classifies media files and produces a private media server IP", () => {
    expect(getMediaTypeForPath("/tmp/movie.mp4")).toBe("video");
    expect(getMediaTypeForPath("/tmp/song.mp3")).toBe("audio");
    expect(getMediaTypeForPath("/tmp/photo.png")).toBe("image");
    expect(getMediaTypeForPath("/tmp/app.exe")).toBeNull();
    expect(getContentTypeForPath("/tmp/movie.mp4")).toBe("video/mp4");
    expect(getBestLocalIp()).toMatch(/^(\d+\.\d+\.\d+\.\d+)$/);
  });

  it("encodes Cast V2 messages and builds receiver/media payloads", () => {
    const encoded = encodeCastMessage({
      sourceId: "sender-1",
      destinationId: "receiver-0",
      namespace: "urn:x-cast:com.google.cast.receiver",
      payloadUtf8: JSON.stringify({ type: "GET_STATUS", requestId: 1 })
    });
    const length = encoded.readUInt32BE(0);
    expect(length).toBe(encoded.length - 4);
    const decoded = decodeCastMessage(encoded.subarray(4));
    expect(decoded.sourceId).toBe("sender-1");
    expect(JSON.parse(decoded.payloadUtf8).type).toBe("GET_STATUS");
    expect(createReceiverLaunchPayload(2)).toMatchObject({ type: "LAUNCH", appId: "CC1AD845", requestId: 2 });
    expect(createCustomReceiverLaunchPayload(5, "ABCD1234")).toMatchObject({ type: "LAUNCH", appId: "ABCD1234", requestId: 5 });
    expect(createMediaLoadPayload(3, "session", "http://192.168.1.2/media/movie.mp4", "video/mp4")).toMatchObject({
      type: "LOAD",
      media: { streamType: "BUFFERED", contentType: "video/mp4" }
    });
    expect(createMediaLoadPayload(4, "session", "http://192.168.1.2/screen.webm", "video/webm", "LIVE")).toMatchObject({
      type: "LOAD",
      media: { streamType: "LIVE", contentType: "video/webm" }
    });
  });

  it("validates WebRTC custom receiver signaling messages", () => {
    expect(CastWebRtcSignalSchema.safeParse({ type: "receiver-ready", timestamp: Date.now() }).success).toBe(true);
    expect(CastWebRtcSignalSchema.safeParse({ type: "sender-offer", sdp: "v=0" }).success).toBe(true);
    expect(CastWebRtcSignalSchema.safeParse({ type: "receiver-answer", sdp: "v=0" }).success).toBe(true);
    expect(CastWebRtcSignalSchema.safeParse({ type: "sender-ice", candidate: null }).success).toBe(true);
    expect(CastWebRtcSignalSchema.safeParse({ type: "receiver-stats", rendering: true, rttMs: 12 }).success).toBe(true);
    expect(CastWebRtcSignalSchema.safeParse({ type: "sender-offer" }).success).toBe(false);
    expect(CastWebRtcSignalRequestSchema.safeParse({ connectionId: "conn", message: { type: "ping", timestamp: Date.now() } }).success).toBe(true);
  });

  it("selects a screen stream MIME type", () => {
    expect(chooseScreenStreamMimeType((mimeType) => mimeType === "video/webm")).toBe("video/webm");
    expect(chooseScreenStreamMimeType(() => false)).toBe("");
    expect(getScreenStreamLimits().maxChunkBytes).toBeGreaterThan(1024);
  });

  it("validates screen stream options", () => {
    const device = {
      id: "tv",
      name: "Living Room TV",
      ipAddress: "192.168.1.30",
      discoveryMethod: "mDNS",
      protocol: "Chromecast",
      connectable: "guide-only",
      recommendedAction: "Connect",
      lastSeenAt: Date.now()
    };
    expect(
      TVConnectionStartRequestSchema.safeParse({
        device,
        options: {
          action: "start-screen-cast-experiment",
          testMediaUrl: "http://192.168.1.2:3000/screen-stream/id/live.webm",
          contentType: "video/webm",
          streamType: "LIVE",
          screenStreamStrategy: "auto",
          screenStreamOptions: { strategy: "auto", preset: "low-latency", resolution: "720p", fps: 15, bitrateMbps: 2 },
          screenStreamSources: [
            { id: "hls-1", url: "http://192.168.1.2:3000/hls/hls-1/index.m3u8", contentType: "application/vnd.apple.mpegurl", strategy: "hls" },
            { id: "webm-1", url: "http://192.168.1.2:3000/screen-stream/webm-1/live.webm", contentType: "video/webm", strategy: "webm" }
          ]
        }
      }).success
    ).toBe(true);
    expect(
      TVConnectionStartRequestSchema.safeParse({
        device,
        options: {
          action: "start-screen-cast-experiment",
          screenStreamOptions: { strategy: "auto", preset: "fastest", resolution: "4k", fps: 60, bitrateMbps: 40 }
        }
      }).success
    ).toBe(false);
  });

  it("builds screen stream tuning profiles for latency and CPU tradeoffs", () => {
    expect(getScreenStreamTuning({ preset: "low-latency" })).toMatchObject({
      resolution: "720p",
      fps: 15,
      bitrateMbps: 2,
      hlsTimeSeconds: 1,
      hlsListSize: 2,
      ffmpegPreset: "ultrafast"
    });
    expect(getScreenStreamTuning({ preset: "low-cpu" })).toMatchObject({
      resolution: "540p",
      fps: 10,
      bitrateMbps: 1,
      targetHeight: 540
    });
    expect(getRecorderTimesliceMs({ preset: "balanced" })).toBe(500);
  });

  it("builds low latency and low CPU ffmpeg HLS args", () => {
    const lowLatencyArgs = buildHlsFfmpegArgs({ strategy: "auto", preset: "low-latency", resolution: "720p", fps: 15, bitrateMbps: 2 }, "/tmp/index.m3u8", "/tmp/segment-%05d.ts");
    expect(lowLatencyArgs).toContain("ultrafast");
    expect(lowLatencyArgs.slice(lowLatencyArgs.indexOf("-hls_time") + 1, lowLatencyArgs.indexOf("-hls_time") + 2)).toEqual(["1"]);
    expect(lowLatencyArgs.slice(lowLatencyArgs.indexOf("-hls_list_size") + 1, lowLatencyArgs.indexOf("-hls_list_size") + 2)).toEqual(["2"]);
    expect(lowLatencyArgs.slice(lowLatencyArgs.indexOf("-g") + 1, lowLatencyArgs.indexOf("-g") + 2)).toEqual(["15"]);

    const lowCpuArgs = buildHlsFfmpegArgs({ strategy: "auto", preset: "low-cpu", resolution: "540p", fps: 10, bitrateMbps: 1 }, "/tmp/index.m3u8", "/tmp/segment-%05d.ts");
    expect(lowCpuArgs).toContain("scale=-2:540,fps=10");
    expect(lowCpuArgs.slice(lowCpuArgs.indexOf("-b:v") + 1, lowCpuArgs.indexOf("-b:v") + 2)).toEqual(["1M"]);
  });

  it("parses ffmpeg speed and reports slow encoding warnings", () => {
    expect(parseFfmpegSpeed("frame=12 speed=0.82x")).toBe(0.82);
    expect(parseFfmpegSpeed("speed=1.24x")).toBe(1.24);
    expect(parseFfmpegSpeed("no speed")).toBeNull();
    expect(shouldWarnForSlowEncoding(0.75, 6)).toBe(true);
    expect(shouldWarnForSlowEncoding(0.75, 2)).toBe(false);
    expect(shouldWarnForSlowEncoding(1.05, 10)).toBe(false);
  });

  it("reports missing HLS sessions as not ready", () => {
    expect(getHlsReadyState("missing-session")).toMatchObject({ exists: false, playlistReady: false, segmentReady: false });
  });

  it("reports missing stream diagnostics without crashing", () => {
    expect(getScreenStreamDiagnostics(["missing-webm"])[0]).toMatchObject({ id: "missing-webm", strategy: "webm", exists: false, initChunkReady: false });
    expect(getHlsScreenStreamDiagnostics(["missing-hls"])[0]).toMatchObject({ id: "missing-hls", strategy: "hls", exists: false, playlistReady: false, segmentReady: false });
  });

  it("checks screen capture support without assuming browser APIs", () => {
    expect(
      getScreenCaptureSupport({
        navigator: { mediaDevices: { getDisplayMedia: async () => undefined as unknown as MediaStream, getUserMedia: async () => undefined as unknown as MediaStream } as MediaDevices },
        MediaRecorder: class {} as typeof MediaRecorder,
        isSecureContext: true
      })
    ).toMatchObject({ hasMediaDevices: true, hasGetDisplayMedia: true, hasGetUserMedia: true, hasMediaRecorder: true, isSecureContext: true });
    expect(getScreenCaptureSupport({ navigator: undefined, MediaRecorder: undefined, isSecureContext: false })).toMatchObject({
      hasMediaDevices: false,
      hasGetDisplayMedia: false,
      hasGetUserMedia: false,
      hasMediaRecorder: false,
      isSecureContext: false
    });
  });

  it("normalizes capture errors into fallback decisions", () => {
    expect(normalizeCaptureError(new Error("Not supported"))).toMatchObject({
      reason: "not-supported",
      shouldTryElectronFallback: true
    });
    expect(normalizeCaptureError(new DOMException("denied", "NotAllowedError"))).toMatchObject({
      reason: "permission-denied",
      shouldTryElectronFallback: true
    });
    expect(normalizeCaptureError(new TypeError("bad constraints"))).toMatchObject({
      reason: "constraints",
      shouldTryElectronFallback: true
    });
  });

  it("selects recorder MIME types without requiring audio", () => {
    expect(chooseBestRecorderMimeType((mimeType) => mimeType === "video/webm;codecs=vp8")).toBe("video/webm;codecs=vp8");
    expect(chooseBestRecorderMimeType((mimeType) => mimeType === "video/webm")).toBe("video/webm");
    expect(chooseBestRecorderMimeType(() => false)).toBe("");
  });

  it("validates Electron desktop capture sources", () => {
    expect(isValidCaptureSource({ id: "screen:1:0", name: "Entire Screen", thumbnailDataUrl: "data:image/png;base64,abc" })).toBe(true);
    expect(isValidCaptureSource({ id: "", name: "Broken" })).toBe(false);
    expect(isValidCaptureSource({ id: "screen:1:0" })).toBe(false);
  });
});
