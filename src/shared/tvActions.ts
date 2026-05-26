import { TVAction, TVCapability, TVConnectionGuide, TVDevice, TVDiscoveryMethod, TVProtocol } from "./tvTypes";

const PROTOCOL_PRIORITY: TVProtocol[] = ["AirPlay", "Chromecast", "DLNA", "Miracast possible", "Unknown"];

function unique<T>(values: Array<T | undefined>) {
  return Array.from(new Set(values.filter((value): value is T => Boolean(value))));
}

export function protocolPriority(protocol: TVProtocol) {
  const index = PROTOCOL_PRIORITY.indexOf(protocol);
  return index === -1 ? PROTOCOL_PRIORITY.length : index;
}

export function getDeviceMergeKey(device: TVDevice) {
  const normalizedName = device.name.trim().toLowerCase().replace(/\s+/g, "-") || "unknown";
  return `${device.ipAddress || "unknown"}:${normalizedName}`;
}

export function getPrimaryProtocol(protocols: TVProtocol[]) {
  return [...protocols].sort((a, b) => protocolPriority(a) - protocolPriority(b))[0] ?? "Unknown";
}

export function getProtocolCapabilities(protocol: TVProtocol): TVCapability[] {
  if (protocol === "AirPlay") return ["screen-mirroring-guide", "device-info"];
  if (protocol === "Chromecast") return ["browser-cast-guide", "device-info"];
  if (protocol === "DLNA") return ["media-playback-experimental", "device-info"];
  if (protocol === "Miracast possible") return ["wireless-display-guide", "device-info"];
  return ["device-info"];
}

export function getTvConnectionGuide(device: TVDevice): TVConnectionGuide {
  const protocols = device.protocols?.length ? device.protocols : [device.protocol];
  const possibleActions: string[] = [];
  const unavailableActions: string[] = [];
  const securityNotes: string[] = [
    "이 앱은 TV 인증, OS 권한, 네트워크 보안 정책을 우회하지 않습니다.",
    "화면 공유나 캐스팅은 사용자가 OS 또는 TV 공식 UI에서 직접 승인해야 합니다."
  ];
  const steps: string[] = [];

  if (protocols.includes("AirPlay")) {
    steps.push(
      "Mac과 TV가 같은 Wi-Fi에 연결되어 있는지 확인합니다.",
      "TV에서 AirPlay가 켜져 있는지 확인합니다.",
      "macOS 메뉴 막대 또는 제어 센터에서 Screen Mirroring을 엽니다.",
      "목록에서 TV를 직접 선택합니다.",
      "TV에 코드가 표시되면 Mac에 입력합니다.",
      "종료는 macOS Screen Mirroring 메뉴에서 직접 수행합니다."
    );
    possibleActions.push("AirPlay 가능성 감지", "macOS 화면 미러링 안내", "macOS 관련 설정 열기");
    unavailableActions.push("앱에서 AirPlay 자동 연결", "사용자 승인 없는 화면 미러링");
  }

  if (protocols.includes("Chromecast")) {
    steps.push(
      "Chrome 또는 OS의 Cast 메뉴를 엽니다.",
      "감지된 Chromecast/Google TV를 선택합니다.",
      "화면 전체 미러링은 Chrome/OS가 제공하는 공식 Cast 흐름을 사용합니다."
    );
    possibleActions.push("Chromecast/Google Cast 가능성 감지", "Chrome Cast 사용 안내");
    unavailableActions.push("Electron 앱에서 즉시 전체 화면 직접 캐스팅", "Cast 인증 또는 TV 승인 우회");
  }

  if (protocols.includes("DLNA")) {
    steps.push(
      "TV의 DLNA/UPnP Media Renderer 기능이 켜져 있는지 확인합니다.",
      "DLNA는 화면 전체 미러링이 아니라 영상, 음악, 사진 파일 재생에 적합합니다.",
      "미디어 재생 실험 기능은 TV 모델별로 실패할 수 있습니다."
    );
    possibleActions.push("DLNA Media Renderer 감지", "미디어 파일 재생 실험 UI");
    unavailableActions.push("DLNA를 통한 화면 전체 미러링", "DRM/보호 콘텐츠 우회");
  }

  if (protocols.includes("Miracast possible")) {
    steps.push(
      "Windows에서는 설정의 무선 디스플레이 연결 기능을 확인합니다.",
      "macOS에서는 Miracast보다 AirPlay 지원 여부를 먼저 확인합니다."
    );
    possibleActions.push("Miracast 가능성 힌트 표시", "Windows 무선 디스플레이 안내");
    unavailableActions.push("macOS/Electron에서 직접 Miracast 송신");
  }

  if (protocols.every((protocol) => protocol === "Unknown")) {
    steps.push("TV 제조사 앱 또는 OS 공식 캐스팅 기능을 확인합니다.", "자동 탐색이 부정확할 수 있으므로 기기 정보를 참고합니다.");
    possibleActions.push("기기 정보 복사", "수동 연결 방법 안내");
    unavailableActions.push("프로토콜을 모르는 상태에서 자동 연결");
  }

  return {
    title: `${device.name} 연결 안내`,
    steps: unique(steps),
    possibleActions: unique(possibleActions),
    unavailableActions: unique(unavailableActions),
    securityNotes
  };
}

