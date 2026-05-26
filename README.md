# LAN Screen Viewer

Consent-first screen sharing for trusted devices on the same LAN/Wi-Fi.

LAN Screen Viewer is an Electron + React + TypeScript app for local screen sharing in homes, classrooms, labs, and small teams. It currently supports PC-to-PC LAN screen sharing and includes an experimental TV Cast Controller mode for finding nearby AirPlay, Chromecast/Google Cast, DLNA, and Miracast-like devices.

The long-term direction is a TV Cast Controller. When a TV is detected, the app now tries the safest direct connection path that matches the TV protocol. It still does not force, automate, or bypass TV/OS approval.

## Features

- Host and Viewer modes
- OS-mediated screen capture through `getDisplayMedia`
- Electron screen capture compatibility layer with desktopCapturer fallback
- WebRTC video sharing with Viewer as `recvonly`
- Built-in WebSocket signaling server
- UDP broadcast LAN discovery
- QR/connection-data fallback
- Manual address/PIN fallback
- PIN authentication with expiry and regeneration
- Network interface selection for multi-adapter machines
- Discovery failure diagnostics
- WebRTC/signaling status logs
- Multi-Viewer Host peer connection handling
- Experimental TV Cast mode for AirPlay/Chromecast/DLNA/Miracast hints
- Protocol-specific TV action panels and connection guides
- TVConnectionEngine with protocol-specific connectors
- DLNA media playback experiment using a local HTTP server and UPnP AVTransport SOAP
- Chromecast Cast V2 connection, Default Media Receiver launch, media LOAD, and screen stream casting
- AirPlay and Miracast OS connection flow launchers
- TV protocol connection attempts without forced or unauthorized connection

## Security Principles

This app is designed for voluntary local screen sharing only. It does not support unauthorized access, hidden capture, remote control, keyboard/mouse forwarding, or bypassing operating-system security prompts.

- Host must click `화면 공유 시작` before any screen stream exists
- Host must approve each Viewer before WebRTC signaling proceeds
- Viewer receives video only; it cannot control the Host
- No automatic Viewer connection
- No PIN in UDP discovery broadcasts
- QR codes omit PIN by default
- PIN-including QR data requires explicit Host opt-in
- No firewall, authentication, or OS permission bypass
- Renderer uses `contextIsolation: true` and `nodeIntegration: false`

## Tech Stack

- Electron
- React
- TypeScript
- WebRTC
- Node.js HTTP/WebSocket signaling
- UDP broadcast discovery
- mDNS/Bonjour TV discovery
- SSDP/UPnP TV discovery
- zod validation
- qrcode
- Vite
- Vitest
- electron-builder

## Install

```bash
git clone https://github.com/GODONGYEN/Viewer.git
cd Viewer
npm install
```

## Development

Default development run:

```bash
npm run dev
```

Open directly in Host mode:

```bash
npm run dev:host
```

Open directly in Viewer mode:

```bash
npm run dev:viewer
```

Open Host and Viewer windows together for local testing:

```bash
npm run dev:dual
```

Standalone signaling server remains available for protocol tests:

```bash
npm run dev:server
```

The packaged Electron app starts its own signaling server automatically. If port `4173` is busy, it tries nearby ports and reports the actual port to the renderer.

## Host Usage

1. Click `Host로 시작`.
2. Choose the LAN network interface that Viewers can reach.
3. Click `화면 공유 시작`.
4. Approve the OS screen recording prompt.
5. Share the displayed PIN, QR data, or manual address with Viewers.
6. Approve or reject each Viewer request.
7. Click `공유 중지` to end all Viewer connections.

## Viewer Usage

Viewer can connect by one of three methods:

- LAN discovery Host card
- QR/connection data paste
- Manual address and PIN

The Host must still approve the request before any WebRTC media is received.

## TV Cast Mode

Click `TV Cast` to search for nearby TVs and casting devices on the same LAN.

Current experimental support:

- AirPlay-like devices through mDNS/Bonjour
- Chromecast/Google Cast-like devices through mDNS/Bonjour
- DLNA/UPnP Media Renderers through SSDP
- Miracast hints when SSDP/UPnP data suggests wireless display support

The app merges duplicate discoveries from the same TV, shows protocol badges, and opens a detail panel with direct connection actions, unsupported actions, security notes, and a connector timeline.

### TVConnectionEngine

When you click `직접 연결 시도`, the main process chooses connectors in this order when the detected protocols allow it:

1. Chromecast
2. AirPlay
3. DLNA
4. Miracast

