import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain, nativeTheme, net, protocol, screen, shell } from "electron";
import type { WindowBounds } from "@shared/schemas/settings";
import { registerIpc } from "./ipc";
import { closeSettingsStore, initSettingsStore, readSettings, writeSetting } from "./settingsStore";
import { getSpecsDir, initStore } from "./specsStore";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "specfile",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

function resolveSpecAsset(requestUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return null;
  }
  let relative: string;
  try {
    relative = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }
  if (relative.length === 0) return null;
  const base = getSpecsDir();
  const absolute = join(base, relative);
  if (absolute !== base && !absolute.startsWith(base + sep)) return null;
  return absolute;
}

function fitBoundsToScreen(bounds: WindowBounds): WindowBounds {
  const { x, y, width, height } = bounds;
  if (x === null || y === null) return bounds;
  const { workArea } = screen.getDisplayMatching({ x, y, width, height });
  const fittedWidth = Math.min(width, workArea.width);
  const fittedHeight = Math.min(height, workArea.height);
  return {
    ...bounds,
    width: fittedWidth,
    height: fittedHeight,
    x: Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - fittedWidth),
    y: Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - fittedHeight),
  };
}

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

function createWindow(): void {
  const settings = readSettings();
  const restored = settings.windowBounds ? fitBoundsToScreen(settings.windowBounds) : null;
  const startDark = settings.theme === "dark" || (settings.theme === "system" && nativeTheme.shouldUseDarkColors);
  const window = new BrowserWindow({
    width: restored?.width ?? 1320,
    height: restored?.height ?? 880,
    ...(restored && restored.x !== null && restored.y !== null ? { x: restored.x, y: restored.y } : {}),
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: startDark ? "#0d1117" : "#ffffff",
    title: "Kongyo Spec",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  const captureBounds = (): void => {
    if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
    const bounds = window.getNormalBounds();
    writeSetting("windowBounds", {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized: window.isMaximized(),
    });
  };
  const persistBounds = debounce(captureBounds, 400);
  window.on("resize", persistBounds);
  window.on("move", persistBounds);
  window.on("maximize", persistBounds);
  window.on("unmaximize", persistBounds);

  window.once("ready-to-show", () => {
    if (restored?.maximized) window.maximize();
    window.show();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  const handleNavigation = (event: { preventDefault: () => void }, url: string): void => {
    if (url === window.webContents.getURL()) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  };
  window.webContents.on("will-navigate", handleNavigation);
  window.webContents.on("will-redirect", handleNavigation);

  let closeFlushed = false;
  let closePending = false;
  let rendererReady = false;
  window.webContents.on("did-finish-load", () => {
    rendererReady = true;
  });
  window.webContents.on("render-process-gone", () => {
    closeFlushed = true;
    if (!window.isDestroyed()) window.close();
  });
  window.on("close", (event) => {
    captureBounds();
    if (closeFlushed) return;
    if (!rendererReady) return;
    event.preventDefault();
    if (closePending) return;
    closePending = true;
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = (): void => {
      clearTimeout(timer);
      ipcMain.removeAllListeners("app:flush-complete");
      ipcMain.removeAllListeners("app:flush-failed");
    };
    timer = setTimeout(() => {
      cleanup();
      closePending = false;
    }, 5000);
    ipcMain.on("app:flush-complete", () => {
      cleanup();
      closeFlushed = true;
      window.close();
    });
    ipcMain.on("app:flush-failed", () => {
      cleanup();
      closePending = false;
    });
    window.webContents.send("app:flush-before-close");
  });

  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app
  .whenReady()
  .then(async () => {
    protocol.handle("specfile", async (request) => {
      const absolute = resolveSpecAsset(request.url);
      if (absolute === null) return new Response("Not found", { status: 404 });
      try {
        return await net.fetch(pathToFileURL(absolute).toString());
      } catch {
        return new Response("Not found", { status: 404 });
      }
    });

    await initStore();
    initSettingsStore();
    registerIpc();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((err: unknown) => {
    console.error("[main] failed to start:", err);
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => closeSettingsStore());
