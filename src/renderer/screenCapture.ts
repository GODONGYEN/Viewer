export type ScreenCaptureMethod = "getDisplayMedia" | "electron-desktop-capturer";

export type ScreenCaptureSource = {
  id: string;
  name: string;
  thumbnailDataUrl?: string;
  displayId?: string;
};

export type ScreenCaptureSupport = {
  hasMediaDevices: boolean;
  hasGetDisplayMedia: boolean;
  hasGetUserMedia: boolean;
  hasMediaRecorder: boolean;
  isSecureContext: boolean;
};

export type CaptureErrorReason = "not-supported" | "permission-denied" | "not-found" | "constraints" | "security" | "unknown";

export type NormalizedCaptureError = {
  reason: CaptureErrorReason;
  name: string;
  message: string;
  originalMessage: string;
  shouldTryElectronFallback: boolean;
};

export type ScreenCaptureResult =
  | {
      ok: true;
      stream: MediaStream;
      method: ScreenCaptureMethod;
      sourceName?: string;
    }
  | {
      ok: false;
      error: NormalizedCaptureError;
    };

type CaptureEnvironment = {
  navigator?: Pick<Navigator, "mediaDevices">;
  MediaRecorder?: typeof MediaRecorder;
  isSecureContext?: boolean;
};

export function getScreenCaptureSupport(environment: CaptureEnvironment = globalThis) {
  const mediaDevices = environment.navigator?.mediaDevices;
  return {
    hasMediaDevices: Boolean(mediaDevices),
    hasGetDisplayMedia: typeof mediaDevices?.getDisplayMedia === "function",
    hasGetUserMedia: typeof mediaDevices?.getUserMedia === "function",
    hasMediaRecorder: typeof environment.MediaRecorder !== "undefined",
    isSecureContext: environment.isSecureContext !== false
  } satisfies ScreenCaptureSupport;
}

export function chooseBestRecorderMimeType(isTypeSupported: (mimeType: string) => boolean = (mimeType) => MediaRecorder.isTypeSupported(mimeType)) {
  const candidates = ["video/webm;codecs=vp8", "video/webm;codecs=vp9", "video/webm"];
  return candidates.find(isTypeSupported) ?? "";
}

export function isValidCaptureSource(source: unknown): source is ScreenCaptureSource {
  if (!source || typeof source !== "object") return false;
  const candidate = source as Partial<ScreenCaptureSource>;
  return typeof candidate.id === "string" && candidate.id.length > 0 && typeof candidate.name === "string" && candidate.name.length > 0;
}

export function normalizeCaptureError(error: unknown): NormalizedCaptureError {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "UnknownError";
  const originalMessage = error instanceof DOMException || error instanceof Error ? error.message : String(error);
  const lowerMessage = originalMessage.toLowerCase();

  if (name === "NotSupportedError" || lowerMessage.includes("not supported")) {
    return {
      reason: "not-supported",
      name,
      originalMessage,
      message: "현재 Electron 환경에서 기본 getDisplayMedia가 지원되지 않아 Electron 화면 선택 방식으로 전환합니다.",
      shouldTryElectronFallback: true
    };
  }

  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return {
      reason: "permission-denied",
      name,
      originalMessage,
      message: "사용자가 화면 공유를 취소했거나 macOS 화면 기록 권한이 없습니다.",
      shouldTryElectronFallback: true
    };
  }

  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return {
      reason: "not-found",
      name,
      originalMessage,
      message: "선택 가능한 화면/창을 찾지 못했습니다.",
      shouldTryElectronFallback: true
    };
  }

  if (name === "TypeError" || name === "OverconstrainedError") {
    return {
      reason: "constraints",
      name,
      originalMessage,
      message: "화면 캡처 constraints가 현재 환경에서 지원되지 않습니다. 단순 constraints 또는 Electron 화면 선택 방식으로 다시 시도합니다.",
      shouldTryElectronFallback: true
    };
  }

  if (name === "SecurityError") {
    return {
      reason: "security",
      name,
      originalMessage,
      message: "현재 실행 환경에서 화면 캡처가 차단되었습니다.",
      shouldTryElectronFallback: true
    };
  }

  return {
    reason: "unknown",
    name,
    originalMessage,
    message: originalMessage || "화면 캡처 시작에 실패했습니다.",
    shouldTryElectronFallback: true
  };
}

export async function startDisplayMediaCapture(): Promise<ScreenCaptureResult> {
  const support = getScreenCaptureSupport();
  if (!support.hasMediaDevices || !support.hasGetDisplayMedia) {
    return {
      ok: false,
      error: {
        reason: "not-supported",
        name: "NotSupportedError",
        originalMessage: "navigator.mediaDevices.getDisplayMedia is not available",
        message: "현재 Electron 환경에서 기본 getDisplayMedia를 사용할 수 없어 Electron 화면 선택 방식으로 전환합니다.",
        shouldTryElectronFallback: true
      }
    };
  }

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false
    });
    return { ok: true, stream, method: "getDisplayMedia" };
  } catch (error) {
    return { ok: false, error: normalizeCaptureError(error) };
  }
}

export async function startDesktopSourceCapture(source: ScreenCaptureSource): Promise<ScreenCaptureResult> {
  if (!isValidCaptureSource(source)) {
    return {
      ok: false,
      error: {
        reason: "not-found",
        name: "NotFoundError",
        originalMessage: "Invalid desktop capture source",
        message: "선택한 화면/창 정보가 올바르지 않습니다.",
        shouldTryElectronFallback: false
      }
    };
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      ok: false,
      error: {
        reason: "not-supported",
        name: "NotSupportedError",
        originalMessage: "navigator.mediaDevices.getUserMedia is not available",
        message: "현재 Electron 환경에서 desktopCapturer fallback용 getUserMedia를 사용할 수 없습니다.",
        shouldTryElectronFallback: false
      }
    };
  }

  try {
    const constraints = {
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: source.id
        }
      }
    } as unknown as MediaStreamConstraints;
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    return { ok: true, stream, method: "electron-desktop-capturer", sourceName: source.name };
  } catch (error) {
    const normalized = normalizeCaptureError(error);
    return {
      ok: false,
      error: {
        ...normalized,
        message: `Electron desktopCapturer fallback도 실패했습니다. ${normalized.message} 화면 기록 권한과 Electron 버전을 확인하세요.`,
        shouldTryElectronFallback: false
      }
    };
  }
}

export function stopScreenCapture(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((track) => track.stop());
}
