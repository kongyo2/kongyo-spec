import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, net, protocol, shell } from "electron";
import { registerIpc } from "./ipc";
import { registerSmokeTest } from "./smoke";
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
  const relative = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
  if (relative.length === 0) return null;
  const base = getSpecsDir();
  const absolute = join(base, relative);
  if (absolute !== base && !absolute.startsWith(base + sep)) return null;
  return absolute;
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: "#ffffff",
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

  window.once("ready-to-show", () => window.show());

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

  if (process.env["KONGYO_SMOKE"] === "1") registerSmokeTest(window);

  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(
  async () => {
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
    registerIpc();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  },
  (err: unknown) => {
    console.error("[main] failed to start:", err);
    app.quit();
  },
);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
