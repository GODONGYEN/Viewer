import { TVConnectionOptions, TVConnectorAttempt, TVConnectorKind } from "./tvConnectionTypes";
import { TVDevice, TVProtocol } from "./tvTypes";

const PROTOCOL_CONNECTORS: Array<{ protocol: TVProtocol; connector: TVConnectorKind }> = [
  { protocol: "Chromecast", connector: "chromecast" },
  { protocol: "AirPlay", connector: "airplay" },
  { protocol: "DLNA", connector: "dlna" },
  { protocol: "Miracast possible", connector: "miracast" }
];

export function getTvConnectorPlan(device: TVDevice, options: TVConnectionOptions = {}): TVConnectorAttempt[] {
  const protocols = device.protocols ?? [device.protocol];
  const requested = options.action;

  return PROTOCOL_CONNECTORS.filter(({ protocol }) => protocols.includes(protocol)).map(({ protocol, connector }) => {
    if (requested === "cast-test-media" || requested === "start-screen-cast-experiment") {
      return {
        protocol,
        connector,
        canAttempt: connector === "chromecast",
        reason: connector === "chromecast" ? undefined : "Chromecast 전용 요청입니다."
      };
    }

    if (requested === "play-dlna-media") {
      return {
        protocol,
        connector,
        canAttempt: connector === "dlna",
        reason: connector === "dlna" ? undefined : "DLNA 미디어 재생 전용 요청입니다."
      };
    }

    if (requested === "airplay-start") {
      return {
        protocol,
        connector,
        canAttempt: connector === "airplay",
        reason: connector === "airplay" ? undefined : "AirPlay 연결 흐름 전용 요청입니다."
      };
    }

    if (requested === "miracast-start") {
      return {
        protocol,
        connector,
        canAttempt: connector === "miracast",
        reason: connector === "miracast" ? undefined : "Miracast 연결 흐름 전용 요청입니다."
      };
    }

    return { protocol, connector, canAttempt: true };
  });
}
