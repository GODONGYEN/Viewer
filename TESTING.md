# LAN Screen Viewer 테스트 가이드

이 앱은 같은 LAN/Wi-Fi 안에서 실행 중인 Electron 앱끼리만 화면 공유를 시도합니다. Host가 명시적으로 화면 공유를 시작하고, Viewer가 Host를 선택해 참가 요청을 보내고, Host가 수락해야 WebRTC 화면 공유가 시작됩니다.

## 같은 컴퓨터에서 테스트

1. 개발용 다중 창 모드를 실행합니다.

   ```bash
   cd /Users/godonghyeon/Documents/Viewer
   npm run dev:dual
   ```

2. Host 창과 Viewer 창이 함께 열리는지 확인합니다.
3. `화면 공유 시작`을 누르고 OS 화면 캡처 권한을 허용합니다.
4. Viewer 창에서 discovery, QR/연결 데이터, 또는 수동 연결을 테스트합니다.
5. 자동 탐색 카드가 보이지 않으면 `수동 연결`을 열고 `http://localhost:4173` 또는 앱이 표시한 signaling 포트와 Host PIN을 입력합니다.

같은 컴퓨터에서는 OS와 UDP 포트 재사용 정책에 따라 broadcast 수신이 제한될 수 있습니다. 이 경우 수동 연결 fallback으로 WebRTC 흐름을 확인합니다.

## 두 기기에서 테스트

1. 두 기기가 같은 Wi-Fi/LAN에 연결되어 있는지 확인합니다.
2. Host 기기에서 앱을 실행합니다. Electron 앱은 signaling 서버를 자동으로 시작합니다.

   ```bash
   cd /Users/godonghyeon/Documents/Viewer
   npm run dev
   ```

3. Host 앱에서 `Host로 시작`을 누릅니다.
4. Host 앱에서 `화면 공유 시작`을 누르고 OS 권한을 허용합니다.
5. Viewer 기기에서도 앱을 실행하고 `Viewer로 시작`을 누릅니다.
6. `사용 가능한 화면 공유 Host` 카드가 나타나면 클릭합니다.
7. Host 화면에 표시된 6자리 PIN을 입력하고 `참가 요청`을 누릅니다.
8. Host가 연결 요청을 `수락`하면 Viewer 화면에 Host 화면이 표시됩니다.

## 자동 탐색이 안 될 때 확인할 것

Viewer는 discovery 시작 후 5초 동안 Host를 찾지 못하면 기본 진단 패널을 표시하고, 15초가 지나도 발견하지 못하면 상세 체크리스트를 표시합니다. 먼저 `다시 검색`을 누르고, 그래도 보이지 않으면 `수동 연결` 또는 `QR 코드로 연결`을 사용합니다.

- 두 기기가 같은 Wi-Fi 또는 같은 유선 LAN에 있는지 확인합니다.
- 게스트 Wi-Fi는 기기 간 통신을 막는 경우가 많습니다.
- 공유기 설정에서 AP isolation, client isolation, wireless isolation이 켜져 있으면 UDP broadcast와 WebSocket 연결이 막힐 수 있습니다.
- macOS 방화벽이 Node/Electron의 수신 연결 또는 UDP 수신을 막는지 확인합니다.
- 회사/학교 네트워크는 UDP broadcast를 차단할 수 있습니다.
- VPN, 보안 에이전트, Docker/가상 네트워크가 우선 네트워크 인터페이스로 잡히면 잘못된 IP가 표시될 수 있습니다.
- Host 화면의 `내 LAN IP`가 Viewer 기기에서 접근 가능한 `192.168.x.x`, `10.x.x.x`, `172.16~31.x.x` 주소인지 확인합니다.

## 네트워크 인터페이스 선택

Host 화면의 `공유 네트워크 선택`에서 Viewer가 접근할 수 있는 IPv4 주소를 고릅니다.

- 일반적인 집/학교 Wi-Fi는 `en0 - 192.168.x.x` 또는 `en0 - 10.x.x.x`처럼 보일 수 있습니다.
- 유선 LAN은 환경에 따라 `en...`, `eth...` 같은 이름으로 표시될 수 있습니다.
- `bridge`, `docker`, `vmnet`, `utun`, `tailscale`, `wg` 등이 붙은 항목은 Docker, VM, VPN, 터널 인터페이스일 수 있습니다.
- 가상/VPN 인터페이스도 완전히 제외하지는 않지만, 두 실제 기기 연결에는 보통 물리 Wi-Fi/LAN 인터페이스를 선택하는 것이 맞습니다.
- `127.0.0.1`은 같은 컴퓨터 테스트용 주소이며 두 기기 연결용으로 선택하지 않습니다.

