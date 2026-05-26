import tls from "node:tls";
import { EventEmitter } from "node:events";

const CAST_PORT = 8009;
const RECEIVER_DESTINATION = "receiver-0";
const DEFAULT_MEDIA_RECEIVER_APP_ID = "CC1AD845";

type CastPayload = Record<string, unknown> & { type: string; requestId?: number };

type CastMessage = {
  sourceId: string;
  destinationId: string;
  namespace: string;
  payloadUtf8: string;
};

type ReceiverApplication = {
  appId?: string;
  sessionId?: string;
  transportId?: string;
};

export type CastMediaStatus = {
  mediaSessionId?: number;
  playerState?: string;
  idleReason?: string;
  errorCode?: string;
  errorReason?: string;
};

export type CastV2ClientOptions = {
  ipAddress: string;
  timeoutMs?: number;
};

const NAMESPACE_CONNECTION = "urn:x-cast:com.google.cast.tp.connection";
const NAMESPACE_HEARTBEAT = "urn:x-cast:com.google.cast.tp.heartbeat";
const NAMESPACE_RECEIVER = "urn:x-cast:com.google.cast.receiver";
const NAMESPACE_MEDIA = "urn:x-cast:com.google.cast.media";

function encodeVarint(value: number) {
  const bytes: number[] = [];
  let current = value >>> 0;
  while (current >= 0x80) {
    bytes.push((current & 0x7f) | 0x80);
    current >>>= 7;
  }
  bytes.push(current);
  return Buffer.from(bytes);
}

function decodeVarint(buffer: Buffer, offset: number) {
  let result = 0;
  let shift = 0;
  let cursor = offset;

  while (cursor < buffer.length) {
    const byte = buffer[cursor];
    result |= (byte & 0x7f) << shift;
    cursor += 1;
    if ((byte & 0x80) === 0) return { value: result >>> 0, offset: cursor };
    shift += 7;
  }

  throw new Error("Invalid protobuf varint");
}

function encodeField(fieldNumber: number, wireType: number, value: Buffer) {
  return Buffer.concat([encodeVarint((fieldNumber << 3) | wireType), value]);
}

function encodeStringField(fieldNumber: number, value: string) {
  const data = Buffer.from(value, "utf8");
  return encodeField(fieldNumber, 2, Buffer.concat([encodeVarint(data.length), data]));
}

function encodeVarintField(fieldNumber: number, value: number) {
  return encodeField(fieldNumber, 0, encodeVarint(value));
}

export function encodeCastMessage(message: CastMessage) {
  const protobuf = Buffer.concat([
    encodeVarintField(1, 0),
    encodeStringField(2, message.sourceId),
    encodeStringField(3, message.destinationId),
    encodeStringField(4, message.namespace),
    encodeVarintField(5, 0),
    encodeStringField(6, message.payloadUtf8)
  ]);
  const frame = Buffer.alloc(4);
  frame.writeUInt32BE(protobuf.length, 0);
  return Buffer.concat([frame, protobuf]);
}

export function decodeCastMessage(protobuf: Buffer): CastMessage {
  let offset = 0;
  const message: CastMessage = {
    sourceId: "",
    destinationId: "",
    namespace: "",
    payloadUtf8: ""
  };

  while (offset < protobuf.length) {
    const tag = decodeVarint(protobuf, offset);
    offset = tag.offset;
    const fieldNumber = tag.value >> 3;
    const wireType = tag.value & 0x7;

    if (wireType === 0) {
      const decoded = decodeVarint(protobuf, offset);
      offset = decoded.offset;
      continue;
    }

    if (wireType !== 2) {
      throw new Error(`Unsupported Cast protobuf wire type: ${wireType}`);
    }

    const length = decodeVarint(protobuf, offset);
    offset = length.offset;
    const value = protobuf.subarray(offset, offset + length.value).toString("utf8");
    offset += length.value;

    if (fieldNumber === 2) message.sourceId = value;
    if (fieldNumber === 3) message.destinationId = value;
    if (fieldNumber === 4) message.namespace = value;
    if (fieldNumber === 6) message.payloadUtf8 = value;
  }

  return message;
}

export function createReceiverLaunchPayload(requestId: number) {
  return {
    type: "LAUNCH",
    appId: DEFAULT_MEDIA_RECEIVER_APP_ID,
    requestId
  };
}

export function createMediaLoadPayload(requestId: number, sessionId: string, mediaUrl: string, contentType: string, streamType: "BUFFERED" | "LIVE" = "BUFFERED") {
  return {
    type: "LOAD",
    requestId,
    sessionId,
    autoplay: true,
    currentTime: 0,
    media: {
      contentId: mediaUrl,
      contentType,
      streamType,
      metadata: {
        type: 0,
        title: "LAN Screen Viewer Cast"
      }
    }
  };
}

export class CastV2Client extends EventEmitter {
  private socket: tls.TLSSocket | null = null;
  private buffer = Buffer.alloc(0);
  private requestId = 1;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private sourceId = `sender-${Math.floor(Math.random() * 100000)}`;
  private timeoutMs: number;
  sessionId = "";
  transportId = "";
  mediaSessionId = 0;

