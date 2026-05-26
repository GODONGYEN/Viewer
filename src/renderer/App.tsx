import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { HostFoundPayloadSchema, JoinPayload, JoinPayloadSchema, PIN_TTL_MS, SIGNALING_PORT } from "../shared/schemas";
import { getDeviceMergeKey, getTvActions, getTvConnectionGuide, mergeTvDevices } from "../shared/tvActions";
import type { TVAction, TVDevice, TVDiscoveryStatus } from "../shared/tvTypes";
import type { ScreenStreamOptions, ScreenStreamSource, TVConnectionAction, TVConnectionEvent, TVConnectionStatus } from "../shared/tvConnectionTypes";
import {
  chooseBestRecorderMimeType,
  normalizeCaptureError,
  startDesktopSourceCapture,
  startDisplayMediaCapture,
  stopScreenCapture
} from "./screenCapture";
import type { ScreenCaptureMethod, ScreenCaptureSource } from "./screenCapture";

type Mode = "home" | "host" | "viewer" | "tv";

type HostRequest = {
  requestId: string;
  viewerName: string;
  status: "pending" | "accepted" | "connecting" | "connected" | "failed" | "disconnected" | "rejected";
};

type SignalPayload =
  | { kind: "offer"; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; candidate: RTCIceCandidateInit };

const HOST_STALE_MS = 6000;
const TV_STALE_MS = 45000;

function createPin() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function createHostId() {
  return crypto.randomUUID();
}

function getInitialMode(): Mode {
  const mode = new URLSearchParams(window.location.search).get("mode");
  return mode === "host" || mode === "viewer" || mode === "tv" ? mode : "home";
}

function toWebSocketUrl(input: string, fallbackPort = SIGNALING_PORT) {
  const trimmed = input.trim();
  const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(withScheme);

  if (!url.port) {
    url.port = String(fallbackPort);
  }

  url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
  url.pathname = "/";
  return url.toString();
}

function createPeerConnection() {
  return new RTCPeerConnection({ iceServers: [] });
}

