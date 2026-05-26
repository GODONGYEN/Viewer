import { z } from "zod";
import { TVDeviceSchema, TVProtocolSchema } from "./tvSchemas";

export const TVConnectorKindSchema = z.enum(["chromecast", "airplay", "dlna", "miracast", "diagnostic"]);
export const TVConnectionActionSchema = z.enum([
  "connect",
  "cast-test-media",
  "start-screen-cast-experiment",
  "start-webrtc-screen-cast",
  "play-dlna-media",
  "airplay-start",
  "miracast-start"
]);
export const TVConnectionStatusSchema = z.enum([
  "created",
  "analyzing",
  "connector-selected",
  "connecting",
  "receiver-starting",
  "media-server-starting",
  "media-url-created",
  "media-loading",
  "playing",
  "user-action-required",
  "stopping",
  "stopped",
  "failed",
  "unsupported"
]);

export const TVConnectionOptionsSchema = z.object({
  action: TVConnectionActionSchema.optional(),
  testMediaUrl: z.string().url().optional(),
  mediaFilePath: z.string().min(1).optional(),
  contentType: z.string().min(1).optional(),
  streamType: z.enum(["BUFFERED", "LIVE"]).optional(),
  screenStreamMode: z.enum(["auto", "webrtc-low-latency", "hls-stable"]).optional(),
  customReceiverAppId: z.string().trim().min(1).max(128).optional(),
  screenStreamStrategy: z.enum(["auto", "webm", "hls"]).optional(),
  screenStreamOptions: z
    .object({
      strategy: z.enum(["auto", "webm", "hls"]),
      preset: z.enum(["balanced", "low-latency", "low-cpu"]),
      resolution: z.enum(["540p", "720p", "1080p"]),
      fps: z.union([z.literal(10), z.literal(15), z.literal(30)]),
      bitrateMbps: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(6)])
    })
    .optional(),
  screenStreamSources: z
    .array(
      z.object({
        id: z.string().min(1),
        url: z.string().url(),
        contentType: z.string().min(1),
        strategy: z.enum(["webm", "hls"])
      })
    )
    .optional()
});

export const TVConnectionStartRequestSchema = z.object({
  device: TVDeviceSchema,
  options: TVConnectionOptionsSchema.optional()
});

export const TVConnectionEventSchema = z.object({
  connectionId: z.string().min(1),
  deviceId: z.string().min(1),
  connector: TVConnectorKindSchema,
  status: TVConnectionStatusSchema,
  message: z.string().min(1),
  step: z.string().min(1),
  timestamp: z.number().finite(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.undefined()])).optional()
});

export const DLNAMediaSelectionSchema = z.object({
  ok: z.boolean(),
  fileName: z.string().optional(),
  filePath: z.string().optional(),
  mediaType: z.enum(["video", "audio", "image"]).optional(),
  message: z.string().optional()
});

export const TVConnectorAttemptSchema = z.object({
  connector: TVConnectorKindSchema,
  protocol: TVProtocolSchema,
  canAttempt: z.boolean(),
  reason: z.string().optional()
});

export const CastWebRtcSignalSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sender-hello"), timestamp: z.number().finite().optional() }),
  z.object({ type: z.literal("receiver-ready"), timestamp: z.number().finite().optional() }),
  z.object({ type: z.literal("sender-offer"), sdp: z.string().min(1) }),
  z.object({ type: z.literal("receiver-answer"), sdp: z.string().min(1) }),
  z.object({ type: z.literal("sender-ice"), candidate: z.unknown().nullable() }),
  z.object({ type: z.literal("receiver-ice"), candidate: z.unknown().nullable() }),
  z.object({ type: z.literal("receiver-error"), message: z.string().min(1) }),
  z.object({
    type: z.literal("receiver-stats"),
    state: z.string().optional(),
    rendering: z.boolean().optional(),
    rttMs: z.number().finite().optional(),
    timestamp: z.number().finite().optional()
  }),
  z.object({ type: z.literal("ping"), timestamp: z.number().finite() }),
  z.object({ type: z.literal("pong"), timestamp: z.number().finite(), receivedAt: z.number().finite().optional() }),
  z.object({ type: z.literal("stop-stream") })
]);

export const CastWebRtcSignalRequestSchema = z.object({
  connectionId: z.string().min(1),
  message: CastWebRtcSignalSchema
});

export type TVConnectionStartRequestPayload = z.infer<typeof TVConnectionStartRequestSchema>;
export type TVConnectionEventPayload = z.infer<typeof TVConnectionEventSchema>;
export type CastWebRtcSignalPayload = z.infer<typeof CastWebRtcSignalSchema>;
