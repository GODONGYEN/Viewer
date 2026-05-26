# TV Compatibility Notes

Use this file to record real TV test results. Do not include private Wi-Fi passwords, PINs, tokens, or sensitive local paths.

## Template

| Vendor | Model | Firmware | Detection | Protocols | Default Receiver | Chromecast LOAD | WebM Stream | HLS Stream | Latency | Quality | DLNA Play | AirPlay Flow | Miracast Flow | Failure Log | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Example | Example TV | 1.0.0 | mDNS + SSDP | Chromecast, DLNA | Unknown | Unknown | Unknown | Unknown | Unknown | 720p/15fps/4Mbps | Unknown | N/A | N/A | Paste timeline summary | Same Wi-Fi, no guest network |

## What To Record

- TV vendor and model
- Firmware/software version if visible
- Detection method: mDNS, SSDP, or both
- Protocol badges shown by the app
- Chromecast Default Media Receiver launch result
- Chromecast media LOAD result
- Chromecast WebM screen stream result
- Chromecast HLS screen stream result
- Approximate latency and selected quality
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
