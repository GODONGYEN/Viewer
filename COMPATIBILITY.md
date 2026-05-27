# TV Compatibility Notes

Use this file to record real TV test results. Do not include private Wi-Fi passwords, PINs, tokens, or sensitive local paths.

## Template

| Vendor | Model | Firmware | Detection | Protocols | Default Receiver | Chromecast LOAD | HLS Stream | HLS Preset | HLS Start Buffer | Playlist Rewrite | Segment Lag | HLS 404 Count | HLS Latency | ffmpeg Speed | CPU/Heat | Quality | WebM Stream | Custom Receiver Launch | WebRTC ICE | WebRTC Latency | DLNA Play | AirPlay Flow | Miracast Flow | Failure Log | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Example | Example TV | 1.0.0 | mDNS + SSDP | Chromecast, DLNA | Success | Success | Success | Low Latency | 2 segments | ON | 1-3 | 0 | 4-6s | 1.0x+ | Warm/OK | 720p/15fps/2Mbps | Unknown | Unknown | Unknown | Unknown | Unknown | N/A | N/A | Paste timeline summary | Same Wi-Fi, no guest network |

## What To Record

- TV vendor and model
- Firmware/software version if visible
- Detection method: mDNS, SSDP, or both
- Protocol badges shown by the app
- Chromecast Default Media Receiver launch result
- Custom Web Receiver launch result
- WebRTC ICE connected result
- WebRTC latency estimate or visual stopwatch latency
- Chromecast media LOAD result
- Chromecast WebM screen stream result
- Chromecast HLS screen stream result
- Selected HLS preset: Experimental ULL-HLS, Low Latency, Balanced, or Low CPU
- HLS start buffer: 1, 2, or 3 segments
- Playlist rewrite: ON or OFF
- Segment lag from stream diagnostics
- 404 segment request count
- Approximate latency and selected quality
- ffmpeg speed from stream diagnostics
- CPU/heat notes such as cool, warm, hot, throttling suspected
- DLNA SetAVTransportURI/Play result
- AirPlay OS flow result
- Miracast OS flow result
- Timeline status and final error message
- Whether the TV asked for approval or pairing
- Network notes such as guest Wi-Fi, AP isolation, VPN, or firewall prompts

## Safety Notes

- Do not record DRM/protected content tests.
- Do not document bypass attempts.
- Do not store local media file paths if they reveal private folder names.
- Keep TV approval and OS permission prompts in the normal user-approved flow.
