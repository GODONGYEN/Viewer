import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("lanViewer", {
  platform: process.platform,
  getSignalingStatus: () => ipcRenderer.invoke("signaling:get-status"),
  onSignalingStatus: (callback: (status: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status);
    ipcRenderer.on("signaling:status", listener);
    return () => ipcRenderer.removeListener("signaling:status", listener);
  },
  openViewerWindow: () => ipcRenderer.invoke("windows:open-viewer")
});

contextBridge.exposeInMainWorld("lanDiscovery", {
  getLocalNetworkInfo: () => ipcRenderer.invoke("lan-discovery:get-local-network-info"),
  startHostBroadcast: (payload: unknown) => ipcRenderer.invoke("lan-discovery:start-host-broadcast", payload),
  stopHostBroadcast: () => ipcRenderer.invoke("lan-discovery:stop-host-broadcast"),
  startViewerDiscovery: () => ipcRenderer.invoke("lan-discovery:start-viewer-discovery"),
  stopViewerDiscovery: () => ipcRenderer.invoke("lan-discovery:stop-viewer-discovery"),
  onHostFound: (callback: (host: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, host: unknown) => callback(host);
    ipcRenderer.on("lan-discovery:host-found", listener);
    return () => ipcRenderer.removeListener("lan-discovery:host-found", listener);
  },
  onEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, discoveryEvent: unknown) => callback(discoveryEvent);
    ipcRenderer.on("lan-discovery:event", listener);
    return () => ipcRenderer.removeListener("lan-discovery:event", listener);
  }
});

contextBridge.exposeInMainWorld("tvDiscovery", {
  startTvDiscovery: () => ipcRenderer.invoke("tv-discovery:start"),
  stopTvDiscovery: () => ipcRenderer.invoke("tv-discovery:stop"),
  getTvDiscoveryStatus: () => ipcRenderer.invoke("tv-discovery:get-status"),
  openMacDisplaySettings: () => ipcRenderer.invoke("tv-discovery:open-display-settings"),
  openMacScreenRecordingSettings: () => ipcRenderer.invoke("tv-discovery:open-screen-recording-settings"),
  onTvDeviceFound: (callback: (device: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, device: unknown) => callback(device);
    ipcRenderer.on("tv-discovery:device-found", listener);
    return () => ipcRenderer.removeListener("tv-discovery:device-found", listener);
  },
  onTvDiscoveryStatus: (callback: (status: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status);
    ipcRenderer.on("tv-discovery:status", listener);
    return () => ipcRenderer.removeListener("tv-discovery:status", listener);
  }
});

contextBridge.exposeInMainWorld("tvConnection", {
  connectToTv: (payload: unknown) => ipcRenderer.invoke("tv-connection:connect", payload),
  stopConnection: (connectionId: string) => ipcRenderer.invoke("tv-connection:stop", connectionId),
  selectDlnaMedia: () => ipcRenderer.invoke("tv-connection:select-dlna-media"),
  startScreenStream: (payload: unknown) => ipcRenderer.invoke("tv-connection:screen-stream-start", payload),
  pushScreenStreamChunk: (payload: unknown) => ipcRenderer.invoke("tv-connection:screen-stream-push", payload),
  stopScreenStream: (streamId: string) => ipcRenderer.invoke("tv-connection:screen-stream-stop", streamId),
  getScreenStreamDiagnostics: (payload: unknown) => ipcRenderer.invoke("tv-connection:screen-stream-diagnostics", payload),
  sendWebRtcSignal: (payload: unknown) => ipcRenderer.invoke("tv-connection:webrtc-signal", payload),
  stopAllConnections: () => ipcRenderer.invoke("tv-connection:stop-all"),
  onConnectionEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, connectionEvent: unknown) => callback(connectionEvent);
    ipcRenderer.on("tv-connection:event", listener);
    return () => ipcRenderer.removeListener("tv-connection:event", listener);
  }
});

contextBridge.exposeInMainWorld("screenCapture", {
  getSources: () => ipcRenderer.invoke("screen-capture:get-sources"),
  openScreenRecordingSettings: () => ipcRenderer.invoke("screen-capture:open-screen-recording-settings"),
  getEnvironmentInfo: () => ipcRenderer.invoke("screen-capture:get-environment-info")
});