function parseMessage(event: MessageEvent) {
  try {
    return JSON.parse(event.data as string) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isDiscoveryHost(value: unknown): value is LanDiscoveryHost {
  return HostFoundPayloadSchema.safeParse(value).success;
}

function formatAge(timestamp: number, now: number) {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  return seconds === 0 ? "방금 전" : `${seconds}초 전`;
}

function formatExpires(timestamp: number, now: number) {
  const seconds = Math.max(0, Math.round((timestamp - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

function chooseDefaultAddress(networkInfo: LanNetworkInfo | null) {
  return networkInfo?.addresses.find((entry) => !entry.likelyVirtual)?.address ?? networkInfo?.addresses[0]?.address ?? "";
}

function getSelectedAddress(networkInfo: LanNetworkInfo | null, selectedAddress: string) {
  return networkInfo?.addresses.find((entry) => entry.address === selectedAddress) ?? networkInfo?.addresses[0] ?? null;
}

function wsUrlForAddress(address: string, port = SIGNALING_PORT) {
  return `ws://${address || "127.0.0.1"}:${port}`;
}

function createJoinPayload(params: {
  hostId: string;
  hostName: string;
  wsUrl: string;
  ipAddress: string;
  expiresAt: number;
  pin?: string;
}) {
  const payload: JoinPayload = {
    type: "LAN_SCREEN_SHARE_JOIN",
    version: 1,
    hostId: params.hostId,
    hostName: params.hostName,
    wsUrl: params.wsUrl,
    ipAddress: params.ipAddress,
    pinRequired: true,
    expiresAt: params.expiresAt
  };

  if (params.pin) {
    payload.pin = params.pin;
  }

  return payload;
}

function hostFromJoinPayload(payload: JoinPayload): LanDiscoveryHost {
  return {
    type: "SCREEN_SHARE_HOST",
    version: 1,
    hostId: payload.hostId,
    hostName: payload.hostName,
    wsUrl: payload.wsUrl,
    ipAddress: payload.ipAddress,
    pinRequired: payload.pinRequired,
    expiresAt: payload.expiresAt,
    remoteAddress: payload.ipAddress,
    lastSeenAt: Date.now()
  };
}

export default function App() {
  const [mode, setMode] = useState<Mode>(() => getInitialMode());
  const [logs, setLogs] = useState<string[]>([]);
  const [signalingStatus, setSignalingStatus] = useState<SignalingStatus>({ status: "starting" });
  const [signalingPort, setSignalingPort] = useState(SIGNALING_PORT);

  const [hostPin, setHostPin] = useState("");
  const [pinExpiresAt, setPinExpiresAt] = useState(0);
  const [hostRequests, setHostRequests] = useState<HostRequest[]>([]);
  const [isSharing, setIsSharing] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [hostNetworkInfo, setHostNetworkInfo] = useState<LanNetworkInfo | null>(null);
  const [selectedNetworkAddress, setSelectedNetworkAddress] = useState("");
  const [qrIncludesPin, setQrIncludesPin] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [connectionData, setConnectionData] = useState("");

  const [viewerHostAddress, setViewerHostAddress] = useState(`http://localhost:${SIGNALING_PORT}`);
  const [viewerPin, setViewerPin] = useState("");
  const [viewerStatus, setViewerStatus] = useState("같은 Wi-Fi에서 화면 공유 찾는 중...");
  const [viewerWebRtcStatus, setViewerWebRtcStatus] = useState("closed");
  const [viewerSignalingStatus, setViewerSignalingStatus] = useState("disconnected");
  const [discoveryStatus, setDiscoveryStatus] = useState("검색 중");
  const [discoveryStartedAt, setDiscoveryStartedAt] = useState(0);
  const [discoveryError, setDiscoveryError] = useState("");
  const [discoveredHosts, setDiscoveredHosts] = useState<Record<string, LanDiscoveryHost>>({});
  const [selectedHost, setSelectedHost] = useState<LanDiscoveryHost | null>(null);
  const [discoveryPin, setDiscoveryPin] = useState("");
  const [qrPasteData, setQrPasteData] = useState("");
  const [qrPasteMessage, setQrPasteMessage] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [tvDevices, setTvDevices] = useState<Record<string, TVDevice>>({});
  const [tvStatus, setTvStatus] = useState<TVDiscoveryStatus>({ status: "idle" });
  const [selectedTv, setSelectedTv] = useState<TVDevice | null>(null);
  const [tvActionMessage, setTvActionMessage] = useState("");
  const [showDlnaExperiment, setShowDlnaExperiment] = useState(false);
  const [tvConnectionEvents, setTvConnectionEvents] = useState<TVConnectionEvent[]>([]);
  const [activeTvConnectionId, setActiveTvConnectionId] = useState<string>("");
  const [screenStreamOptions, setScreenStreamOptions] = useState<ScreenStreamOptions>({ strategy: "auto", resolution: "720p", fps: 15, bitrateMbps: 2 });
  const [screenPreviewActive, setScreenPreviewActive] = useState(false);
  const [lastScreenStreamSources, setLastScreenStreamSources] = useState<ScreenStreamSource[]>([]);
  const [screenStreamDiagnostics, setScreenStreamDiagnostics] = useState<ScreenStreamDiagnostics | null>(null);
  const [captureSources, setCaptureSources] = useState<ScreenCaptureSource[]>([]);
  const [showCaptureSourcePicker, setShowCaptureSourcePicker] = useState(false);
  const [captureStatusMessage, setCaptureStatusMessage] = useState("");
  const [captureEnvironmentInfo, setCaptureEnvironmentInfo] = useState<ScreenCaptureEnvironmentInfo | null>(null);

  const hostIdRef = useRef(createHostId());
  const hostSocketRef = useRef<WebSocket | null>(null);
  const viewerSocketRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const tvScreenPreviewRef = useRef<HTMLVideoElement | null>(null);
  const hostPeerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const viewerPeerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const viewerRequestIdRef = useRef<string | null>(null);
  const tvScreenRecorderRef = useRef<MediaRecorder | null>(null);
  const tvScreenStreamRef = useRef<MediaStream | null>(null);
  const tvScreenStreamIdsRef = useRef<string[]>([]);
  const captureSourceResolverRef = useRef<((source: ScreenCaptureSource | null) => void) | null>(null);

  function addLog(message: string) {
    setLogs((current) => [`${new Date().toLocaleTimeString()} ${message}`, ...current].slice(0, 80));
  }

  function registerHost(socket: WebSocket, pin: string, expiresAt: number, hostName = "LAN Screen Host") {
    socket.send(JSON.stringify({ type: "host-register", pin, pinExpiresAt: expiresAt, hostName }));
  }

  function updateHostRequestStatus(requestId: string, status: HostRequest["status"]) {
    setHostRequests((current) => current.map((request) => (request.requestId === requestId ? { ...request, status } : request)));
  }

  function logPeerState(pc: RTCPeerConnection, side: "Host" | "Viewer", requestId?: string) {
    const suffix = requestId ? `(${requestId.slice(0, 8)})` : "";

    pc.oniceconnectionstatechange = () => {
      addLog(`${side} ICE 상태${suffix}: ${pc.iceConnectionState}`);
      if (side === "Host" && requestId && pc.iceConnectionState === "failed") updateHostRequestStatus(requestId, "failed");
      if (side === "Viewer" && pc.iceConnectionState === "failed") {
        setViewerWebRtcStatus("failed");
        setViewerStatus("ICE 연결 실패. 같은 네트워크, 방화벽, VPN, AP isolation을 확인하세요.");
      }
    };

    pc.onconnectionstatechange = () => {
      addLog(`${side} PeerConnection 상태${suffix}: ${pc.connectionState}`);
      if (side === "Host" && requestId) {
        if (pc.connectionState === "connected") updateHostRequestStatus(requestId, "connected");
        if (pc.connectionState === "connecting") updateHostRequestStatus(requestId, "connecting");
        if (pc.connectionState === "failed") updateHostRequestStatus(requestId, "failed");
        if (pc.connectionState === "disconnected" || pc.connectionState === "closed") updateHostRequestStatus(requestId, "disconnected");
      }
      if (side === "Viewer") {
        setViewerWebRtcStatus(pc.connectionState);
        if (pc.connectionState === "connected") setViewerStatus("화면 수신 중");
        if (pc.connectionState === "failed") setViewerStatus("WebRTC 연결 실패. 수동 연결 또는 QR fallback을 확인하세요.");
        if (pc.connectionState === "disconnected") setViewerStatus("Host 연결이 끊겼습니다.");
      }
    };

    pc.onsignalingstatechange = () => addLog(`${side} signalingState${suffix}: ${pc.signalingState}`);
    pc.onicegatheringstatechange = () => addLog(`${side} iceGatheringState${suffix}: ${pc.iceGatheringState}`);
    pc.onnegotiationneeded = () => addLog(`${side} negotiationneeded${suffix}`);
  }

  useEffect(() => {
    window.lanViewer?.getSignalingStatus().then((status) => {
      setSignalingStatus(status);
      if (status.port) {
        setSignalingPort(status.port);
        setViewerHostAddress((current) =>
          current === `http://localhost:${SIGNALING_PORT}` || current === `ws://localhost:${SIGNALING_PORT}` ? `http://localhost:${status.port}` : current
        );
      }
    });

    const unsubscribe = window.lanViewer?.onSignalingStatus((status) => {
      setSignalingStatus(status);
      if (status.port) setSignalingPort(status.port);
      if (status.status === "running") addLog(`Signaling server running on port ${status.port}`);
      if (status.status === "error") addLog(`Signaling server error: ${status.message ?? "unknown error"}`);
    });

    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    window.screenCapture?.getEnvironmentInfo().then(setCaptureEnvironmentInfo).catch(() => {
      setCaptureEnvironmentInfo(null);
    });
  }, []);

  useEffect(() => {
    if (mode === "host" && !hostSocketRef.current) {
      void startHost();
    }
  }, [mode, signalingPort]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (mode !== "viewer") return;

    setViewerStatus("같은 Wi-Fi에서 화면 공유 찾는 중...");
    setDiscoveryStatus("검색 중");
    setDiscoveryStartedAt(Date.now());
    setDiscoveryError("");
    setDiscoveredHosts({});

    const unsubscribe = window.lanDiscovery?.onHostFound((host) => {
      if (!isDiscoveryHost(host)) return;

      setDiscoveryStatus("Host 발견됨");
      setDiscoveredHosts((current) => ({
        ...current,
        [host.hostId]: host
      }));
    });

    const unsubscribeEvents = window.lanDiscovery?.onEvent((event) => {
      if (!event || typeof event.message !== "string") return;

      if (event.type === "viewer-discovery-error") {
        setDiscoveryStatus("discovery 수신 오류");
        setDiscoveryError(event.message);
        addLog(`Discovery 수신 오류: ${event.message}`);
        return;
      }

      if (event.type === "host-broadcast-received") {
        addLog("Host broadcast received");
        return;
      }

      if (event.type === "invalid-packet") {
        addLog("Invalid discovery packet ignored");
        return;
      }

      addLog(event.message);
    });

    window.lanDiscovery
      ?.startViewerDiscovery()
      .then(() => setDiscoveryStatus("검색 중"))
      .catch((error) => {
        setDiscoveryStatus("discovery 수신 오류");
        setDiscoveryError(error instanceof Error ? error.message : "알 수 없는 오류");
        addLog(`LAN 탐색 시작 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
      });

    const timer = window.setInterval(() => {
      setDiscoveredHosts((current) => {
        const next: Record<string, LanDiscoveryHost> = {};
        const cutoff = Date.now() - HOST_STALE_MS * 2;

        for (const [hostId, host] of Object.entries(current)) {
          if (host.lastSeenAt >= cutoff && host.expiresAt > Date.now()) {
            next[hostId] = host;
          } else {
            addLog("Host expired from list");
          }
        }

        return next;
      });
    }, 1000);

    return () => {
      window.clearInterval(timer);
      unsubscribe?.();
      unsubscribeEvents?.();
      void window.lanDiscovery?.stopViewerDiscovery();
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== "tv") return;

    window.tvDiscovery?.getTvDiscoveryStatus().then(setTvStatus);
    const unsubscribeConnection = window.tvConnection?.onConnectionEvent((event) => {
      setTvConnectionEvents((current) => [event, ...current].slice(0, 80));
      addLog(`TV 연결: ${event.connector} / ${event.status} / ${event.step}`);
    });
    const unsubscribeDevice = window.tvDiscovery?.onTvDeviceFound((device) => {
      const key = getDeviceMergeKey(device);
      setTvDevices((current) => ({
        ...current,
        [key]: mergeTvDevices(current[key], device)
      }));
      setSelectedTv((current) => {
        if (!current || getDeviceMergeKey(current) !== key) return current;
        return mergeTvDevices(current, device);
      });
      addLog(`TV 발견: ${device.name} (${device.protocol})`);
    });
    const unsubscribeStatus = window.tvDiscovery?.onTvDiscoveryStatus((status) => {
      setTvStatus(status);
      if (status.message) addLog(status.message);
    });
    const staleTimer = window.setInterval(() => {
      setTvDevices((current) => {
        const cutoff = Date.now() - TV_STALE_MS;
        const next: Record<string, TVDevice> = {};

        for (const [key, device] of Object.entries(current)) {
          if (device.lastSeenAt >= cutoff) {
            next[key] = device;
          } else {
            addLog(`TV 목록에서 만료됨: ${device.name}`);
          }
        }

        return next;
      });
    }, 5000);

    return () => {
      window.clearInterval(staleTimer);
      unsubscribeConnection?.();
      unsubscribeDevice?.();
      unsubscribeStatus?.();
      void window.tvDiscovery?.stopTvDiscovery();
      void window.tvConnection?.stopAllConnections();
      void stopChromecastScreenStream();
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== "viewer") return;
    if (Object.keys(discoveredHosts).length > 0) {
      setDiscoveryStatus("Host 발견됨");
      return;
    }

    const elapsed = now - discoveryStartedAt;
    if (discoveryStartedAt && elapsed >= 15000) {
      setDiscoveryStatus("수동 연결 권장");
      return;
    }

    if (discoveryStartedAt && elapsed >= 5000) {
      setDiscoveryStatus("일정 시간 동안 발견 안 됨");
    }
  }, [discoveredHosts, discoveryStartedAt, mode, now]);

  useEffect(() => {
    if (!selectedTv) return;
    const updated = tvDevices[getDeviceMergeKey(selectedTv)];
    if (!updated) {
      setSelectedTv(null);
      return;
    }
    if (updated !== selectedTv) {
      setSelectedTv(updated);
    }
  }, [selectedTv, tvDevices]);

  useEffect(() => {
    if (!isSharing || !hostNetworkInfo) {
      setQrDataUrl("");
      setConnectionData("");
      return;
    }

    const selectedAddress = getSelectedAddress(hostNetworkInfo, selectedNetworkAddress);
    if (!selectedAddress) return;

    const payload = createJoinPayload({
      hostId: hostIdRef.current,
      hostName: hostNetworkInfo.hostName,
      wsUrl: wsUrlForAddress(selectedAddress.address, signalingPort),
      ipAddress: selectedAddress.address,
      expiresAt: pinExpiresAt,
      pin: qrIncludesPin ? hostPin : undefined
    });
    const serialized = JSON.stringify(payload);
    setConnectionData(serialized);

    QRCode.toDataURL(serialized, { margin: 1, width: 220 })
      .then(setQrDataUrl)
      .catch(() => {
        setQrDataUrl("");
        addLog("QR 코드 생성에 실패했습니다.");
      });
  }, [hostNetworkInfo, hostPin, isSharing, pinExpiresAt, qrIncludesPin, selectedNetworkAddress, signalingPort]);

  async function loadNetworkInfo() {
    const networkInfo = await window.lanDiscovery?.getLocalNetworkInfo();
    if (networkInfo) {
      setHostNetworkInfo(networkInfo);
      setSelectedNetworkAddress((current) => {
        if (current && networkInfo.addresses.some((entry) => entry.address === current)) {
          return current;
        }

        return chooseDefaultAddress(networkInfo);
      });
    }
    return networkInfo ?? null;
  }

  async function startHost() {
    const pin = createPin();
    const expiresAt = Date.now() + PIN_TTL_MS;
    const networkInfo = await loadNetworkInfo();
    const hostName = networkInfo?.hostName ?? "LAN Screen Host";
    const socket = new WebSocket(`ws://localhost:${signalingPort}`);

    setMode("host");
    setHostPin(pin);
    setPinExpiresAt(expiresAt);
    setHostRequests([]);
    setIsBroadcasting(false);
    addLog("Host 모드 시작: 시그널링 서버에 등록합니다.");

    socket.onopen = () => {
      registerHost(socket, pin, expiresAt, hostName);
      addLog("Host WebSocket 연결됨.");
    };

    socket.onmessage = async (event) => {
      const message = parseMessage(event);
      if (!message) return;

      if (message.type === "host-registered") {
        if (typeof message.pinExpiresAt === "number") {
          setPinExpiresAt(message.pinExpiresAt);
        }
        addLog("Host 등록 완료. PIN은 Host 화면에만 표시됩니다.");
      }

      if (message.type === "viewer-request" && typeof message.requestId === "string") {
        setHostRequests((current) => [
          ...current,
          {
            requestId: message.requestId as string,
            viewerName: typeof message.viewerName === "string" ? message.viewerName : "Viewer",
            status: "pending"
          }
        ]);
        addLog("새 Viewer 연결 요청이 도착했습니다.");
      }

      if (message.type === "signal" && typeof message.requestId === "string") {
        await handleHostSignal(message.requestId, message.data as SignalPayload);
      }

      if (message.type === "peer-disconnected" || message.type === "viewer-left") {
        if (typeof message.requestId === "string") {
          closeHostPeer(message.requestId);
          addLog("Viewer 연결이 종료되었습니다.");
        }
      }

      if (message.type === "error" && typeof message.message === "string") {
        addLog(`서버 오류: ${message.message}`);
      }
    };

    socket.onerror = () => addLog("Host WebSocket 오류. 서버가 실행 중인지 확인하세요.");
    socket.onclose = () => addLog("Host WebSocket 연결 종료.");
    hostSocketRef.current = socket;
  }

  async function startSharing() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });
      const networkInfo = hostNetworkInfo ?? (await loadNetworkInfo());
      const selectedAddress = getSelectedAddress(networkInfo, selectedNetworkAddress);
      const nextPin = createPin();
      const expiresAt = Date.now() + PIN_TTL_MS;
      const hostName = networkInfo?.hostName ?? "LAN Screen Host";
      const wsUrl = wsUrlForAddress(selectedAddress?.address ?? "", signalingPort);

      if (hostSocketRef.current?.readyState === WebSocket.OPEN) {
        registerHost(hostSocketRef.current, nextPin, expiresAt, hostName);
      }

      setHostPin(nextPin);
      setPinExpiresAt(expiresAt);
      localStreamRef.current = stream;
      setIsSharing(true);
      addLog("화면 캡처 권한이 허용되어 공유 스트림이 준비되었습니다.");

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      await window.lanDiscovery?.startHostBroadcast({
        type: "SCREEN_SHARE_HOST",
        version: 1,
        hostId: hostIdRef.current,
        hostName,
        wsUrl,
        ipAddress: selectedAddress?.address ?? "127.0.0.1",
        pinRequired: true,
        expiresAt
      });
      setIsBroadcasting(true);
      addLog(`LAN 자동 탐색 broadcast 시작: ${wsUrl}`);

      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        stopSharing();
      });
    } catch (error) {
      addLog(`화면 공유 시작 실패: ${error instanceof Error ? error.message : "권한이 거절되었습니다."}`);
    }
  }

  function stopSharing() {
    for (const track of localStreamRef.current?.getTracks() ?? []) {
      track.stop();
    }

    localStreamRef.current = null;
    setIsSharing(false);
    setIsBroadcasting(false);
    void window.lanDiscovery?.stopHostBroadcast();

    for (const requestId of hostPeerConnectionsRef.current.keys()) {
      hostSocketRef.current?.send(JSON.stringify({ type: "disconnect-peer", requestId }));
      closeHostPeer(requestId);
    }

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    addLog("화면 공유와 LAN 자동 탐색을 중지했습니다.");
  }

  async function regeneratePin() {
    if (!hostSocketRef.current || hostSocketRef.current.readyState !== WebSocket.OPEN) {
      addLog("PIN 재생성 실패: Host WebSocket이 연결되어 있지 않습니다.");
      return;
    }

    const networkInfo = hostNetworkInfo ?? (await loadNetworkInfo());
    const selectedAddress = getSelectedAddress(networkInfo, selectedNetworkAddress);
    const nextPin = createPin();
    const expiresAt = Date.now() + PIN_TTL_MS;
    const hostName = networkInfo?.hostName ?? "LAN Screen Host";

    registerHost(hostSocketRef.current, nextPin, expiresAt, hostName);
    setHostPin(nextPin);
    setPinExpiresAt(expiresAt);
    addLog("새 PIN을 생성했습니다.");

    if (isBroadcasting && selectedAddress) {
      await window.lanDiscovery?.startHostBroadcast({
        type: "SCREEN_SHARE_HOST",
        version: 1,
        hostId: hostIdRef.current,
        hostName,
        wsUrl: wsUrlForAddress(selectedAddress.address, signalingPort),
        ipAddress: selectedAddress.address,
        pinRequired: true,
        expiresAt
      });
      addLog("Discovery와 QR 만료 시간을 새 PIN 기준으로 갱신했습니다.");
    }
  }

  function acceptRequest(requestId: string) {
    if (!localStreamRef.current) {
      addLog("화면 공유를 먼저 시작해야 Viewer를 수락할 수 있습니다.");
      return;
    }

    hostSocketRef.current?.send(JSON.stringify({ type: "host-decision", requestId, accepted: true }));
    updateHostRequestStatus(requestId, "accepted");
    addLog("Viewer 요청을 수락했습니다. WebRTC 협상을 기다립니다.");
  }

  function rejectRequest(requestId: string) {
    hostSocketRef.current?.send(JSON.stringify({ type: "host-decision", requestId, accepted: false }));
    updateHostRequestStatus(requestId, "rejected");
    addLog("Viewer 요청을 거절했습니다.");
  }

  function disconnectHostViewer(requestId: string) {
    hostSocketRef.current?.send(JSON.stringify({ type: "disconnect-peer", requestId }));
    closeHostPeer(requestId);
    updateHostRequestStatus(requestId, "disconnected");
    addLog("선택한 Viewer 연결을 종료했습니다.");
  }

  async function handleHostSignal(requestId: string, data: SignalPayload) {
    if (!localStreamRef.current || data.kind !== "offer") {
      if (data.kind === "ice") {
        const pc = hostPeerConnectionsRef.current.get(requestId);
        await pc?.addIceCandidate(data.candidate);
      }
      return;
    }

    const pc = createPeerConnection();
    hostPeerConnectionsRef.current.set(requestId, pc);
    updateHostRequestStatus(requestId, "connecting");
    logPeerState(pc, "Host", requestId);

    for (const track of localStreamRef.current.getTracks()) {
      pc.addTrack(track, localStreamRef.current);
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        hostSocketRef.current?.send(
          JSON.stringify({ type: "signal", requestId, data: { kind: "ice", candidate: event.candidate.toJSON() } })
        );
      }
    };

    await pc.setRemoteDescription(data.sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    hostSocketRef.current?.send(
      JSON.stringify({ type: "signal", requestId, data: { kind: "answer", sdp: pc.localDescription } })
    );
    addLog("Viewer에게 WebRTC answer를 보냈습니다.");
  }

  function closeHostPeer(requestId: string) {
    hostPeerConnectionsRef.current.get(requestId)?.close();
    hostPeerConnectionsRef.current.delete(requestId);
  }

  function connectViewer(hostAddress = viewerHostAddress, pin = viewerPin) {
    let socketUrl: string;

    try {
      socketUrl = toWebSocketUrl(hostAddress, signalingPort);
    } catch {
      addLog("Host 주소 형식이 올바르지 않습니다.");
      return;
    }

    if (!/^\d{6}$/.test(pin)) {
      addLog("PIN은 6자리 숫자여야 합니다.");
      return;
    }

    viewerPeerConnectionRef.current?.close();
    viewerSocketRef.current?.close();

    const socket = new WebSocket(socketUrl);
    setViewerStatus("요청 중");
    setViewerSignalingStatus("connecting");
    setViewerWebRtcStatus("closed");
    addLog(`Viewer 연결 시도: ${socketUrl}`);

    socket.onopen = () => {
      setViewerSignalingStatus("connected");
      socket.send(JSON.stringify({ type: "viewer-request", pin, viewerName: "LAN Screen Viewer" }));
      addLog("Host에게 연결 요청을 보냈습니다.");
    };

    socket.onmessage = async (event) => {
      const message = parseMessage(event);
      if (!message) return;

      if (message.type === "request-pending" && typeof message.requestId === "string") {
        viewerRequestIdRef.current = message.requestId;
        setViewerStatus("Host 수락 대기 중");
        addLog("참가 요청 보냄. Host 수락 대기 중.");
      }

      if (message.type === "request-accepted" && typeof message.requestId === "string") {
        viewerRequestIdRef.current = message.requestId;
        setViewerStatus("WebRTC 연결 중");
        addLog("Host 수락됨.");
        await createViewerOffer(message.requestId);
      }

      if (message.type === "request-rejected") {
        const fallbackMessage =
          message.reason === "invalid-pin"
            ? "PIN이 올바르지 않습니다."
            : message.reason === "pin-expired"
              ? "Host의 PIN이 만료되었습니다. Host에게 PIN 재생성을 요청하세요."
              : "Host가 요청을 거절했습니다.";
        setViewerStatus("거절됨");
        addLog(typeof message.message === "string" ? message.message : fallbackMessage);
      }

      if (message.type === "signal" && typeof message.requestId === "string") {
        await handleViewerSignal(message.requestId, message.data as SignalPayload);
      }

      if (message.type === "peer-disconnected" || message.type === "host-left") {
        disconnectViewer();
        addLog("Host 연결이 종료되었습니다.");
      }

      if (message.type === "error" && typeof message.message === "string") {
        addLog(`서버 오류: ${message.message}`);
      }
    };

    socket.onerror = () => {
      setViewerStatus("연결 오류");
      setViewerSignalingStatus("error");
      addLog("Viewer WebSocket 오류. Host 주소와 같은 LAN 여부를 확인하세요.");
    };
    socket.onclose = () => {
      setViewerSignalingStatus("disconnected");
      addLog("Viewer WebSocket 연결 종료.");
    };
    viewerSocketRef.current = socket;
  }

  async function createViewerOffer(requestId: string) {
    const pc = createPeerConnection();
    viewerPeerConnectionRef.current = pc;
    setViewerWebRtcStatus("connecting");
    logPeerState(pc, "Viewer");

    pc.addTransceiver("video", { direction: "recvonly" });

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (remoteVideoRef.current && stream) {
        remoteVideoRef.current.srcObject = stream;
      }
      setViewerStatus("화면 수신 중");
      addLog("원격 화면 스트림을 수신했습니다.");
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        addLog("Viewer ICE candidate 교환 중.");
        viewerSocketRef.current?.send(
          JSON.stringify({ type: "signal", requestId, data: { kind: "ice", candidate: event.candidate.toJSON() } })
        );
      }
    };

    const offer = await pc.createOffer();
    addLog("Viewer offer 생성.");
    await pc.setLocalDescription(offer);
    viewerSocketRef.current?.send(
      JSON.stringify({ type: "signal", requestId, data: { kind: "offer", sdp: pc.localDescription } })
    );
    addLog("Host에게 WebRTC offer를 보냈습니다.");
  }

  async function handleViewerSignal(_requestId: string, data: SignalPayload) {
    const pc = viewerPeerConnectionRef.current;
    if (!pc) return;

    if (data.kind === "answer") {
      await pc.setRemoteDescription(data.sdp);
      setViewerWebRtcStatus("answer received");
      addLog("Host의 WebRTC answer를 적용했습니다.");
    }

    if (data.kind === "ice") {
      await pc.addIceCandidate(data.candidate);
      addLog("Host ICE candidate 적용.");
    }
  }

  function disconnectViewer() {
    const requestId = viewerRequestIdRef.current;
    if (requestId) {
      viewerSocketRef.current?.send(JSON.stringify({ type: "disconnect-peer", requestId }));
    }

    viewerPeerConnectionRef.current?.close();
    viewerPeerConnectionRef.current = null;
    viewerRequestIdRef.current = null;
    viewerSocketRef.current?.close();
    viewerSocketRef.current = null;
    setViewerStatus("연결 끊김");
    setViewerSignalingStatus("disconnected");
    setViewerWebRtcStatus("closed");

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  }

  function refreshDiscovery() {
    setDiscoveredHosts({});
    setDiscoveryStartedAt(Date.now());
    setDiscoveryError("");
    setQrPasteMessage("");
    setViewerStatus("같은 Wi-Fi에서 화면 공유 찾는 중...");
    setDiscoveryStatus("검색 중");
    void window.lanDiscovery?.stopViewerDiscovery().then(() => window.lanDiscovery?.startViewerDiscovery());
    addLog("LAN Host 자동 탐색을 새로고침했습니다.");
  }

  async function copyConnectionData() {
    if (!connectionData) return;

    try {
      await navigator.clipboard.writeText(connectionData);
      addLog("연결 데이터를 클립보드에 복사했습니다.");
    } catch {
      addLog("클립보드 복사에 실패했습니다. 연결 데이터를 직접 선택해 복사하세요.");
    }
  }

  function applyQrConnectionData() {
    let parsed: unknown;

    try {
      parsed = JSON.parse(qrPasteData);
    } catch {
      setQrPasteMessage("연결 데이터 형식이 올바르지 않습니다.");
      return;
    }

    const result = JoinPayloadSchema.safeParse(parsed);
    if (!result.success) {
      setQrPasteMessage("연결 정보가 만료되었거나 형식이 올바르지 않습니다.");
      return;
    }

    const host = hostFromJoinPayload(result.data);
    setSelectedHost(host);
    setViewerHostAddress(host.wsUrl);
    setDiscoveredHosts((current) => ({ ...current, [host.hostId]: host }));
    setDiscoveryPin(result.data.pin ?? "");
    setViewerPin(result.data.pin ?? "");
    setQrPasteMessage(result.data.pin ? "PIN 포함 연결 데이터를 적용했습니다. Host 수락은 여전히 필요합니다." : "연결 데이터를 적용했습니다. PIN을 입력하세요.");
    setDiscoveryStatus("Host 발견됨");
    addLog("QR/연결 데이터로 Host 정보를 불러왔습니다.");
  }

  function resetToHome() {
    stopSharing();
    hostSocketRef.current?.close();
    hostSocketRef.current = null;
    disconnectViewer();
    void window.tvDiscovery?.stopTvDiscovery();
    setMode("home");
  }

  function startTvSearch() {
    setTvDevices({});
    setSelectedTv(null);
    setTvActionMessage("");
    setShowDlnaExperiment(false);
    setTvConnectionEvents([]);
    setActiveTvConnectionId("");
    setTvStatus({ status: "searching", startedAt: Date.now(), message: "Searching with mDNS and SSDP." });
    void window.tvDiscovery?.startTvDiscovery();
    addLog("TV 탐색을 시작했습니다. mDNS와 SSDP를 사용합니다.");
  }

  function stopTvSearch() {
    void window.tvDiscovery?.stopTvDiscovery();
    setTvStatus({ status: "stopped", message: "TV discovery stopped." });
    addLog("TV 탐색을 중지했습니다.");
  }

  function selectTv(device: TVDevice) {
    setSelectedTv(device);
    setTvActionMessage("");
    setShowDlnaExperiment(false);
    setTvConnectionEvents([]);
  }

  function formatList(values: string[] | undefined, fallback: string) {
    return values?.length ? values.join(", ") : fallback;
  }

  async function copyTvDeviceInfo(device: TVDevice) {
    const payload = {
      name: device.name,
      ipAddress: device.ipAddress,
      protocols: device.protocols ?? [device.protocol],
      discoveryMethods: device.discoveryMethods ?? [device.discoveryMethod],
      serviceTypes: device.serviceTypes ?? (device.serviceType ? [device.serviceType] : []),
      location: device.location,
      note: "This is diagnostic connection metadata only. It does not grant access or bypass TV approval."
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setTvActionMessage("기기 정보를 클립보드에 복사했습니다.");
    addLog(`TV 기기 정보 복사: ${device.name}`);
  }

  async function handleTvAction(action: TVAction, device: TVDevice) {
    if (action.disabled) {
      setTvActionMessage(action.description);
      return;
    }

    if (action.id === "copy-device-info") {
      await copyTvDeviceInfo(device);
      return;
    }

    if (action.id === "open-display-settings") {
      const result = await window.tvDiscovery?.openMacDisplaySettings();
      setTvActionMessage(result?.ok ? "macOS 디스플레이 설정을 열었습니다. TV 선택은 사용자가 직접 해야 합니다." : result?.message ?? "설정을 열 수 없습니다.");
      return;
    }

    if (action.id === "open-screen-recording-settings") {
      const result = await window.tvDiscovery?.openMacScreenRecordingSettings();
      setTvActionMessage(result?.ok ? "macOS 화면 기록 권한 설정을 열었습니다. 권한 허용은 사용자가 직접 해야 합니다." : result?.message ?? "설정을 열 수 없습니다.");
      return;
    }

    if (action.id === "dlna-media-experiment") {
      setShowDlnaExperiment(true);
      await startTvConnection(device, "play-dlna-media");
      return;
    }

    if (action.id === "airplay-start") {
      await startTvConnection(device, "airplay-start");
      return;
    }

    if (action.id === "chromecast-connect") {
      await startTvConnection(device, "connect");
      return;
    }

    if (action.id === "chromecast-test-media") {
      await startTvConnection(device, "cast-test-media");
      return;
    }

    if (action.id === "chromecast-screen-experiment") {
      await startTvConnection(device, "start-screen-cast-experiment");
      return;
    }

    if (action.id === "miracast-start") {
      await startTvConnection(device, "miracast-start");
      return;
    }

    if (action.id === "cast-stop") {
      await stopActiveTvConnection();
      return;
    }

    setTvActionMessage(action.description);
  }

  async function startTvConnection(device: TVDevice, action: TVConnectionAction = "connect") {
    let mediaFilePath: string | undefined;
    let testMediaUrl: string | undefined;
    let contentType: string | undefined;
    let streamType: "BUFFERED" | "LIVE" | undefined;
    let screenStreamSources: ScreenStreamSource[] | undefined;

    if (action === "play-dlna-media" || action === "cast-test-media") {
      const selected = await window.tvConnection?.selectDlnaMedia();
      if (!selected?.ok || !selected.filePath) {
        setTvActionMessage(selected?.message ?? "미디어 파일 선택이 취소되었습니다.");
        return;
      }
      mediaFilePath = selected.filePath;
      setTvActionMessage(`${selected.fileName} 파일을 ${action === "play-dlna-media" ? "DLNA TV" : "Chromecast"}로 재생 요청합니다.`);
    }

    if (action === "start-screen-cast-experiment") {
      const screenStream = await startChromecastScreenStream(device, screenStreamOptions);
      if (!screenStream) return;
      screenStreamSources = screenStream.sources;
      setLastScreenStreamSources(screenStream.sources);
      testMediaUrl = screenStream.sources[0]?.url;
      contentType = screenStream.sources[0]?.contentType;
      streamType = "LIVE";
    }

    const response = await window.tvConnection?.connectToTv({
      device,
      options: { action, mediaFilePath, testMediaUrl, contentType, streamType, screenStreamStrategy: screenStreamOptions.strategy, screenStreamOptions, screenStreamSources }
    });
    if (!response?.ok || !response.connectionId) {
      setTvActionMessage(response?.message ?? "TV 연결 시도를 시작하지 못했습니다.");
      return;
    }

    setActiveTvConnectionId(response.connectionId);
    setTvActionMessage("TV 직접 연결 시도를 시작했습니다. 아래 타임라인에서 진행 상태를 확인하세요.");
  }

  function resolveCaptureSource(source: ScreenCaptureSource | null) {
    captureSourceResolverRef.current?.(source);
    captureSourceResolverRef.current = null;
    setShowCaptureSourcePicker(false);
  }

  async function chooseCaptureSource(sources: ScreenCaptureSource[]) {
    setCaptureSources(sources);
    setShowCaptureSourcePicker(true);
    return new Promise<ScreenCaptureSource | null>((resolve) => {
      captureSourceResolverRef.current = resolve;
    });
  }

  async function obtainScreenCaptureStream(): Promise<{ stream: MediaStream; method: ScreenCaptureMethod; sourceName?: string } | null> {
    setCaptureStatusMessage("기본 getDisplayMedia로 화면 캡처를 시작합니다.");
    const displayMediaResult = await startDisplayMediaCapture();
    if (displayMediaResult.ok) {
      setCaptureStatusMessage("기본 getDisplayMedia 경로로 화면 캡처가 시작되었습니다.");
      return displayMediaResult;
    }

    setCaptureStatusMessage(displayMediaResult.error.message);
    if (!displayMediaResult.error.shouldTryElectronFallback || !window.screenCapture?.getSources) {
      setTvActionMessage(`화면 캡처 시작 실패: ${displayMediaResult.error.message}`);
      return null;
    }

    try {
      const sources = await window.screenCapture.getSources();
      if (!sources.length) {
        setTvActionMessage("Electron desktopCapturer가 선택 가능한 화면/창을 찾지 못했습니다.");
        setCaptureStatusMessage("선택 가능한 화면/창이 없습니다. macOS 화면 기록 권한 또는 Electron 권한을 확인하세요.");
        return null;
      }

      setCaptureStatusMessage("기본 화면 캡처가 지원되지 않아 Electron 화면 선택 방식으로 전환합니다.");
      const selectedSource = await chooseCaptureSource(sources);
      if (!selectedSource) {
        setCaptureStatusMessage("화면/창 선택이 취소되었습니다.");
        setTvActionMessage("화면 스트림 캐스팅을 취소했습니다.");
        return null;
      }

      const fallbackResult = await startDesktopSourceCapture(selectedSource);
      if (fallbackResult.ok) {
        setCaptureStatusMessage(`${selectedSource.name} 소스를 Electron desktopCapturer fallback으로 캡처합니다.`);
        return fallbackResult;
      }

      setCaptureStatusMessage(fallbackResult.error.message);
      setTvActionMessage(`화면 캡처 시작 실패: ${fallbackResult.error.message}`);
      return null;
    } catch (error) {
      const normalized = normalizeCaptureError(error);
      setCaptureStatusMessage(normalized.message);
      setTvActionMessage(`화면 캡처 시작 실패: ${normalized.message}`);
      return null;
    }
  }

  async function startChromecastScreenStream(device: TVDevice, options: ScreenStreamOptions): Promise<{ sources: ScreenStreamSource[] } | null> {
    try {
      if (typeof MediaRecorder === "undefined") {
        setTvActionMessage("MediaRecorder가 이 Electron renderer에서 지원되지 않습니다.");
        return null;
      }
      const mimeType = chooseBestRecorderMimeType();

      const capture = await obtainScreenCaptureStream();
      if (!capture) return null;

      const { stream, method, sourceName } = capture;
      setScreenStreamDiagnostics(null);
      const strategies: Array<"hls" | "webm"> = options.strategy === "hls" ? ["hls"] : options.strategy === "webm" ? ["webm"] : ["hls", "webm"];
      const sources: ScreenStreamSource[] = [];

      for (const strategy of strategies) {
        const session = await window.tvConnection?.startScreenStream({ targetIp: device.ipAddress, deviceId: device.id, contentType: mimeType || "video/webm", strategy, options });
        if (session?.ok && session.id && session.url && session.contentType && session.strategy) {
          sources.push({ id: session.id, url: session.url, contentType: session.contentType, strategy: session.strategy });
        } else if (options.strategy !== "auto") {
          stopScreenCapture(stream);
          setTvActionMessage(session?.message ?? "화면 스트림 서버를 시작하지 못했습니다.");
          return null;
        }
      }

      if (sources.length === 0) {
        stopScreenCapture(stream);
        setTvActionMessage("HLS/WebM 화면 스트림 세션을 시작하지 못했습니다.");
        return null;
      }

      setLastScreenStreamSources(sources);

      const recorderOptions: MediaRecorderOptions = {
        videoBitsPerSecond: options.bitrateMbps * 1_000_000
      };
      if (mimeType) recorderOptions.mimeType = mimeType;
      const recorder = new MediaRecorder(stream, recorderOptions);
      tvScreenStreamRef.current = stream;
      tvScreenRecorderRef.current = recorder;
      tvScreenStreamIdsRef.current = sources.map((source) => source.id);
      setScreenPreviewActive(true);
      window.setTimeout(() => {
        if (tvScreenPreviewRef.current) {
          tvScreenPreviewRef.current.srcObject = stream;
        }
      }, 0);

      recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return;
        void event.data.arrayBuffer().then((chunk) => {
          for (const streamId of tvScreenStreamIdsRef.current) {
            void window.tvConnection?.pushScreenStreamChunk({ streamId, chunk });
          }
        });
      };
      recorder.onstart = () => {
        setTvConnectionEvents((current) => [
          {
            connectionId: activeTvConnectionId || `recorder-${Date.now()}`,
            deviceId: device.id,
            connector: "diagnostic",
            status: "media-loading",
            step: "MediaRecorder started",
            message: `MediaRecorder가 시작되었습니다. MIME=${recorder.mimeType || mimeType || "browser-default"}`,
            timestamp: Date.now()
          },
          ...current
        ]);
      };
      recorder.onerror = () => {
        setTvActionMessage("화면 스트림 MediaRecorder 오류가 발생했습니다.");
      };
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        void stopChromecastScreenStream();
      });
      recorder.start(sources.some((source) => source.strategy === "hls") ? 750 : 1000);
      const captureLabel = method === "electron-desktop-capturer" ? `Electron desktopCapturer${sourceName ? ` (${sourceName})` : ""}` : "getDisplayMedia";
      setTvConnectionEvents((current) => [
        {
          connectionId: activeTvConnectionId || `capture-${Date.now()}`,
          deviceId: device.id,
          connector: "diagnostic",
          status: "media-loading",
          step: "screen-capture",
          message: `화면 캡처 성공: ${captureLabel}`,
          timestamp: Date.now()
        },
        ...current
      ]);
      setTvActionMessage(
        `화면 캡처가 시작되었습니다. 캡처 경로: ${captureLabel}. ${sources.map((source) => source.strategy.toUpperCase()).join(" → ")} 전략으로 Chromecast LOAD를 시도합니다. Auto는 HLS를 먼저 사용합니다.`
      );
      return { sources };
    } catch (error) {
      const normalized = normalizeCaptureError(error);
      setCaptureStatusMessage(normalized.message);
      setTvActionMessage(`화면 캡처 시작 실패: ${normalized.message}`);
      return null;
    }
  }

  async function stopChromecastScreenStream() {
    if (tvScreenRecorderRef.current?.state !== "inactive") {
      tvScreenRecorderRef.current?.stop();
    }
    stopScreenCapture(tvScreenStreamRef.current);
    if (tvScreenPreviewRef.current) {
      tvScreenPreviewRef.current.srcObject = null;
    }
    tvScreenRecorderRef.current = null;
    tvScreenStreamRef.current = null;
    setScreenPreviewActive(false);
    if (tvScreenStreamIdsRef.current.length) {
      for (const streamId of tvScreenStreamIdsRef.current) {
        await window.tvConnection?.stopScreenStream(streamId);
      }
      tvScreenStreamIdsRef.current = [];
    }
  }

  async function stopActiveTvConnection() {
    if (!activeTvConnectionId) {
      setTvActionMessage("중지할 활성 TV 연결이 없습니다.");
      return;
    }
    const result = await window.tvConnection?.stopConnection(activeTvConnectionId);
    await stopChromecastScreenStream();
    setTvActionMessage(result?.ok ? "TV 연결 중지 요청을 보냈습니다." : result?.message ?? "TV 연결 중지에 실패했습니다.");
    if (result?.ok) setActiveTvConnectionId("");
  }

  function addManualTvConnectionEvent(device: TVDevice, status: TVConnectionStatus, message: string) {
    const event: TVConnectionEvent = {
      connectionId: activeTvConnectionId || `manual-${Date.now()}`,
      deviceId: device.id,
      connector: "diagnostic",
      status,
      step: "User confirmation",
      message,
      timestamp: Date.now()
    };
    setTvConnectionEvents((current) => [event, ...current].slice(0, 80));
  }

  function markScreenPreviewReady(device: TVDevice) {
    setTvConnectionEvents((current) => [
      {
        connectionId: activeTvConnectionId || `preview-${Date.now()}`,
        deviceId: device.id,
        connector: "diagnostic",
        status: "media-loading",
        step: "preview-ready",
        message: "Renderer preview video에 캡처 화면이 표시되었습니다.",
        timestamp: Date.now()
      },
      ...current
    ]);
  }

  async function copyTvFailureLog() {
    const payload = tvConnectionEvents.map((event) => ({
      time: new Date(event.timestamp).toISOString(),
      connector: event.connector,
      status: event.status,
      step: event.step,
      message: event.message,
      details: event.details
    }));
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setTvActionMessage("실패/연결 로그를 클립보드에 복사했습니다. COMPATIBILITY.md에 붙여 기록할 수 있습니다.");
  }

  async function copyStreamUrls() {
    if (lastScreenStreamSources.length === 0) {
      setTvActionMessage("복사할 화면 스트림 URL이 아직 없습니다.");
      return;
    }
    await navigator.clipboard.writeText(JSON.stringify(lastScreenStreamSources, null, 2));
    setTvActionMessage("최근 화면 스트림 URL을 클립보드에 복사했습니다.");
  }

  async function diagnoseStreamRequests() {
    if (lastScreenStreamSources.length > 0) {
      const diagnostics = await window.tvConnection?.getScreenStreamDiagnostics({ streamIds: lastScreenStreamSources.map((source) => source.id) });
      if (diagnostics?.ok) setScreenStreamDiagnostics(diagnostics);
    }
    const streamEvents = tvConnectionEvents.filter((event) => event.step.includes("stream") || event.step.includes("hls") || event.step.includes("webm") || event.step.includes("chromecast-requested"));
    const requested = streamEvents.some((event) => event.step.includes("requested") || event.step.includes("client-connected"));
    setTvActionMessage(requested ? "Chromecast/클라이언트가 스트림 URL을 요청한 기록이 있습니다. 타임라인의 HTTP 200/404 이벤트를 확인하세요." : "아직 Chromecast가 스트림 URL을 요청한 기록이 없습니다. 방화벽, AP isolation, LAN IP 접근성을 확인하세요.");
  }

  function getPrimaryTvActionLabel(device: TVDevice) {
    const protocols = device.protocols ?? [device.protocol];
    if (protocols.includes("Chromecast")) return "Cast 연결";
    if (protocols.includes("AirPlay")) return "AirPlay 연결";
    if (protocols.includes("DLNA")) return "미디어 재생";
    if (protocols.includes("Miracast possible")) return "무선 디스플레이 연결";
    return "연결 시도";
  }

  const discoveredHostList = Object.values(discoveredHosts).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  const selectedNetwork = getSelectedAddress(hostNetworkInfo, selectedNetworkAddress);
  const selectedNetworkInvalid = Boolean(hostNetworkInfo?.addresses.length && selectedNetworkAddress && !selectedNetwork);
  const pinExpired = Boolean(pinExpiresAt && now >= pinExpiresAt);
  const viewerElapsed = mode === "viewer" && discoveryStartedAt ? now - discoveryStartedAt : 0;
  const showBasicDiagnosis = mode === "viewer" && discoveredHostList.length === 0 && viewerElapsed >= 5000;
  const showDetailedDiagnosis = mode === "viewer" && discoveredHostList.length === 0 && viewerElapsed >= 15000;
  const tvDeviceList = Object.values(tvDevices).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  const selectedTvGuide = selectedTv ? getTvConnectionGuide(selectedTv) : null;
  const selectedTvActions = selectedTv ? getTvActions(selectedTv) : [];

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Consent-first LAN screen sharing</p>
          <h1>LAN Screen Viewer</h1>
          <p className="muted">
            Signaling: {signalingStatus.status}
            {signalingStatus.port ? ` :${signalingStatus.port}` : ""}
            {signalingStatus.message ? ` - ${signalingStatus.message}` : ""}
          </p>
        </div>
        <div className="button-row compact">
          <button className="ghost-button" onClick={() => void window.lanViewer?.openViewerWindow()}>
            새 Viewer 창 열기
          </button>
          {mode !== "home" && (
            <button className="ghost-button" onClick={resetToHome}>
              처음으로
            </button>
          )}
        </div>
      </section>

      {mode === "home" && (
        <section className="home-panel">
          <button className="choice-button host-choice" onClick={() => void startHost()}>
            Host로 시작
          </button>
          <button className="choice-button viewer-choice" onClick={() => setMode("viewer")}>
            Viewer로 시작
          </button>
          <button className="choice-button tv-choice" onClick={() => setMode("tv")}>
            TV Cast
          </button>
        </section>
      )}

      {mode === "host" && (
        <section className="workspace two-column">
          <div className="panel">
            <div className="panel-header">
              <h2>Host</h2>
              <span className={isSharing ? "status live" : "status"}>{isSharing ? "공유 중" : "대기 중"}</span>
            </div>

            <label>내 접속 주소</label>
            <div className="address-list">
              {selectedNetwork ? <code>{wsUrlForAddress(selectedNetwork.address, signalingPort).replace("ws://", "http://")}</code> : <code>서버 등록 대기 중...</code>}
            </div>

            <label htmlFor="network-select">공유 네트워크 선택</label>
            {hostNetworkInfo?.addresses.length ? (
              <select
                id="network-select"
                value={selectedNetworkAddress}
                onChange={(event) => setSelectedNetworkAddress(event.target.value)}
                disabled={isSharing}
              >
                {hostNetworkInfo.addresses.map((entry) => (
                  <option key={`${entry.name}-${entry.address}`} value={entry.address}>
                    {entry.name} - {entry.address}
                    {entry.likelyVirtual ? " (가상/VPN 가능)" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <div className="empty-state compact-state">
                <strong>사용 가능한 LAN IPv4를 찾지 못했습니다.</strong>
                <span>두 기기 연결은 192.168.x.x, 10.x.x.x, 172.16~31.x.x 주소가 필요합니다.</span>
              </div>
            )}
            {selectedNetworkInvalid && <p className="warning-text">선택한 IP가 더 이상 유효하지 않습니다. 네트워크를 다시 선택하세요.</p>}

            <label>사용 가능한 네트워크</label>
            <div className="network-list">
              {hostNetworkInfo?.addresses.length ? (
                hostNetworkInfo.addresses.map((entry) => (
                  <div className={entry.address === selectedNetworkAddress ? "network-item selected" : "network-item"} key={entry.address}>
                    <strong>{entry.name}</strong>
                    <span>{entry.address}</span>
                    <span>{entry.family}</span>
                    <span>{entry.internal ? "internal" : entry.likelyVirtual ? "가상/VPN 가능" : "LAN 후보"}</span>
                  </div>
                ))
              ) : (
                <code>LAN IP를 찾지 못했습니다. 수동 연결은 localhost로 테스트할 수 있습니다.</code>
              )}
            </div>

            <label>6자리 PIN</label>
            <div className="pin-row">
              <div className="pin-display">{hostPin}</div>
              <span className={pinExpired ? "status warning" : "status"}>{pinExpired ? "PIN 만료됨" : `만료 ${pinExpiresAt ? formatExpires(pinExpiresAt, now) : "--:--"}`}</span>
              <button className="ghost-button" onClick={() => void regeneratePin()}>
                PIN 재생성
              </button>
            </div>
            {pinExpired && <p className="warning-text">PIN이 만료되었습니다. 새 Viewer 요청은 거절됩니다. PIN을 재생성하세요.</p>}

            <div className="broadcast-status">
              <span className={isBroadcasting ? "status live" : "status"}>
                {isBroadcasting ? "LAN에서 나를 찾을 수 있음" : "자동 탐색 대기"}
              </span>
              <span className="muted">화면 공유 시작 후에만 Host discovery가 broadcast됩니다.</span>
            </div>

            <div className="button-row">
              <button onClick={() => void startSharing()} disabled={isSharing}>
                화면 공유 시작
              </button>
              <button className="danger-button" onClick={stopSharing} disabled={!isSharing}>
                공유 중지
              </button>
            </div>

            <video ref={localVideoRef} className="preview-video" autoPlay muted playsInline />

            {isSharing && (
              <div className="qr-panel">
                <div className="panel-header">
                  <h2>QR 연결</h2>
                  <span className="status">PIN 만료와 함께 만료</span>
                </div>
                <label className="check-row">
                  <input type="checkbox" checked={qrIncludesPin} onChange={(event) => setQrIncludesPin(event.target.checked)} />
                  PIN 포함 QR 생성
                </label>
                {qrIncludesPin && (
                  <p className="warning-text">
                    PIN 포함 QR은 같은 공간에 있는 사람이 바로 참가 요청을 보낼 수 있어 더 민감합니다. 필요한 순간에만 사용하세요.
                  </p>
                )}
                {qrDataUrl ? <img className="qr-image" src={qrDataUrl} alt="LAN screen share connection QR" /> : <div className="empty-state">QR 생성 대기 중</div>}
                <textarea readOnly value={connectionData} aria-label="연결 데이터" />
                <div className="button-row">
                  <button className="ghost-button" onClick={() => void copyConnectionData()}>
                    연결 데이터 복사
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>연결 요청</h2>
              <span className="status">{hostRequests.length}건</span>
            </div>

            <div className="request-list">
              {hostRequests.length === 0 && <p className="muted">아직 연결 요청이 없습니다.</p>}
              {hostRequests.map((request) => (
                <div className="request-item" key={request.requestId}>
                  <div>
                    <strong>{request.viewerName}</strong>
                    <span>{request.status}</span>
                  </div>
                  <div className="button-row compact">
                    <button onClick={() => acceptRequest(request.requestId)} disabled={!isSharing || request.status !== "pending"}>
                      수락
                    </button>
                    <button className="ghost-button" onClick={() => rejectRequest(request.requestId)} disabled={request.status !== "pending"}>
                      거절
                    </button>
                    <button className="danger-button" onClick={() => disconnectHostViewer(request.requestId)} disabled={request.status === "pending" || request.status === "rejected"}>
                      끊기
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="diagnosis-panel">
              <strong>Host 연결 진단</strong>
              <ul>
                <li>화면 캡처 권한 거부 시 공유 스트림이 생성되지 않습니다.</li>
                <li>Viewer별 PeerConnection 상태는 요청 카드에 표시됩니다.</li>
                <li>공유 중지를 누르면 모든 Viewer 연결이 종료됩니다.</li>
              </ul>
            </div>
          </div>
        </section>
      )}

      {mode === "viewer" && (
        <section className="workspace viewer-grid">
          <div className="panel viewer-controls">
            <div className="panel-header">
              <h2>Viewer</h2>
              <span className="status">{discoveryStatus}</span>
            </div>

            <div className="status-grid">
              <span>Signaling</span>
              <strong>{viewerSignalingStatus}</strong>
              <span>WebRTC</span>
              <strong>{viewerWebRtcStatus}</strong>
            </div>

            <div className="discovery-header">
              <p className="muted">{viewerStatus}</p>
              <div className="button-row compact">
                <button className="ghost-button" onClick={refreshDiscovery}>
                  다시 검색
                </button>
                <button className="ghost-button" onClick={() => setManualOpen(true)}>
                  수동 연결 열기
                </button>
                <button className="danger-button" onClick={disconnectViewer}>
                  연결 끊기
                </button>
              </div>
            </div>

            {discoveryError && <p className="warning-text">Discovery 수신 오류: {discoveryError}</p>}
            {(viewerSignalingStatus === "error" || viewerWebRtcStatus === "failed") && (
              <div className="diagnosis-panel">
                <strong>연결 실패 진단</strong>
                <ul>
                  <li>WebSocket 연결 실패: Host 주소와 포트가 맞는지 확인하세요.</li>
                  <li>PIN 오류 또는 PIN 만료는 Host에게 새 PIN을 요청하세요.</li>
                  <li>Host가 공유 중이 아니면 화면 트랙을 받을 수 없습니다.</li>
                  <li>ICE 연결 실패는 같은 네트워크, 방화벽, VPN, AP isolation 문제일 수 있습니다.</li>
                  <li>원격 트랙이 안 오면 QR 또는 수동 연결 fallback을 시도하세요.</li>
                </ul>
              </div>
            )}

            <div className="host-card-list">
              {discoveredHostList.length === 0 && (
                <div className="empty-state">
                  <strong>사용 가능한 화면 공유 Host가 없습니다.</strong>
                  <span>Host 앱에서 화면 공유를 시작하면 여기에 표시됩니다.</span>
                </div>
              )}

              {discoveredHostList.map((host) => {
                const stale = now - host.lastSeenAt > HOST_STALE_MS;
                return (
                  <button
                    className={selectedHost?.hostId === host.hostId ? "host-card selected" : "host-card"}
                    key={host.hostId}
                    onClick={() => {
                      setSelectedHost(host);
                      setViewerHostAddress(host.wsUrl);
                      setDiscoveryPin("");
                    }}
                  >
                    <span className="host-card-title">{host.hostName}</span>
                    <span>{host.ipAddress}</span>
                    <span>{stale ? "오프라인 확인 중" : `발견 ${formatAge(host.lastSeenAt, now)}`}</span>
                    <span>{host.pinRequired ? "PIN 필요" : "PIN 없음"}</span>
                  </button>
                );
              })}
            </div>

            {showBasicDiagnosis && (
              <div className="diagnosis-panel">
                <strong>아직 Host를 찾지 못했습니다.</strong>
                <p>Host가 화면 공유를 시작했는지 확인한 뒤 다시 검색해보세요. 자동 탐색이 막힌 네트워크라면 수동 연결이나 QR 코드 연결을 사용할 수 있습니다.</p>
                <div className="button-row">
                  <button className="ghost-button" onClick={refreshDiscovery}>
                    다시 검색
                  </button>
                  <button className="ghost-button" onClick={() => setManualOpen(true)}>
                    수동 연결 열기
                  </button>
                </div>
              </div>
            )}

            {showDetailedDiagnosis && (
              <div className="diagnosis-panel detailed">
                <strong>자동 탐색 진단 체크리스트</strong>
                <ul>
                  <li>Host와 Viewer가 같은 Wi-Fi인지 확인하세요.</li>
                  <li>게스트 Wi-Fi가 아닌지 확인하세요.</li>
                  <li>AP isolation 또는 client isolation이 꺼져 있는지 확인하세요.</li>
                  <li>macOS/Windows 방화벽이 UDP broadcast를 막고 있지 않은지 확인하세요.</li>
                  <li>VPN이 켜져 있다면 잠시 끄거나 올바른 네트워크 인터페이스를 선택하세요.</li>
                  <li>학교/회사 네트워크에서는 UDP broadcast가 차단될 수 있습니다.</li>
                  <li>자동 탐색이 안 되면 수동 연결 또는 QR 코드 연결을 사용하세요.</li>
                </ul>
                <p className="muted">QR 코드로 연결: Host 화면의 QR 또는 연결 데이터를 Viewer의 QR/연결 데이터 입력칸에 붙여넣으세요.</p>
              </div>
            )}

            {selectedHost && (
              <div className="join-box">
                <strong>{selectedHost.hostName} 참가 요청</strong>
                <span className="muted">{selectedHost.wsUrl}</span>
                <label htmlFor="discovery-pin">PIN</label>
                <input
                  id="discovery-pin"
                  value={discoveryPin}
                  maxLength={6}
                  inputMode="numeric"
                  onChange={(event) => setDiscoveryPin(event.target.value.replace(/\D/g, ""))}
                />
                <div className="button-row">
                  <button onClick={() => connectViewer(selectedHost.wsUrl, discoveryPin)} disabled={!/^\d{6}$/.test(discoveryPin)}>
                    참가 요청
                  </button>
                  <button className="ghost-button" onClick={() => setSelectedHost(null)}>
                    취소
                  </button>
                </div>
              </div>
            )}

            <details className="manual-connect" open>
              <summary>QR 코드로 연결</summary>
              <p className="muted">카메라 스캔은 다음 단계로 남겨두고, MVP에서는 Host의 연결 데이터를 붙여넣어 사용합니다.</p>
              <label htmlFor="qr-paste">QR/연결 데이터 붙여넣기</label>
              <textarea
                id="qr-paste"
                value={qrPasteData}
                placeholder='{"type":"LAN_SCREEN_SHARE_JOIN", ...}'
                onChange={(event) => setQrPasteData(event.target.value)}
              />
              <div className="button-row">
                <button className="ghost-button" onClick={applyQrConnectionData}>
                  연결 데이터 적용
                </button>
              </div>
              {qrPasteMessage && <p className="muted">{qrPasteMessage}</p>}
            </details>

            <details className="manual-connect" open={manualOpen} onToggle={(event) => setManualOpen(event.currentTarget.open)}>
              <summary>수동 연결</summary>

              <label htmlFor="host-address">Host 주소</label>
              <input
                id="host-address"
                value={viewerHostAddress}
                placeholder="예: http://192.168.0.12:4173"
                onChange={(event) => setViewerHostAddress(event.target.value)}
              />

              <label htmlFor="pin">PIN</label>
              <input
                id="pin"
                value={viewerPin}
                maxLength={6}
                inputMode="numeric"
                onChange={(event) => setViewerPin(event.target.value.replace(/\D/g, ""))}
              />

              <div className="button-row">
                <button onClick={() => connectViewer()} disabled={!/^\d{6}$/.test(viewerPin)}>
                  연결 요청
                </button>
                <button className="danger-button" onClick={disconnectViewer}>
                  연결 끊기
                </button>
              </div>
            </details>
          </div>

          <div className="remote-stage">
            <video ref={remoteVideoRef} autoPlay playsInline />
            <span className="stage-label">{viewerStatus}</span>
          </div>
        </section>
      )}

      {mode === "tv" && (
        <section className="workspace tv-grid">
          <div className="panel tv-controls">
            <div className="panel-header">
              <h2>TV Cast</h2>
              <span className="status">{tvStatus.status === "searching" ? "검색 중" : tvStatus.status}</span>
            </div>

            <p className="muted">
              같은 Wi-Fi/LAN의 AirPlay, Chromecast/Google Cast, DLNA/UPnP 가능 기기를 찾고, 허용된 프로토콜로 직접 연결을 시도합니다. TV 승인과 OS 권한은 우회하지 않습니다.
            </p>

            <div className="button-row">
              <button onClick={startTvSearch}>주변 TV 찾기</button>
              <button className="ghost-button" onClick={startTvSearch}>
                새로고침
              </button>
              <button className="danger-button" onClick={stopTvSearch}>
                중지
              </button>
            </div>

            {tvStatus.message && <p className="muted">{tvStatus.message}</p>}

            <div className="host-card-list">
              {tvDeviceList.length === 0 && (
                <div className="empty-state">
                  <strong>발견된 TV가 없습니다.</strong>
                  <span>TV의 AirPlay, Chromecast, DLNA 기능이 켜져 있고 같은 Wi-Fi에 있는지 확인하세요.</span>
                </div>
              )}

              {tvDeviceList.map((device) => (
                <div className={selectedTv && getDeviceMergeKey(selectedTv) === getDeviceMergeKey(device) ? "host-card selected tv-device-card" : "host-card tv-device-card"} key={getDeviceMergeKey(device)}>
                  <button className="card-main-button" onClick={() => selectTv(device)}>
                    <span className="host-card-title">{device.name}</span>
                    <span>{formatAge(device.lastSeenAt, now)}</span>
                    <span>{device.ipAddress || "IP 확인 중"}</span>
                    <span>{formatList(device.discoveryMethods, device.discoveryMethod)}</span>
                    <span>{device.connectable === "media-only" ? "미디어 재생 적합" : device.connectable === "guide-only" ? "직접/OS 연결 시도" : "확인 필요"}</span>
                    <span className="badge-row">
                      {(device.protocols ?? [device.protocol]).map((protocol) => (
                        <span className="protocol-badge" key={protocol}>
                          {protocol}
                        </span>
                      ))}
                    </span>
                  </button>
                  <button className="ghost-button compact-action" onClick={() => void startTvConnection(device)}>
                    {getPrimaryTvActionLabel(device)}
                  </button>
                </div>
              ))}
            </div>

            <div className="diagnosis-panel detailed">
              <strong>TV 탐색 진단</strong>
              <ul>
                <li>Host PC와 TV가 같은 Wi-Fi/LAN인지 확인하세요.</li>
                <li>게스트 네트워크나 AP isolation은 mDNS/SSDP를 막을 수 있습니다.</li>
                <li>TV의 AirPlay, Chromecast, DLNA/UPnP 기능이 켜져 있는지 확인하세요.</li>
                <li>VPN이나 방화벽이 UDP 5353(mDNS), UDP 1900(SSDP)을 막을 수 있습니다.</li>
                <li>Miracast는 Windows 무선 디스플레이 기능이 우선이며 macOS/Electron에서 직접 구현하지 않습니다.</li>
              </ul>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>연결 안내</h2>
              <span className="status">{selectedTv ? formatList(selectedTv.protocols, selectedTv.protocol) : "선택 대기"}</span>
            </div>

            {!selectedTv && <p className="muted">발견된 TV를 선택하면 지원 가능 프로토콜과 권장 연결 방법을 표시합니다.</p>}

            {selectedTv && selectedTvGuide && (
              <div className="tv-guide">
                <h3>{selectedTv.name}</h3>

                <div className="status-grid">
                  <span>IP</span>
                  <strong>{selectedTv.ipAddress || "알 수 없음"}</strong>
                  <span>탐지 방식</span>
                  <strong>{formatList(selectedTv.discoveryMethods, selectedTv.discoveryMethod)}</strong>
                  <span>추정 프로토콜</span>
                  <strong>{formatList(selectedTv.protocols, selectedTv.protocol)}</strong>
                  <span>raw type</span>
                  <strong>{formatList(selectedTv.serviceTypes, selectedTv.serviceType ?? "확인 안 됨")}</strong>
                  <span>연결 가능성</span>
                  <strong>{selectedTv.connectable === "media-only" ? "미디어 재생 중심" : selectedTv.connectable === "guide-only" ? "공식 연결 안내" : "확인 필요"}</strong>
                </div>

                <div className="diagnosis-panel">
                  <strong>권장 연결 방법</strong>
                  <p>{selectedTv.recommendedAction}</p>
                  <ul>
                    {selectedTvGuide.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                </div>

                <div className="tv-action-panel">
                  <strong>직접 연결 시도</strong>
                  <p className="muted">앱이 감지된 프로토콜 우선순위에 따라 connector를 선택하고, 실패하면 가능한 fallback connector를 이어서 시도합니다.</p>
                  <div className="button-row">
                    <button onClick={() => void startTvConnection(selectedTv)}>직접 연결 시도</button>
                    {(selectedTv.protocols ?? [selectedTv.protocol]).includes("DLNA") && (
                      <button className="ghost-button" onClick={() => void startTvConnection(selectedTv, "play-dlna-media")}>
                        DLNA로 시도
                      </button>
                    )}
                    {(selectedTv.protocols ?? [selectedTv.protocol]).includes("Chromecast") && (
                      <button className="ghost-button" onClick={() => void startTvConnection(selectedTv, "cast-test-media")}>
                        Chromecast로 다시 시도
                      </button>
                    )}
                    <button className="danger-button" onClick={() => void stopActiveTvConnection()}>
                      연결 중지
                    </button>
                  </div>
                </div>

                {(selectedTv.protocols ?? [selectedTv.protocol]).includes("Chromecast") && (
                  <div className="tv-action-panel">
                    <strong>Chromecast 화면 스트림 옵션</strong>
                    <div className="stream-option-grid">
                      <label>
                        방식
                        <select
                          value={screenStreamOptions.strategy}
                          onChange={(event) => setScreenStreamOptions((current) => ({ ...current, strategy: event.target.value as ScreenStreamOptions["strategy"] }))}
                        >
                          <option value="auto">Auto(HLS 우선)</option>
                          <option value="webm">WebM live</option>
                          <option value="hls">HLS fallback</option>
                        </select>
                      </label>
                      <label>
                        해상도
                        <select
                          value={screenStreamOptions.resolution}
                          onChange={(event) => setScreenStreamOptions((current) => ({ ...current, resolution: event.target.value as ScreenStreamOptions["resolution"] }))}
                        >
                          <option value="720p">720p</option>
                          <option value="1080p">1080p</option>
                        </select>
                      </label>
                      <label>
                        FPS
                        <select
                          value={screenStreamOptions.fps}
                          onChange={(event) => setScreenStreamOptions((current) => ({ ...current, fps: Number(event.target.value) as ScreenStreamOptions["fps"] }))}
                        >
                          <option value={15}>15</option>
                          <option value={30}>30</option>
                        </select>
                      </label>
                      <label>
                        비트레이트
                        <select
                          value={screenStreamOptions.bitrateMbps}
                          onChange={(event) => setScreenStreamOptions((current) => ({ ...current, bitrateMbps: Number(event.target.value) as ScreenStreamOptions["bitrateMbps"] }))}
                        >
                          <option value={2}>2 Mbps</option>
                          <option value={4}>4 Mbps</option>
                          <option value={6}>6 Mbps</option>
                        </select>
                      </label>
                    </div>
                    <div className="button-row">
                      <button onClick={() => void startTvConnection(selectedTv, "start-screen-cast-experiment")}>Chromecast 화면 스트림 시작</button>
                      <button className="ghost-button" onClick={() => void diagnoseStreamRequests()}>스트림 URL 진단</button>
                      <button className="ghost-button" onClick={() => void copyStreamUrls()}>스트림 URL 복사</button>
                      <button className="danger-button" onClick={() => void stopActiveTvConnection()}>
                        화면 스트림 중지
                      </button>
                    </div>
                    <p className="muted">공유할 화면은 다음 단계에서 OS 선택 창으로 직접 고릅니다. Chromecast 안정성을 위해 Auto는 HLS를 먼저 시도합니다. 기본은 720p / 15fps / 2 Mbps입니다.</p>
                    {captureStatusMessage && <p className="muted capture-status">{captureStatusMessage}</p>}
                    {captureEnvironmentInfo?.platform === "darwin" && (
                      <div className="button-row compact">
                        <button className="ghost-button" onClick={() => void window.screenCapture?.openScreenRecordingSettings()}>
                          macOS 화면 기록 권한 열기
                        </button>
                      </div>
                    )}
                    {screenPreviewActive && (
                      <div className="screen-preview">
                        <video ref={tvScreenPreviewRef} autoPlay muted playsInline onLoadedMetadata={() => markScreenPreviewReady(selectedTv)} />
                      </div>
                    )}
                    {lastScreenStreamSources.length > 0 && (
                      <div className="stream-diagnostics">
                        <strong>최근 stream URL</strong>
                        <ul>
                          {lastScreenStreamSources.map((source) => (
                            <li key={source.id}>
                              <span>{source.strategy.toUpperCase()}</span>
                              <code>{source.url}</code>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {screenStreamDiagnostics && (
                      <div className="stream-diagnostics">
                        <strong>스트림 진단</strong>
                        {[...screenStreamDiagnostics.hls, ...screenStreamDiagnostics.webm].map((session) => (
                          <div className="stream-diagnostic-card" key={`${session.strategy}:${session.id}`}>
                            <div>
                              <span>{session.strategy.toUpperCase()}</span>
                              <strong>{session.exists ? "세션 있음" : "세션 없음"}</strong>
                            </div>
                            {"playlistReady" in session ? (
                              <p>
                                HLS ready: playlist {session.playlistReady ? "OK" : "대기"} / segment {session.segmentReady ? `OK(${session.segmentCount})` : "대기"}
                              </p>
                            ) : (
                              <p>
                                WebM ready: init {session.initChunkReady ? "OK" : "대기"} / queued chunks {session.queuedChunks} / clients {session.clients}
                              </p>
                            )}
                            {session.recentRequests.length === 0 ? (
                              <p className="muted">아직 Chromecast HTTP 요청 기록이 없습니다.</p>
                            ) : (
                              <ol>
                                {session.recentRequests.slice(0, 6).map((request) => (
                                  <li key={`${request.timestamp}:${request.path}:${request.status}`}>
                                    <span>{new Date(request.timestamp).toLocaleTimeString()}</span> <strong>HTTP {request.status}</strong> {request.method} {request.path}
                                  </li>
                                ))}
                              </ol>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="tv-action-panel">
                  <strong>프로토콜별 액션</strong>
                  <div className="tv-action-grid">
                    {selectedTvActions.map((action) => (
                      <button
                        className={action.availability === "experimental" ? "ghost-button experimental-action" : "ghost-button"}
                        disabled={action.disabled}
                        key={`${action.id}:${action.protocol ?? "common"}`}
                        onClick={() => void handleTvAction(action, selectedTv)}
                        title={action.description}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                  {tvActionMessage && <p className="muted">{tvActionMessage}</p>}
                </div>

                <div className="connection-timeline">
                  <strong>연결 상태 타임라인</strong>
                  <div className="button-row">
                    <button className="ghost-button" onClick={() => void copyTvFailureLog()}>
                      실패 로그 복사
                    </button>
                    <button className="ghost-button" onClick={() => addManualTvConnectionEvent(selectedTv, "playing", "사용자가 TV 연결 성공을 확인했습니다.")}>
                      연결됨으로 표시
                    </button>
                    <button className="ghost-button" onClick={() => addManualTvConnectionEvent(selectedTv, "failed", "사용자가 TV 연결 실패를 기록했습니다.")}>
                      실패로 표시
                    </button>
                  </div>
                  {tvConnectionEvents.length === 0 && <p className="muted">아직 연결 시도 로그가 없습니다.</p>}
                  <ol>
                    {tvConnectionEvents.map((event) => (
                      <li key={`${event.connectionId}:${event.timestamp}:${event.step}`}>
                        <span>{new Date(event.timestamp).toLocaleTimeString()}</span>
                        <strong>
                          {event.connector} / {event.status}
                        </strong>
                        <p>{event.step}: {event.message}</p>
                      </li>
                    ))}
                  </ol>
                </div>

                {showDlnaExperiment && (
                  <div className="diagnosis-panel">
                    <strong>DLNA 미디어 재생</strong>
                    <p>
                      파일 선택은 main process dialog에서 수행되고, 로컬 HTTP 서버와 AVTransport SOAP으로 TV 재생을 시도합니다. TV 코덱/펌웨어에 따라 실패할 수 있습니다.
                    </p>
                    <p className="muted">지원 후보: mp4, m4v, mov, mp3, jpg, png. DRM/보호 콘텐츠 우회는 지원하지 않습니다.</p>
                  </div>
                )}

                <div className="split-lists">
                  <div className="diagnosis-panel">
                    <strong>가능한 것</strong>
                    <ul>
                      {selectedTvGuide.possibleActions.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="diagnosis-panel">
                    <strong>아직 불가능한 것</strong>
                    <ul>
                      {selectedTvGuide.unavailableActions.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="diagnosis-panel">
                  <strong>보안/권한 안내</strong>
                  <ul>
                    {selectedTvGuide.securityNotes.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>

                <details className="debug-details">
                  <summary>디버그 discovery 정보</summary>
                  <pre>{JSON.stringify({ details: selectedTv.details, location: selectedTv.location, raw: selectedTv.raw }, null, 2)}</pre>
                </details>
              </div>
            )}
          </div>
        </section>
      )}

      {showCaptureSourcePicker && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="화면 선택">
          <div className="source-picker-panel">
            <div className="panel-header">
              <div>
                <h2>화면 또는 창 선택</h2>
                <p className="muted">기본 화면 캡처가 지원되지 않아 Electron 화면 선택 방식으로 전환합니다. 공유할 화면/창을 직접 선택하세요.</p>
              </div>
              <button className="ghost-button" onClick={() => resolveCaptureSource(null)}>
                취소
              </button>
            </div>

            <div className="source-grid">
              {captureSources.map((source) => (
                <button className="source-card" key={source.id} onClick={() => resolveCaptureSource(source)}>
                  {source.thumbnailDataUrl ? <img alt="" src={source.thumbnailDataUrl} /> : <div className="source-thumbnail-placeholder" />}
                  <strong>{source.name}</strong>
                  <span>{source.displayId ? `display ${source.displayId}` : "window/screen"}</span>
                  <small>이 화면 공유</small>
                </button>
              ))}
            </div>

            <div className="diagnosis-panel">
              <strong>macOS 권한 확인</strong>
              <p>소스 선택 후에도 실패하면 화면 기록 권한이 없거나 아직 적용되지 않았을 수 있습니다. 권한을 허용한 뒤 앱을 재시작해야 할 수 있습니다.</p>
              <button className="ghost-button" onClick={() => void window.screenCapture?.openScreenRecordingSettings()}>
                macOS 화면 기록 권한 열기
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="log-panel">
        <div className="panel-header">
          <h2>상태 로그</h2>
          <button className="ghost-button" onClick={() => setLogs([])}>
            지우기
          </button>
        </div>
        <ol>
          {logs.length === 0 ? <li>로그가 여기에 표시됩니다.</li> : logs.map((log, index) => <li key={`${log}-${index}`}>{log}</li>)}
        </ol>
      </section>
    </main>
  );
}
