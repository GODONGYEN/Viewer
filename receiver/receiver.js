const NAMESPACE = "urn:x-cast:com.godonghyeon.viewer.webrtc";

const context = cast.framework.CastReceiverContext.getInstance();
const statusEl = document.getElementById("status");
const videoEl = document.getElementById("remoteVideo");

let peer = null;
let senderId = null;

function setStatus(message) {
  statusEl.textContent = message;
}

function send(message) {
  if (!senderId) return;
  context.sendCustomMessage(NAMESPACE, senderId, message);
}

function closePeer() {
  if (peer) {
    peer.ontrack = null;
    peer.onicecandidate = null;
    peer.onconnectionstatechange = null;
    peer.close();
  }
  peer = null;
  videoEl.srcObject = null;
}

function ensurePeer() {
  if (peer) return peer;
  peer = new RTCPeerConnection({ iceServers: [] });
  peer.onicecandidate = (event) => {
    send({ type: "receiver-ice", candidate: event.candidate ? event.candidate.toJSON() : null });
  };
  peer.ontrack = (event) => {
    const [stream] = event.streams;
    videoEl.srcObject = stream;
    void videoEl.play().catch(() => undefined);
    setStatus("Receiving screen...");
    send({ type: "receiver-stats", state: peer.connectionState, rendering: true, timestamp: Date.now() });
  };
  peer.onconnectionstatechange = () => {
    setStatus(peer.connectionState === "connected" ? "Receiving screen..." : `WebRTC ${peer.connectionState}`);
    send({ type: "receiver-stats", state: peer.connectionState, rendering: Boolean(videoEl.srcObject), timestamp: Date.now() });
  };
  return peer;
}

async function handleMessage(event) {
  senderId = event.senderId;
  const message = typeof event.data === "string" ? JSON.parse(event.data) : event.data;

  try {
    if (message.type === "sender-hello") {
      setStatus("Connecting...");
      send({ type: "receiver-ready", timestamp: Date.now() });
    }

    if (message.type === "sender-offer") {
      const pc = ensurePeer();
      await pc.setRemoteDescription({ type: "offer", sdp: message.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      send({ type: "receiver-answer", sdp: answer.sdp });
    }

    if (message.type === "sender-ice" && message.candidate) {
      await ensurePeer().addIceCandidate(message.candidate);
    }

    if (message.type === "ping") {
      send({ type: "pong", timestamp: message.timestamp, receivedAt: Date.now() });
    }

    if (message.type === "stop-stream") {
      closePeer();
      setStatus("Stream stopped");
    }
  } catch (error) {
    setStatus("Connection failed");
    send({ type: "receiver-error", message: error instanceof Error ? error.message : String(error) });
  }
}

context.addCustomMessageListener(NAMESPACE, (event) => {
  void handleMessage(event);
});

context.start();
setStatus("Waiting for screen stream...");
