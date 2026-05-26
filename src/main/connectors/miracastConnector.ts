import { clipboard, shell } from "electron";
import { ConnectorContext, ConnectorResult, TVConnector } from "./types";

export const miracastConnector: TVConnector = {
  kind: "miracast",
  canHandle(device, options) {
    const protocols = device.protocols ?? [device.protocol];
    return protocols.includes("Miracast possible") && ["connect", "miracast-start", undefined].includes(options.action);
  },
  async connect(context: ConnectorContext): Promise<ConnectorResult> {
    clipboard.writeText(context.device.name);
    context.emit({
      connectionId: context.connectionId,
      deviceId: context.device.id,
      connector: "miracast",
      status: "connecting",
      step: "Miracast OS flow",
      message: `"${context.device.name}" TV 이름을 복사하고 OS의 무선 디스플레이 연결 화면을 열려고 시도합니다.`
    });

    if (process.platform === "win32") {
      await shell.openExternal("ms-settings:project");
      return {
        ok: true,
        status: "user-action-required",
        message: "Windows 무선 디스플레이 연결 화면을 열었습니다. TV 선택과 승인은 사용자가 직접 해야 합니다.",
        canFallback: false
      };
    }

    if (process.platform === "darwin") {
      await shell.openExternal("x-apple.systempreferences:com.apple.Displays-Settings.extension");
      return {
        ok: false,
        status: "unsupported",
        message: "macOS에서는 Miracast 직접 송신을 지원하지 않습니다. AirPlay 가능 TV라면 AirPlay 연결 흐름을 사용하세요.",
        canFallback: true
      };
    }

    return {
      ok: false,
      status: "unsupported",
      message: "현재 OS에서 Miracast 연결 화면을 자동으로 열 수 없습니다.",
      canFallback: true
    };
  }
};
