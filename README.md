# LAN Screen Viewer

Consent-first screen sharing for trusted devices on the same LAN/Wi-Fi.

LAN Screen Viewer is an Electron + React + TypeScript app for local screen sharing in homes, classrooms, labs, and small teams. A Host must explicitly start screen sharing and approve each Viewer before WebRTC signaling can proceed.

## Features

- Host and Viewer modes
- OS-mediated screen capture through `getDisplayMedia`
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

## Troubleshooting

- Make sure Host and Viewer are on the same Wi-Fi/LAN.
- Avoid guest Wi-Fi for local sharing.
- Disable AP isolation/client isolation if you control the router.
- Check macOS/Windows firewall prompts for Node/Electron.
- Temporarily disable VPN or select the correct physical interface.
- Use the Host network selector to avoid Docker/VM/VPN adapters.
- Use QR or manual fallback when UDP broadcast is blocked.

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
- mDNS/Bonjour discovery
- Stronger multi-window automated Electron tests
- Optional ICE diagnostics and relay configuration for explicitly managed, consent-based deployments
- Signed/notarized installers
- Per-Viewer bitrate and quality controls
- More detailed ICE candidate diagnostics

## License

No license has been selected yet.
