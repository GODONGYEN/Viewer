import { app, BrowserWindow, ipcMain, session } from "electron";
import path from "node:path";
import { setupDiscoveryIpc, stopDiscovery } from "./discovery";
import { RunningSignalingServer, startSignalingServer } from "./signaling";
import { SIGNALING_PORT } from "../shared/schemas";

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
let signalingServer: RunningSignalingServer | null = null;
let signalingStatus: { status: "starting" | "running" | "error" | "stopped"; port?: number; urls?: string[]; message?: string } = {
  status: "starting"
};

function broadcastSignalingStatus() {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("signaling:status", signalingStatus);
  }
}

function urlForMode(mode?: string) {
  const query = mode ? `?mode=${encodeURIComponent(mode)}` : "";
  return query;
}

function createWindow(mode?: "host" | "viewer") {
  const mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 640,
    title: "LAN Screen Viewer",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowedPermissions = new Set(["media", "display-capture"]);
    callback(allowedPermissions.has(permission));
  });

  setupDiscoveryIpc(mainWindow);

  if (devServerUrl) {
    mainWindow.loadURL(`${devServerUrl}${urlForMode(mode)}`);
    mainWindow.webContents.openDevTools({ mode: "detach" });
    return;
  }

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"), mode ? { query: { mode } } : undefined);
}

function parseLaunchMode() {
  const modeArg = process.argv.find((arg) => arg.startsWith("--mode="));
  const mode = modeArg?.split("=")[1];
  return mode === "host" || mode === "viewer" ? mode : undefined;
}

function isDualMode() {
  return process.argv.includes("--dual") || process.env.LAN_VIEWER_DUAL === "1";
}

async function startInternalSignaling() {
  try {
    signalingStatus = { status: "starting" };
    signalingServer = await startSignalingServer({
      preferredPort: Number(process.env.SIGNALING_PORT ?? SIGNALING_PORT),
      onEvent: (event) => {
        if (event.type === "started") {
          signalingStatus = { status: "running", port: event.port, urls: event.urls };
        } else if (event.type === "stopped") {
          signalingStatus = { status: "stopped" };
        } else {
          signalingStatus = { status: "error", message: event.message };
        }
        broadcastSignalingStatus();
      }
    });
    signalingStatus = { status: "running", port: signalingServer.port, urls: signalingServer.urls };
  } catch (error) {
    signalingStatus = { status: "error", message: error instanceof Error ? error.message : "Signaling server failed to start." };
  }
}

app.whenReady().then(async () => {
  ipcMain.handle("signaling:get-status", () => signalingStatus);
  ipcMain.handle("windows:open-viewer", () => {
    createWindow("viewer");
    return { ok: true };
  });

  await startInternalSignaling();

  if (isDualMode()) {
    createWindow("host");
    createWindow("viewer");
  } else {
    createWindow(parseLaunchMode());
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  stopDiscovery();

  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopDiscovery();
  void signalingServer?.close();
});