공유 중에는 선택한 IP가 discovery의 `wsUrl`과 QR 연결 데이터에 들어갑니다. 선택한 IP가 사라지면 공유를 중지하고 올바른 네트워크를 다시 선택합니다.

## QR 코드 fallback

UDP broadcast가 막힌 환경에서는 QR 또는 연결 데이터로 Host 정보를 전달할 수 있습니다.

1. Host에서 `Host로 시작`을 누릅니다.
2. `공유 네트워크 선택`에서 Viewer가 접근 가능한 LAN IP를 선택합니다.
3. `화면 공유 시작`을 누르고 OS 권한을 허용합니다.
4. Host 화면의 `QR 연결` 영역에서 QR을 보여주거나 `연결 데이터 복사`를 누릅니다.
5. Viewer에서 `Viewer로 시작`을 누릅니다.
6. `QR 코드로 연결` 영역에 연결 데이터를 붙여넣고 `연결 데이터 적용`을 누릅니다.
7. PIN을 입력하고 `참가 요청`을 누릅니다.
8. Host가 수락하면 화면 공유가 시작됩니다.

### QR에 PIN을 기본 포함하지 않는 이유

QR에 PIN을 넣으면 QR을 본 사람이 PIN 입력 없이 참가 요청을 보낼 수 있습니다. Host 수락은 여전히 필요하지만, 연결 요청을 만들 수 있는 정보가 한 번에 노출되므로 기본 정책은 PIN 미포함입니다.

### PIN 포함 QR 사용 시 주의

Host가 `PIN 포함 QR 생성`을 명시적으로 켠 경우에만 QR/연결 데이터에 PIN이 포함됩니다.

- 같은 방에서 짧은 시간 동안만 사용합니다.
- 화면을 녹화하거나 사진으로 남기지 않도록 주의합니다.
- PIN 만료 시간이 지나면 해당 QR도 만료됩니다.
- 공유를 중지하거나 PIN을 재생성하면 이전 QR은 더 이상 새 요청에 쓰지 않습니다.

## 수동 연결 fallback

자동 탐색이 실패하면 Viewer 화면에서 `수동 연결`을 엽니다.

1. Host 화면에 표시된 LAN 주소를 입력합니다. 예: `http://192.168.0.12:4173`
2. Host 화면의 6자리 PIN을 입력합니다.
3. `연결 요청`을 누릅니다.
4. Host가 수락하면 화면 공유가 시작됩니다.

## 의도적으로 구현하지 않는 것

- Host 동의 없는 무단 자동 연결
- 앱이 꺼진 Viewer에 강제로 화면 띄우기
- Host의 OS/브라우저 화면 캡처 권한 우회
- 원격 키보드/마우스 제어
- LAN 밖 인터넷 자동 접속
- 방화벽, 보안 정책, 인증, CAPTCHA 우회
- PIN을 UDP discovery 메시지에 포함하는 동작

## TV Discovery 테스트

TV Cast 모드는 주변 TV를 감지한 뒤 프로토콜별 connector로 직접 연결을 시도하는 실험 기능입니다. 앱은 TV 승인, OS 권한, DRM, 방화벽, 인증을 우회하지 않습니다.

### 같은 Wi-Fi에서 TV 탐지

1. Host PC와 TV가 같은 Wi-Fi/LAN에 있는지 확인합니다.
2. 앱을 실행하고 `TV Cast`를 누릅니다.
3. `주변 TV 찾기`를 누릅니다.
4. 발견된 기기 카드의 탐지 방식과 추정 프로토콜을 확인합니다.

### AirPlay TV 테스트

1. TV의 AirPlay 기능을 켭니다.
2. macOS와 TV가 같은 네트워크에 있는지 확인합니다.
3. TV Cast 모드에서 AirPlay 가능성이 있는 기기가 표시되는지 확인합니다.
4. 기기 상세 패널에서 `AirPlay 연결 시작` 또는 `직접 연결 시도`를 누릅니다.
5. TV 이름이 복사되고 macOS 디스플레이 설정이 열리는지 확인합니다.
6. Screen Mirroring에서 사용자가 직접 TV를 선택하고, TV 코드가 나오면 직접 입력합니다.
7. 타임라인에 `airplay / user-action-required`가 표시되는지 확인합니다.

