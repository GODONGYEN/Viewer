import { ConnectorContext, ConnectorResult, TVConnector } from "./types";
import { CastV2Client } from "./castV2Client";
import { addMediaFile, getContentTypeForPath } from "../mediaServer";
import { verifyScreenStreamUrl, waitForWebMReady } from "../screenStreamServer";
import { verifyLocalStreamUrl, waitForHlsReady } from "../hlsScreenStreamServer";
import { ScreenStreamSource } from "../../shared/tvConnectionTypes";

const activeCastClients = new Map<string, CastV2Client>();

export const chromecastConnector: TVConnector = {
  kind: "chromecast",
  canHandle(device, options) {
    const protocols = device.protocols ?? [device.protocol];
    return protocols.includes("Chromecast") && ["connect", "cast-test-media", "start-screen-cast-experiment", undefined].includes(options.action);
  },
  async connect(context: ConnectorContext): Promise<ConnectorResult> {
    const client = new CastV2Client({ ipAddress: context.device.ipAddress });
    activeCastClients.set(context.connectionId, client);
    context.emit({
      connectionId: context.connectionId,
      deviceId: context.device.id,
      connector: "chromecast",
      status: "connecting",
      step: "Cast V2 TLS",
      message: "Chromecast Cast V2 TLS 연결을 시작합니다.",
      details: { ipAddress: context.device.ipAddress, port: 8009 }
    });
    await client.connect();

    context.emit({
      connectionId: context.connectionId,
      deviceId: context.device.id,
      connector: "chromecast",
      status: "receiver-starting",
      step: "GET_STATUS",
      message: "Chromecast receiver 상태를 확인합니다."
    });
    await client.getStatus();

    context.emit({
      connectionId: context.connectionId,
      deviceId: context.device.id,
      connector: "chromecast",
      status: "receiver-starting",
      step: "LAUNCH Default Media Receiver",
      message: "Default Media Receiver(CC1AD845)를 실행합니다."
    });
    const application = await client.launchDefaultMediaReceiver();

    if (context.options.action === "connect" || !context.options.action) {
      return {
        ok: true,
        status: "user-action-required",
        message: "Default Media Receiver를 실행했습니다. 미디어 재생 또는 화면 스트림 액션을 선택할 수 있습니다.",
        canFallback: false,
        details: { sessionId: application.sessionId, transportId: application.transportId }
      };
    }

    let mediaUrl = context.options.testMediaUrl;
    let contentType = context.options.contentType;

    if (context.options.action === "start-screen-cast-experiment" && context.options.screenStreamSources?.length) {
      for (const source of context.options.screenStreamSources) {
        context.emit({
          connectionId: context.connectionId,
          deviceId: context.device.id,
          connector: "chromecast",
          status: "media-loading",
          step: "strategy-selected",
          message: `${source.strategy.toUpperCase()} 화면 스트림 전략을 시도합니다.`,
          details: { url: source.url, strategy: source.strategy }
        });

        try {
          await waitForStreamSourceReady(source, context);
          const status = await loadChromecastSource(client, source, context);
          return {
            ok: true,
            status: "playing",
            message: `${source.strategy.toUpperCase()} 화면 스트림 LOAD 요청을 보냈습니다.`,
            canFallback: false,
            details: {
              mediaSessionId: status?.mediaSessionId,
              playerState: status?.playerState,
              idleReason: status?.idleReason,
              strategy: source.strategy
            }
          };
        } catch (error) {
          context.emit({
            connectionId: context.connectionId,
            deviceId: context.device.id,
            connector: "chromecast",
            status: "failed",
            step: "strategy-failed",
            message: `${source.strategy.toUpperCase()} 화면 스트림 전략이 실패했습니다. 다음 전략이 있으면 자동으로 재시도합니다.`,
            details: { error: error instanceof Error ? error.message : String(error), strategy: source.strategy }
          });
        }
      }

      return {
        ok: false,
        status: "failed",
        message: "모든 Chromecast 화면 스트림 전략이 실패했습니다.",
        canFallback: true
      };
    }

    if (context.options.action === "cast-test-media") {
      if (!context.options.mediaFilePath) {
        return {
          ok: false,
          status: "unsupported",
          message: "Chromecast 테스트 미디어 재생에는 사용자가 선택한 로컬 파일이 필요합니다.",
          canFallback: true
        };
      }
      context.emit({
        connectionId: context.connectionId,
        deviceId: context.device.id,
        connector: "chromecast",
        status: "media-server-starting",
        step: "Chromecast media server",
        message: "로컬 미디어 서버를 시작하고 Chromecast가 접근 가능한 URL을 생성합니다."
      });
      const media = await addMediaFile(context.options.mediaFilePath, context.device.ipAddress);
      mediaUrl = media.url;
      contentType = media.contentType;
    }

    if (!mediaUrl || !contentType) {
      return {
        ok: false,
        status: "unsupported",
        message: "Chromecast LOAD에 사용할 media URL 또는 contentType이 없습니다.",
        canFallback: true
      };
    }

    if (context.options.mediaFilePath && !contentType) {
      contentType = getContentTypeForPath(context.options.mediaFilePath);
    }

    context.emit({
      connectionId: context.connectionId,
      deviceId: context.device.id,
      connector: "chromecast",
      status: "media-loading",
      step: "LOAD media",
      message: "Chromecast Default Media Receiver에 LOAD 메시지를 보냅니다.",
      details: { contentType }
    });
    const status = await client.loadMedia(mediaUrl, contentType, context.options.streamType ?? "BUFFERED");

    return {
      ok: true,
      status: "playing",
      message: "Chromecast에 미디어 LOAD 요청을 보냈습니다.",
      canFallback: false,
      details: {
        mediaSessionId: status?.mediaSessionId,
        playerState: status?.playerState,
        streamType: context.options.streamType
      }
    };
  },
  async stop(connectionId): Promise<ConnectorResult> {
    const client = activeCastClients.get(connectionId);
    if (client) {
      await client.stopMedia().catch(() => undefined);
      client.close();
      activeCastClients.delete(connectionId);
    }

    return {
      ok: true,
      status: "stopped",
      message: "Chromecast media STOP 및 연결 정리를 요청했습니다.",
      canFallback: false
    };
  }
};

