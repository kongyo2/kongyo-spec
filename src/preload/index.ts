import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { KongyoApi } from "@shared/api";

const api: KongyoApi = {
  listSpecs: () => ipcRenderer.invoke("specs:list"),
  readSpec: (id) => ipcRenderer.invoke("specs:read", { id }),
  createSpec: (title) => ipcRenderer.invoke("specs:create", { title }),
  importSpecs: (plan) => ipcRenderer.invoke("specs:import", plan),
  getFilePath: (file) => webUtils.getPathForFile(file),
  saveSpec: (id, content) => ipcRenderer.invoke("specs:save", { id, content }),
  renameSpec: (id, title) => ipcRenderer.invoke("specs:rename", { id, title }),
  deleteSpec: (id) => ipcRenderer.invoke("specs:delete", { id }),
  getInitialTheme: () => ipcRenderer.sendSync("settings:get-theme"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSetting: (key, value) => ipcRenderer.invoke("settings:set", { key, value }),
  reviewSpec: (content, model) => ipcRenderer.invoke("assist:review", { content, model }),
  weaveSpec: (input) => ipcRenderer.invoke("assist:weave", input),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", { url }),
  onFlushBeforeClose: (callback) => {
    const handler = (): void => callback();
    ipcRenderer.on("app:flush-before-close", handler);
    return () => ipcRenderer.removeListener("app:flush-before-close", handler);
  },
  notifyFlushComplete: () => ipcRenderer.send("app:flush-complete"),
  notifyFlushFailed: () => ipcRenderer.send("app:flush-failed"),
};

contextBridge.exposeInMainWorld("api", api);