### Chromecast/Google TV 테스트

1. Chromecast 또는 Google TV가 같은 네트워크에 있는지 확인합니다.
2. TV Cast 모드에서 Chromecast/Google Cast 가능성이 표시되는지 확인합니다.
3. 기기 상세 패널에서 `Chromecast 직접 연결`을 누릅니다.
4. 타임라인에서 Cast V2 TLS 연결, `GET_STATUS`, Default Media Receiver `LAUNCH` 단계를 확인합니다.
5. `테스트 미디어 재생`을 누르고 mp4, m4v, mov, mp3, jpg, png 중 하나를 선택합니다.
6. 타임라인에서 media server 시작, Chromecast `LOAD`, media status 수신 여부를 확인합니다.
7. `Chromecast 화면 스트림 옵션`에서 기본값 `Auto(HLS 우선) / 720p / 15fps / 2 Mbps`를 확인합니다.
8. `Chromecast 화면 스트림 시작` 또는 `화면 스트림 캐스팅 실험`을 누르고 OS 화면 선택 권한을 직접 허용합니다.
9. HLS playlist와 첫 segment 준비 후 Chromecast에 `LOAD` 되는지 확인합니다.
10. TV에서 5초 이상 화면이 표시되면 성공으로 기록합니다.
11. Auto에서 HLS가 실패하면 WebM 전략으로 자동 재시도되는지 타임라인을 확인합니다.
12. WebM 단독 테스트는 방식 옵션을 `WebM live`로 바꾸고 다시 시도합니다.
13. `화면 스트림 중지` 또는 `Cast 중지`를 눌렀을 때 캡처, MediaRecorder, stream server, Chromecast STOP이 정리되는지 확인합니다.
14. 화면이 TV에 나오지 않으면 `스트림 URL 진단`을 누릅니다.
15. HLS는 `playlist OK`와 `segment OK`가 표시되어야 합니다.
16. WebM은 `init OK`와 queued chunks 증가가 표시되어야 합니다.
17. 최근 HTTP 요청에 Chromecast의 `index.m3u8`, segment, 또는 `live.webm` 요청이 남는지 확인합니다.
18. 타임라인에서 `MEDIA_STATUS initial`, `MEDIA_STATUS follow-up`, `MEDIA_STATUS timeout` 중 어떤 상태가 기록됐는지 확인합니다.

### Electron 화면 캡처 fallback 테스트

`화면 캡처 시작 실패: Not supported`가 나던 환경에서는 다음 흐름을 확인합니다.

1. TV Cast 모드에서 Chromecast/Google TV를 선택합니다.
2. `Chromecast 화면 스트림 시작`을 누릅니다.
3. 앱이 먼저 단순한 `getDisplayMedia({ video: true, audio: false })` 경로를 시도하는지 확인합니다.
4. 기본 경로가 실패하면 `기본 화면 캡처가 지원되지 않아 Electron 화면 선택 방식으로 전환합니다.` 메시지와 화면/창 선택 모달이 뜨는지 확인합니다.
5. 모달에서 화면 또는 창 썸네일을 직접 선택합니다.
6. preview 영역에 선택한 화면이 표시되는지 확인합니다.
7. 타임라인에 `화면 캡처 성공: getDisplayMedia` 또는 `화면 캡처 성공: Electron desktopCapturer`가 기록되는지 확인합니다.
8. macOS에서 fallback도 실패하면 `macOS 화면 기록 권한 열기`를 누르고 Screen Recording 권한을 허용한 뒤 앱을 재시작합니다.
9. 캡처 성공 후 HLS/WebM stream URL 생성과 Chromecast `LOAD`가 이어지는지 확인합니다.

### DLNA TV 테스트

1. TV의 DLNA/UPnP Media Renderer 기능을 켭니다.
2. TV Cast 모드에서 SSDP/DLNA 기기가 표시되는지 확인합니다.
3. 기기 상세 패널에서 `DLNA 미디어 재생` 또는 `직접 연결 시도`를 누릅니다.
4. mp4, m4v, mov, mp3, jpg, png 중 하나를 선택합니다.
5. 타임라인에서 로컬 미디어 서버 시작, media URL 생성, DIDL-Lite metadata 포함 SetAVTransportURI, Play 단계를 확인합니다.
6. TV에서 재생이 실패하면 코덱 미지원, controlURL 차이, 방화벽, AP isolation을 확인합니다.