export function getTvActions(device: TVDevice): TVAction[] {
  const protocols = device.protocols?.length ? device.protocols : [device.protocol];
  const actions: TVAction[] = [];

  if (protocols.includes("AirPlay")) {
    actions.push(
      {
        id: "airplay-start",
        label: "AirPlay 연결 시작",
        availability: "available",
        protocol: "AirPlay",
        description: "TV 이름을 복사하고 macOS 화면 미러링 연결 흐름을 시작합니다."
      },
      {
        id: "airplay-guide",
        label: "AirPlay 연결 방법 보기",
        availability: "guide-only",
        protocol: "AirPlay",
        description: "macOS Screen Mirroring에서 사용자가 직접 TV를 선택하는 절차를 보여줍니다."
      },
      {
        id: "open-display-settings",
        label: "macOS 디스플레이 설정 열기",
        availability: "available",
        protocol: "AirPlay",
        description: "macOS 디스플레이 설정을 엽니다. TV 선택은 사용자가 직접 해야 합니다."
      },
      {
        id: "open-screen-recording-settings",
        label: "화면 기록 권한 설정 열기",
        availability: "available",
        protocol: "AirPlay",
        description: "화면 캡처 권한 확인을 위한 macOS 개인 정보 보호 설정을 엽니다."
      }
    );
  }

  if (protocols.includes("Chromecast")) {
    actions.push(
      {
        id: "chromecast-connect",
        label: "Chromecast 직접 연결",
        availability: "experimental",
        protocol: "Chromecast",
        description: "앱 내부에서 Chromecast Cast 포트 연결과 receiver 준비 가능성을 진단합니다."
      },
      {
        id: "chromecast-test-media",
        label: "테스트 미디어 재생",
        availability: "experimental",
        protocol: "Chromecast",
        description: "Default Media Receiver 기반 테스트 미디어 재생을 시도합니다. 현재는 안전한 Cast V2 구현 상태를 먼저 진단합니다."
      },
      {
        id: "chromecast-screen-experiment",
        label: "화면 스트림 캐스팅 실험",
        availability: "experimental",
        protocol: "Chromecast",
        description: "화면 캡처 스트림을 Chromecast용 미디어 스트림으로 제공하는 실험 기능입니다."
      },
      {
        id: "chromecast-guide",
        label: "Chrome Cast 사용 방법 보기",
        availability: "guide-only",
        protocol: "Chromecast",
        description: "Chrome 또는 OS의 공식 Cast 메뉴 사용법을 안내합니다."
      },
      {
        id: "cast-stop",
        label: "Cast 중지",
        availability: "available",
        protocol: "Chromecast",
        description: "현재 앱이 시작한 TV 연결 시도를 중지합니다."
      }
    );
  }

  if (protocols.includes("DLNA")) {
    actions.push(
      {
        id: "dlna-media-experiment",
        label: "DLNA 미디어 재생",
        availability: "experimental",
        protocol: "DLNA",
        description: "로컬 미디어 파일을 선택하고 DLNA MediaRenderer에 재생 요청을 보냅니다."
      },
      {
        id: "cast-stop",
        label: "재생 중지",
        availability: "available",
        protocol: "DLNA",
        description: "현재 앱이 시작한 TV 연결 시도를 중지합니다."
      },
      {
        id: "dlna-info",
        label: "지원 정보 보기",
        availability: "guide-only",
        protocol: "DLNA",
        description: "DLNA가 화면 미러링이 아니라 미디어 재생용이라는 안내를 보여줍니다."
      }
    );
  }

  if (protocols.includes("Miracast possible")) {
    actions.push(
      {
        id: "miracast-start",
        label: "Windows 무선 디스플레이 연결 시작",
        availability: "guide-only",
        protocol: "Miracast possible",
        description: "Windows의 공식 무선 디스플레이 연결 화면을 열고 TV 이름을 복사합니다."
      },
      {
        id: "miracast-windows-guide",
        label: "Windows 무선 디스플레이 안내",
        availability: "guide-only",
        protocol: "Miracast possible",
        description: "Windows의 공식 무선 디스플레이 연결 흐름을 안내합니다."
      },
      {
        id: "airplay-on-macos-guide",
        label: "macOS에서는 AirPlay 권장",
        availability: "guide-only",
        protocol: "Miracast possible",
        description: "macOS에서는 Miracast 직접 송신 대신 AirPlay를 우선 확인하도록 안내합니다."
      }
    );
  }

  if (protocols.every((protocol) => protocol === "Unknown")) {
    actions.push({
      id: "manual-guide",
      label: "수동 연결 방법 보기",
      availability: "unsupported",
      protocol: "Unknown",
      description: "지원 프로토콜을 특정할 수 없어 제조사 공식 연결 방법을 확인하도록 안내합니다."
    });
  }

  actions.push({
    id: "copy-device-info",
    label: "기기 정보 복사",
    availability: "available",
    description: "기기 이름, IP, 탐지 방식, 추정 프로토콜 정보를 클립보드에 복사합니다."
  });

  return actions;
}