async function waitForStreamSourceReady(source: ScreenStreamSource, context: ConnectorContext) {
  if (source.strategy === "hls") {
    context.emit({
      connectionId: context.connectionId,
      deviceId: context.device.id,
      connector: "chromecast",
      status: "media-loading",
      step: "HLS ready wait",
      message: "HLS playlist와 첫 segment 생성을 기다립니다."
    });
    await waitForHlsReady(source.id, 18000);
    context.emit({
      connectionId: context.connectionId,
      deviceId: context.device.id,
      connector: "chromecast",
      status: "media-loading",
      step: "stream-url-health-check",
      message: "Mac 내부에서 HLS stream URL에 접근 가능한지 확인합니다.",
      details: { url: source.url, strategy: source.strategy }
    });
    await verifyLocalStreamUrl(source.url);
    context.emit({
      connectionId: context.connectionId,
      deviceId: context.device.id,
      connector: "chromecast",
      status: "media-loading",
      step: "HLS ready",
      message: "HLS stream URL health check가 통과했습니다.",
      details: { url: source.url }
    });
    return;
  }

  context.emit({
    connectionId: context.connectionId,
    deviceId: context.device.id,
    connector: "chromecast",
    status: "media-loading",
    step: "WebM init wait",
    message: "WebM init/header chunk 생성을 기다립니다."
  });
  await waitForWebMReady(source.id, 7000);
  context.emit({
    connectionId: context.connectionId,
    deviceId: context.device.id,
    connector: "chromecast",
    status: "media-loading",
    step: "stream-url-health-check",
    message: "Mac 내부에서 WebM stream URL에 접근 가능한지 확인합니다.",
    details: { url: source.url, strategy: source.strategy }
  });
  await verifyScreenStreamUrl(source.url);
}

async function loadChromecastSource(client: CastV2Client, source: ScreenStreamSource, context: ConnectorContext) {
  context.emit({
    connectionId: context.connectionId,
    deviceId: context.device.id,
    connector: "chromecast",
    status: "media-loading",
    step: "LOAD media",
    message: `Chromecast에 ${source.strategy.toUpperCase()} LIVE stream LOAD를 보냅니다.`,
    details: { contentType: source.contentType, url: source.url }
  });
  const status = await client.loadMedia(source.url, source.contentType, "LIVE");
  context.emit({
    connectionId: context.connectionId,
    deviceId: context.device.id,
    connector: "chromecast",
    status: status?.playerState === "IDLE" && status.idleReason === "ERROR" ? "failed" : "media-loading",
    step: "MEDIA_STATUS initial",
    message: `Chromecast initial media status: ${status?.playerState ?? "unknown"}${status?.idleReason ? ` / ${status.idleReason}` : ""}`,
    details: {
      mediaSessionId: status?.mediaSessionId,
      playerState: status?.playerState,
      idleReason: status?.idleReason,
      errorCode: status?.errorCode,
      errorReason: status?.errorReason,
      strategy: source.strategy
    }
  });

  if (status?.playerState === "PLAYING") return status;
  const followUpStatus = await client
    .waitForMediaStatus(12000, (nextStatus) => nextStatus.playerState === "PLAYING" || nextStatus.playerState === "IDLE" || nextStatus.idleReason === "ERROR")
    .catch((error) => {
    context.emit({
      connectionId: context.connectionId,
      deviceId: context.device.id,
      connector: "chromecast",
      status: "failed",
      step: "MEDIA_STATUS timeout",
      message: "Chromecast가 LOAD 이후 재생 상태를 제때 보고하지 않았습니다.",
      details: { error: error instanceof Error ? error.message : String(error), strategy: source.strategy }
    });
    return undefined;
  });

  if (followUpStatus) {
    context.emit({
      connectionId: context.connectionId,
      deviceId: context.device.id,
      connector: "chromecast",
      status: followUpStatus.playerState === "IDLE" && followUpStatus.idleReason === "ERROR" ? "failed" : followUpStatus.playerState === "PLAYING" ? "playing" : "media-loading",
      step: "MEDIA_STATUS follow-up",
      message: `Chromecast follow-up media status: ${followUpStatus.playerState ?? "unknown"}${followUpStatus.idleReason ? ` / ${followUpStatus.idleReason}` : ""}`,
      details: {
        mediaSessionId: followUpStatus.mediaSessionId,
        playerState: followUpStatus.playerState,
        idleReason: followUpStatus.idleReason,
        errorCode: followUpStatus.errorCode,
        errorReason: followUpStatus.errorReason,
        strategy: source.strategy
      }
    });
  }

  if (!followUpStatus) {
    throw new Error("Chromecast가 stream LOAD 이후 PLAYING 상태를 보고하지 않았습니다.");
  }
  if (followUpStatus.playerState === "IDLE" && followUpStatus.idleReason === "ERROR") {
    throw new Error(`Chromecast media status ERROR: ${followUpStatus.errorCode ?? followUpStatus.errorReason ?? "unknown"}`);
  }

  return followUpStatus ?? status;
}
