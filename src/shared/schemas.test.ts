import { describe, expect, it } from "vitest";
import {
  DiscoveryPayloadSchema,
  HostRegisterMessageSchema,
  JoinPayloadSchema,
  PinSchema,
  ViewerRequestMessageSchema
} from "./schemas";
import { getDirectedBroadcast, isPrivateIpv4, isPrivateOrLoopback } from "./network";

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
});
