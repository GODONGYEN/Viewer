import { z } from "zod";

export const TVDiscoveryMethodSchema = z.enum(["mDNS", "SSDP", "manual", "unknown"]);
export const TVProtocolSchema = z.enum(["AirPlay", "Chromecast", "DLNA", "Miracast possible", "Unknown"]);
export const TVCapabilitySchema = z.enum([
  "screen-mirroring-guide",
  "browser-cast-guide",
  "media-playback-experimental",
  "wireless-display-guide",
  "device-info"
]);
export const TVActionAvailabilitySchema = z.enum(["available", "guide-only", "experimental", "unsupported"]);

export const TVActionSchema = z.object({
  id: z.enum([
    "airplay-guide",
    "airplay-start",
    "open-display-settings",
    "open-screen-recording-settings",
    "copy-device-info",
    "chromecast-guide",
    "chromecast-connect",
    "chromecast-test-media",
    "chromecast-screen-experiment",
    "cast-stop",
    "media-cast-placeholder",
    "dlna-media-experiment",
    "dlna-info",
    "miracast-windows-guide",
    "miracast-start",
    "airplay-on-macos-guide",
    "manual-guide"
  ]),
  label: z.string().min(1),
  availability: TVActionAvailabilitySchema,
  description: z.string().min(1),
  protocol: TVProtocolSchema.optional(),
  disabled: z.boolean().optional()
});

export const TVDeviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  ipAddress: z.string(),
  discoveryMethod: TVDiscoveryMethodSchema,
  discoveryMethods: z.array(TVDiscoveryMethodSchema).optional(),
  protocol: TVProtocolSchema,
  protocols: z.array(TVProtocolSchema).optional(),
  capabilities: z.array(TVCapabilitySchema).optional(),
  connectable: z.enum(["guide-only", "media-only", "unknown"]),
  recommendedAction: z.string().min(1),
  actions: z.array(TVActionSchema).optional(),
  possibleActions: z.array(z.string()).optional(),
  unavailableActions: z.array(z.string()).optional(),
  securityNotes: z.array(z.string()).optional(),
  details: z.string().optional(),
  serviceType: z.string().optional(),
  serviceTypes: z.array(z.string()).optional(),
  location: z.string().url().optional(),
  raw: z.record(z.string(), z.string().optional()).optional(),
  lastSeenAt: z.number().finite()
});

export const TVDiscoveryEventSchema = z.object({
  type: z.enum(["device-found", "status", "device-expired", "error"]),
  device: TVDeviceSchema.optional(),
  message: z.string().optional(),
  timestamp: z.number().finite()
});

export const DLNAMediaRequestSchema = z.object({
  deviceId: z.string().min(1),
  ipAddress: z.string().min(1),
  location: z.string().url().optional(),
  mediaPath: z.string().min(1),
  mediaType: z.enum(["video", "audio", "image"]),
  fileName: z.string().min(1)
});

export const TVActionRequestSchema = z.object({
  deviceId: z.string().min(1),
  actionId: TVActionSchema.shape.id,
  protocol: TVProtocolSchema.optional()
});

export type TVDevicePayload = z.infer<typeof TVDeviceSchema>;
export type TVDiscoveryEventPayload = z.infer<typeof TVDiscoveryEventSchema>;
export type DLNAMediaRequest = z.infer<typeof DLNAMediaRequestSchema>;
export type TVActionRequest = z.infer<typeof TVActionRequestSchema>;