Each connector reports status events such as protocol analysis, connector selected, connecting, media URL created, playing, user action required, failed, and stopped.

### AirPlay Guidance

On macOS, AirPlay Screen Mirroring is usually the practical path for TV mirroring. If an AirPlay-capable TV is detected, the app copies the TV name and opens macOS Display settings so the user can select the TV manually. AirPlay codes and approval are never bypassed.

### Chromecast Guidance

If a Chromecast or Google TV-like device is detected, the app uses a built-in Cast V2 client instead of vulnerable Cast packages. It opens a TLS connection to port `8009`, sends Cast V2 framed protobuf messages, launches the Default Media Receiver (`CC1AD845`), and can send a media `LOAD` request for a selected local file, WebM live screen stream, or HLS fallback stream.

### Chromecast Screen Stream

HLS Default Media Receiver mode is kept as `Stable HLS` fallback. It is reliable for media playback, but HLS segmenting, playlist windows, receiver buffering, and `LOAD → PLAYING` timing can produce 10+ seconds of delay. For real screen sharing, the app now adds `Low Latency WebRTC` through a Chromecast Custom Web Receiver.

The screen stream flow is:

1. User clicks `Chromecast 화면 스트림 시작`.
2. The renderer first calls `getDisplayMedia({ video: true, audio: false })` after the user action.
3. If that is not supported in the current Electron/Chromium runtime, the app asks the main process for `desktopCapturer` screen/window sources and shows an in-app source picker.
4. The user explicitly selects a screen/window, then the renderer starts `getUserMedia` with that source ID.
5. `MediaRecorder` encodes WebM chunks.
6. The main process serves either a WebM chunked stream or an HLS playlist through the LAN HTTP stream server.
7. Chromecast receives a `LOAD` request with `streamType: LIVE`.

Default options are `Low Latency`, `720p`, `15fps`, `2 Mbps`, and `Auto(HLS first)`. Auto starts HLS and WebM sessions from the same user-approved capture, waits for the HLS playlist and first segment before sending Chromecast `LOAD`, and falls back to WebM if the HLS strategy fails. HLS uses `ffmpeg-static` and usually has higher Chromecast compatibility, with a few seconds of latency.

Available stream presets:

- `Low Latency`: 720p / 15fps / 2 Mbps, 1-second HLS segments, playlist size 2, `ultrafast` x264.
- `Balanced`: 720p / 15fps / 2 Mbps, 1-second HLS segments, playlist size 3, `superfast` x264.
- `Low CPU`: 540p / 10fps / 1 Mbps, 1-second HLS segments, playlist size 3, `ultrafast` x264.

Latency cannot be zero because the pipeline still has capture, encoding, HLS segmenting, LAN transfer, and Chromecast buffering. Use `Low Latency` first; if the Mac gets hot or diagnostics show ffmpeg speed below `0.9x`, switch to `Low CPU`.

The TV detail panel includes a stream diagnostics view. It shows the generated HLS/WebM URLs, whether HLS playlist and first segment are ready, whether WebM init chunks exist, recent HTTP requests from Chromecast, and Chromecast `MEDIA_STATUS` values such as `BUFFERING`, `PLAYING`, `IDLE`, and `ERROR`.

### Low Latency WebRTC Receiver

Low Latency mode uses a custom Cast receiver page from the `receiver/` directory:

1. Electron captures the screen only after the user clicks start.
2. The app launches your registered Custom Receiver App ID.
3. Cast custom namespace `urn:x-cast:com.godonghyeon.viewer.webrtc` carries WebRTC offer/answer/ICE messages.
4. The receiver page displays the remote video track directly in a fullscreen `<video>` element.
5. If receiver launch, signaling, ICE, or rendering fails in Auto mode, the app falls back to Stable HLS.

Custom Receiver requirements:

- Register a Custom Web Receiver in the Google Cast SDK Developer Console.
- Host `receiver/index.html`, `receiver/receiver.js`, and `receiver/receiver.css` on an HTTPS URL such as GitHub Pages, Vercel, or Netlify.
- Enter the generated Receiver App ID in the TV Cast panel or set `VITE_CAST_CUSTOM_RECEIVER_APP_ID`.
- The receiver only displays video. It does not receive keyboard or mouse control events.

### DLNA Guidance

DLNA is better suited for media file playback than full-screen mirroring. This app can select a local media file, serve it from a temporary local HTTP server, find AVTransport from the TV description XML, send `SetAVTransportURI`, and send `Play`. TV codec support varies by model.

### Miracast Guidance

