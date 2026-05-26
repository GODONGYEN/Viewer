import { z } from "zod";
import { isPrivateIpv4 } from "./network";

export const SIGNALING_PORT = 4173;
export const DISCOVERY_PORT = 45454;
export const PIN_TTL_MS = 10 * 60 * 1000;

export const PinSchema = z.string().regex(/^\d{6}$/);

export const DiscoveryPayloadSchema = z
  .object({
    type: z.literal("SCREEN_SHARE_HOST"),
    version: z.literal(1),
    hostId: z.string().min(8).max(80),
    hostName: z.string().min(1).max(80),
    wsUrl: z.string().url().startsWith("ws://"),
    ipAddress: z.string(),
    pinRequired: z.boolean(),
    expiresAt: z.number().finite()
  })
  .strict()
  .refine((payload) => payload.expiresAt > Date.now(), "expired discovery payload")
  .refine((payload) => isPrivateIpv4(payload.ipAddress) || payload.ipAddress === "127.0.0.1", "ipAddress must be private IPv4")
  .refine((payload) => {
    try {
      const url = new URL(payload.wsUrl);
      return isPrivateIpv4(url.hostname) || url.hostname === "localhost" || url.hostname === "127.0.0.1";
    } catch {
      return false;
    }
  }, "wsUrl must target a local/private host");

export const HostFoundPayloadSchema = DiscoveryPayloadSchema.extend({
  remoteAddress: z.string(),
  lastSeenAt: z.number().finite()
});

export const JoinPayloadSchema = z
  .object({
    type: z.literal("LAN_SCREEN_SHARE_JOIN"),
    version: z.literal(1),
    hostId: z.string().min(8).max(80),
    hostName: z.string().min(1).max(80),
    wsUrl: z.string().url().startsWith("ws://"),
    ipAddress: z.string().min(7).max(45),
    pinRequired: z.boolean(),
    expiresAt: z.number().finite(),
    pin: PinSchema.optional()
  })
  .strict()
  .refine((payload) => payload.expiresAt > Date.now(), "expired connection data");

export const HostRegisterMessageSchema = z.object({
  type: z.literal("host-register"),
  pin: PinSchema,
  pinExpiresAt: z.number().finite().optional(),
  hostName: z.string().min(1).max(80).optional()
});

export const ViewerRequestMessageSchema = z.object({
  type: z.literal("viewer-request"),
  pin: PinSchema,
  viewerName: z.string().min(1).max(80).optional()
});

export const HostDecisionMessageSchema = z.object({
  type: z.literal("host-decision"),
  requestId: z.string().min(1),
  accepted: z.boolean()
});

export const SignalMessageSchema = z.object({
  type: z.literal("signal"),
  requestId: z.string().min(1),
  data: z.unknown()
});

export const DisconnectPeerMessageSchema = z.object({
  type: z.literal("disconnect-peer"),
  requestId: z.string().min(1)
});

export type DiscoveryPayload = z.infer<typeof DiscoveryPayloadSchema>;
export type HostFoundPayload = z.infer<typeof HostFoundPayloadSchema>;
export type JoinPayload = z.infer<typeof JoinPayloadSchema>;
