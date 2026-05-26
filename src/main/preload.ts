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