  constructor(private options: CastV2ClientOptions) {
    super();
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  async connect() {
    this.socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const socket = tls.connect({
        host: this.options.ipAddress,
        port: CAST_PORT,
        servername: this.options.ipAddress,
        rejectUnauthorized: false
      });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Cast V2 TLS 연결 시간이 초과되었습니다 (${CAST_PORT}).`));
      }, this.timeoutMs);

      socket.once("secureConnect", () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    this.socket.on("data", (chunk) => this.handleData(chunk));
    this.socket.on("error", (error) => this.emit("error", error));
    this.socket.on("close", () => this.emit("close"));
    this.sendJson(RECEIVER_DESTINATION, NAMESPACE_CONNECTION, { type: "CONNECT", origin: {} });
    this.startHeartbeat();
  }

  close() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.socket?.end();
    this.socket?.destroy();
    this.socket = null;
  }

  async getStatus() {
    const requestId = this.nextRequestId();
    this.sendJson(RECEIVER_DESTINATION, NAMESPACE_RECEIVER, { type: "GET_STATUS", requestId });
    return this.waitForPayload((payload) => payload.type === "RECEIVER_STATUS" && payload.requestId === requestId);
  }

  async launchDefaultMediaReceiver() {
    const requestId = this.nextRequestId();
    this.sendJson(RECEIVER_DESTINATION, NAMESPACE_RECEIVER, createReceiverLaunchPayload(requestId));
    const response = await this.waitForPayload((payload) => payload.type === "RECEIVER_STATUS" && payload.requestId === requestId);
    const application = findDefaultMediaReceiver(response);
    if (!application?.sessionId || !application.transportId) {
      throw new Error("Default Media Receiver sessionId/transportId를 찾지 못했습니다.");
    }

    this.sessionId = application.sessionId;
    this.transportId = application.transportId;
    this.sendJson(this.transportId, NAMESPACE_CONNECTION, { type: "CONNECT", origin: {} });
    return application;
  }

  async loadMedia(mediaUrl: string, contentType: string, streamType: "BUFFERED" | "LIVE" = "BUFFERED") {
    if (!this.sessionId || !this.transportId) {
      throw new Error("Receiver session이 없습니다. 먼저 Default Media Receiver를 실행해야 합니다.");
    }

    const requestId = this.nextRequestId();
    this.sendJson(this.transportId, NAMESPACE_MEDIA, createMediaLoadPayload(requestId, this.sessionId, mediaUrl, contentType, streamType));
    const response = await this.waitForPayload(
      (payload) => (payload.type === "MEDIA_STATUS" || payload.type === "LOAD_FAILED") && payload.requestId === requestId,
      this.timeoutMs * 2
    );

    if (response.type === "LOAD_FAILED") {
      throw new Error(`Chromecast LOAD 실패: ${JSON.stringify(response).slice(0, 300)}`);
    }

    const status = Array.isArray(response.status) ? (response.status[0] as CastMediaStatus | undefined) : undefined;
    this.mediaSessionId = status?.mediaSessionId ?? 0;
    return status;
  }

  async waitForMediaStatus(timeoutMs = this.timeoutMs, predicate: (status: CastMediaStatus) => boolean = () => true) {
    return this.waitForPayload((payload) => {
      if (payload.type !== "MEDIA_STATUS" || !Array.isArray(payload.status)) return false;
      const status = payload.status[0] as CastMediaStatus | undefined;
      return Boolean(status && predicate(status));
    }, timeoutMs).then((payload) => (Array.isArray(payload.status) ? (payload.status[0] as CastMediaStatus | undefined) : undefined));
  }

  async stopMedia() {
    if (!this.transportId || !this.mediaSessionId) return;
    const requestId = this.nextRequestId();
    this.sendJson(this.transportId, NAMESPACE_MEDIA, { type: "STOP", requestId, mediaSessionId: this.mediaSessionId });
    await this.waitForPayload((payload) => payload.type === "MEDIA_STATUS" && payload.requestId === requestId).catch(() => undefined);
  }

  private startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      this.sendJson(RECEIVER_DESTINATION, NAMESPACE_HEARTBEAT, { type: "PING" });
    }, 5000);
  }

  private nextRequestId() {
    this.requestId += 1;
    return this.requestId;
  }

  private sendJson(destinationId: string, namespace: string, payload: CastPayload) {
    if (!this.socket) throw new Error("Cast V2 socket is not connected.");
    this.socket.write(
      encodeCastMessage({
        sourceId: this.sourceId,
        destinationId,
        namespace,
        payloadUtf8: JSON.stringify(payload)
      })
    );
  }

  private handleData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (this.buffer.length < length + 4) return;
      const frame = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);
      const message = decodeCastMessage(frame);
      this.emit("message", message);
      if (message.payloadUtf8) {
        try {
          this.emit("payload", JSON.parse(message.payloadUtf8) as CastPayload);
        } catch {
          // Ignore malformed receiver payloads; waiters parse defensively too.
        }
      }

      if (message.namespace === NAMESPACE_HEARTBEAT) {
        const payload = JSON.parse(message.payloadUtf8) as CastPayload;
        if (payload.type === "PING") this.sendJson(message.sourceId || RECEIVER_DESTINATION, NAMESPACE_HEARTBEAT, { type: "PONG" });
      }
    }
  }

  private waitForPayload(predicate: (payload: CastPayload) => boolean, timeoutMs = this.timeoutMs) {
    return new Promise<CastPayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Cast V2 응답 대기 시간이 초과되었습니다."));
      }, timeoutMs);

      const onMessage = (message: CastMessage) => {
        if (!message.payloadUtf8) return;
        let payload: CastPayload;
        try {
          payload = JSON.parse(message.payloadUtf8) as CastPayload;
        } catch {
          return;
        }

        if (predicate(payload)) {
          cleanup();
          resolve(payload);
        }
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.off("message", onMessage);
        this.off("error", onError);
      };

      this.on("message", onMessage);
      this.on("error", onError);
    });
  }
}

function findDefaultMediaReceiver(payload: CastPayload): ReceiverApplication | undefined {
  const status = payload.status as { applications?: ReceiverApplication[] } | undefined;
  return status?.applications?.find((application) => application.appId === DEFAULT_MEDIA_RECEIVER_APP_ID) ?? status?.applications?.[0];
}