Miracast is mainly a Windows wireless display path. This app may show a Miracast hint when discovery data suggests it, but it does not implement Miracast transmission. On macOS, check AirPlay first.

### Current Direct Connection Status

- Chromecast: direct Cast V2 TLS connection, `GET_STATUS`, Default Media Receiver `LAUNCH`, media `LOAD`, media `STOP`, WebM live stream, and HLS fallback.
- DLNA: experimental media file playback through local HTTP + AVTransport SOAP with DIDL-Lite metadata and HTTP Range support.
- AirPlay: macOS connection flow launcher; user must select the TV and approve codes.
- Miracast: Windows Wireless Display settings launcher; user must select the TV.
- Screen stream casting: explicit user-triggered `getDisplayMedia` or user-selected Electron `desktopCapturer` fallback + MediaRecorder WebM chunks + optional ffmpeg HLS fallback; no DRM/protected content bypass.

## LAN Discovery

When Host screen sharing is active, the app broadcasts a discovery payload on UDP port `45454`. The payload includes the Host name, Host ID, LAN WebSocket URL, selected IP, and expiry time. It does not include the PIN.

If discovery fails, use QR or manual connection. Common causes include guest Wi-Fi, AP/client isolation, firewall rules, VPN routes, or school/company network policies blocking UDP broadcast.

## QR Fallback

Host can display a QR code and copy connection data. By default, QR data does not include the PIN:

```json
{
  "type": "LAN_SCREEN_SHARE_JOIN",
  "version": 1,
  "hostId": "...",
  "hostName": "...",
  "wsUrl": "ws://192.168.0.12:4173",
  "ipAddress": "192.168.0.12",
  "pinRequired": true,
  "expiresAt": 1234567890
}
```

Host may explicitly enable `PIN 포함 QR 생성`, but this is more sensitive and should be used briefly in trusted physical spaces only.

## Manual Connection

If discovery and QR fallback are unavailable:

1. Viewer opens `수동 연결`.
2. Viewer enters the Host LAN HTTP address, for example `http://192.168.0.12:4173`.
3. Viewer enters the 6-digit PIN.
4. Host approves the request.

## macOS Screen Recording Permission

macOS requires explicit Screen Recording permission. If capture fails:

1. Open System Settings.
2. Go to Privacy & Security.
3. Open Screen & System Audio Recording or Screen Recording.
4. Allow the app or Electron during development.
5. Restart the app if macOS asks for it.

The app does not bypass this permission.

During Chromecast screen streaming, a `Not supported` capture error usually means the current Electron renderer cannot use the default `getDisplayMedia` path or rejected the constraints. The app now retries through an Electron source picker. If that picker also fails on macOS, open Screen Recording settings from the app, allow Electron or the packaged app, and restart.

## Troubleshooting

- Make sure Host and Viewer are on the same Wi-Fi/LAN.
- Make sure the TV is on the same Wi-Fi/LAN.
- Avoid guest Wi-Fi for local sharing.
- Disable AP isolation/client isolation if you control the router.
- Check macOS/Windows firewall prompts for Node/Electron, mDNS, and SSDP.
- Temporarily disable VPN or select the correct physical interface.
- Use the Host network selector to avoid Docker/VM/VPN adapters.
- Use QR or manual fallback when UDP broadcast is blocked.
- Ensure AirPlay, Chromecast, or DLNA/UPnP is enabled on the TV.

## Build And Package

Production build:

```bash
npm run build
```

Package for current platform:

```bash
npm run dist
```

macOS package:

```bash
npm run dist:mac
```

Windows package:

```bash
npm run dist:win
```

Apple signing and notarization are not configured yet. Unsigned builds are intended for local testing.

## Tests

```bash
npm run typecheck
npm run build
npm run test
npm audit
```

## Intentionally Not Implemented

- Unauthorized access to another device
- Hidden or background screen capture
- Remote control
- Keyboard/mouse forwarding
- Automatic connection outside the local network
- Security policy bypass
- Firewall bypass
- OS permission bypass

## Future Work

- Camera-based QR scanning
- Stronger multi-window automated Electron tests
- Optional ICE diagnostics and relay configuration for explicitly managed, consent-based deployments
- Broader Cast V2 receiver/media status compatibility handling
- Chromecast receiver status telemetry and more detailed automatic fallback heuristics based on real TV media status
- Broader DLNA metadata and codec compatibility handling
- Signed/notarized installers
- Per-Viewer bitrate and quality controls
- More detailed ICE candidate diagnostics

## License

No license has been selected yet.
