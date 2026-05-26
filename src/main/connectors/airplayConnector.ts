import { clipboard, shell } from "electron";
import { ConnectorContext, ConnectorResult, TVConnector } from "./types";

export const airplayConnector: TVConnector = {
  kind: "airplay",
  canHandle(device, options) {
    const protocols = device.protocols ?? [device.protocol];
    return protocols.includes("AirPlay") && ["connect", "airplay-start", undefined].includes(options.action);
  },
  async connect(context: ConnectorContext): Promise<ConnectorResult> {
    clipboard.writeText(context.device.name);
    context.emit({
      connectionId: context.connectionId,
      deviceId: context.device.id,
      connector: "airplay",
      status: "connecting",
      step: "AirPlay OS flow",
      message: `"${context.device.name}" TV 이름을 복사하고 macOS 화면 미러링 설정을 엽니다. TV 선택과 코드는 사용자가 직접 승인해야 합니다.`
    });

    if (process.platform !== "darwin") {
      return {
        ok: false,
        status: "unsupported",
        message: "AirPlay 연결 흐름은 macOS에서만 시작할 수 있습니다. 현재 OS에서는 AirPlay connector를 사용할 수 없습니다.",
        canFallback: true
      };
    }

    await shell.openExternal("x-apple.systempreferences:com.apple.Displays-Settings.extension");

    return {
      ok: true,
      status: "user-action-required",
      message: "macOS 디스플레이 설정을 열었습니다. Screen Mirroring에서 복사된 TV 이름을 찾아 직접 선택하세요.",
      canFallback: false,
      details: { copiedDeviceName: true }
    };
  },
  async stop(): Promise<ConnectorResult> {
    return {
      ok: true,
      status: "stopped",
      message: "AirPlay 연결 흐름을 앱 상태에서 중지했습니다. 실제 미러링 종료는 macOS Screen Mirroring 메뉴에서 수행하세요.",
      canFallback: false
    };
  }
};