export function enrichTvDevice(device: TVDevice): TVDevice {
  const protocols = unique([...(device.protocols ?? []), device.protocol]);
  const discoveryMethods = unique([...(device.discoveryMethods ?? []), device.discoveryMethod]);
  const serviceTypes = unique([...(device.serviceTypes ?? []), device.serviceType]);
  const capabilities = unique(protocols.flatMap(getProtocolCapabilities));
  const guide = getTvConnectionGuide({ ...device, protocols, discoveryMethods, serviceTypes });

  return {
    ...device,
    protocol: getPrimaryProtocol(protocols),
    protocols,
    discoveryMethods,
    serviceTypes,
    capabilities,
    actions: getTvActions({ ...device, protocols }),
    possibleActions: guide.possibleActions,
    unavailableActions: guide.unavailableActions,
    securityNotes: guide.securityNotes
  };
}

export function mergeTvDevices(existing: TVDevice | undefined, incoming: TVDevice): TVDevice {
  if (!existing) return enrichTvDevice(incoming);

  const protocols = unique([...(existing.protocols ?? [existing.protocol]), ...(incoming.protocols ?? [incoming.protocol])]);
  const discoveryMethods = unique([...(existing.discoveryMethods ?? [existing.discoveryMethod]), ...(incoming.discoveryMethods ?? [incoming.discoveryMethod])]);
  const serviceTypes = unique([...(existing.serviceTypes ?? []), existing.serviceType, ...(incoming.serviceTypes ?? []), incoming.serviceType]);
  const raw = { ...(existing.raw ?? {}), ...(incoming.raw ?? {}) };
  const merged: TVDevice = {
    ...existing,
    ...incoming,
    id: existing.id,
    name: existing.name !== "Unknown device" ? existing.name : incoming.name,
    protocol: getPrimaryProtocol(protocols),
    protocols,
    discoveryMethod: discoveryMethods[0] ?? incoming.discoveryMethod,
    discoveryMethods,
    serviceType: serviceTypes[0],
    serviceTypes,
    details: unique([existing.details, incoming.details]).join(" / ") || undefined,
    location: incoming.location ?? existing.location,
    raw,
    lastSeenAt: Math.max(existing.lastSeenAt, incoming.lastSeenAt)
  };

  return enrichTvDevice(merged);
}