### Miracast TV 테스트

1. TV의 무선 디스플레이 또는 Miracast 기능이 켜져 있는지 확인합니다.
2. SSDP/UPnP 정보에 Miracast/WFD 힌트가 있는 경우 TV Cast 모드에 `Miracast possible`이 표시될 수 있습니다.
3. Windows에서는 OS의 무선 디스플레이 연결 기능을 사용합니다.
4. Windows에서는 `Windows 무선 디스플레이 연결 시작`을 눌러 OS 연결 화면이 열리는지 확인합니다.
5. macOS/Electron에서 직접 Miracast 송신은 구현하지 않습니다.

### TV 액션 패널 확인

1. 발견된 TV 카드를 클릭합니다.
2. IP, 탐지 방식, 추정 프로토콜, raw service type이 표시되는지 확인합니다.
3. `직접 연결 시도` 버튼과 프로토콜별 액션 버튼이 표시되는지 확인합니다.
4. 연결을 시도하면 `연결 상태 타임라인`에 connector별 로그가 쌓이는지 확인합니다.
5. `가능한 것`, `아직 불가능한 것`, `보안/권한 안내`가 프로토콜에 맞게 표시되는지 확인합니다.
6. `기기 정보 복사`를 누르고 클립보드에 진단용 JSON이 복사되는지 확인합니다.
7. `디버그 discovery 정보`는 접힌 상태로 유지되고, 필요할 때만 열어 raw 정보를 확인합니다.

### 실패 로그 수집

1. TV 상세 패널의 `연결 상태 타임라인`을 확인합니다.
2. connector, status, step, message를 기록합니다.
3. `기기 정보 복사`로 discovery 정보를 복사합니다.
4. TV 제조사/모델/펌웨어와 함께 `COMPATIBILITY.md` 형식으로 기록합니다.

### 화면 스트림 실패 시 확인할 것

- Mac/PC와 Chromecast가 같은 Wi-Fi/LAN인지 확인합니다.
- 게스트 Wi-Fi 또는 AP isolation이 Chromecast의 HTTP stream URL 접근을 막지 않는지 확인합니다.
- 방화벽이 Electron/Node의 임시 HTTP 서버 포트를 막지 않는지 확인합니다.
- Auto는 HLS를 먼저 시도하고, 실패하면 WebM으로 자동 fallback합니다.
- HLS 방식은 `ffmpeg-static`으로 변환하므로 CPU 사용량과 4~10초 지연이 생길 수 있습니다.
- 타임라인에서 `chromecast-requested-playlist`, `chromecast-requested-segment`, `webm-client-connected`, `stream-http-404` 이벤트를 확인합니다.
- `스트림 URL 진단`에서 최근 HTTP 요청이 비어 있으면 Chromecast가 Mac의 stream URL에 접근하지 못한 것입니다.
- `MEDIA_STATUS follow-up`이 `PLAYING`이면 Chromecast receiver는 재생 상태를 보고한 것입니다. TV 화면이 비어 있으면 TV 출력/입력 상태를 함께 확인합니다.
- `MEDIA_STATUS timeout`이면 Chromecast가 URL을 받았지만 재생 가능한 스트림으로 확정하지 못한 상태입니다. HLS segment 생성, codec, 방화벽 로그를 같이 확인합니다.
- Chromecast media status 오류가 타임라인에 표시되면 content type, codec, stream URL 접근성을 기록합니다.
- 보호 콘텐츠/DRM 우회 목적의 화면은 테스트하지 않습니다.

### TV가 보이지 않을 때

- 같은 Wi-Fi/LAN인지 확인합니다.
- 게스트 네트워크가 아닌지 확인합니다.
- 공유기의 AP isolation/client isolation 설정을 확인합니다.
- TV의 AirPlay, Chromecast, DLNA/UPnP 기능이 켜져 있는지 확인합니다.
- VPN이 켜져 있으면 꺼보거나 올바른 네트워크 인터페이스를 사용합니다.
- 방화벽이 mDNS(UDP 5353) 또는 SSDP(UDP 1900)를 막는지 확인합니다.
- 학교/회사 네트워크에서는 멀티캐스트 탐색이 차단될 수 있습니다.
