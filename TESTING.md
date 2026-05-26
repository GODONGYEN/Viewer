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
