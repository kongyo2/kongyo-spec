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
  listSnapshots: (specId) => ipcRenderer.invoke("history:list", { specId }),
  readSnapshot: (specId, snapshotId) => ipcRenderer.invoke("history:read", { specId, snapshotId }),
  takeSnapshot: (specId, content, label, kind) => ipcRenderer.invoke("history:take", { specId, content, label, kind }),
  restoreSnapshot: (specId, snapshotId) => ipcRenderer.invoke("history:restore", { specId, snapshotId }),
  deleteSnapshot: (specId, snapshotId) => ipcRenderer.invoke("history:delete", { specId, snapshotId }),
  setSnapshotPinned: (specId, snapshotId, pinned) =>
    ipcRenderer.invoke("history:set-pinned", { specId, snapshotId, pinned }),
  getInitialTheme: () => ipcRenderer.sendSync("settings:get-theme"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSetting: (key, value) => ipcRenderer.invoke("settings:set", { key, value }),
  upsertLlmProfile: (input) => ipcRenderer.invoke("llm:upsert-profile", input),
  deleteLlmProfile: (id) => ipcRenderer.invoke("llm:delete-profile", { id }),
  setLlmRouting: (mainId, fallbackIds) => ipcRenderer.invoke("llm:set-routing", { mainId, fallbackIds }),
  resetLlmRouting: () => ipcRenderer.invoke("llm:reset-routing"),
  reviewSpec: (content) => ipcRenderer.invoke("assist:review", { content }),
  auditSpec: (content) => ipcRenderer.invoke("assist:audit", { content }),
  weaveSpec: (input) => ipcRenderer.invoke("assist:weave", input),
  warpSpec: (input) => ipcRenderer.invoke("assist:warp", input),
  tailorSpec: (content) => ipcRenderer.invoke("assist:tailor", { content }),
  cancelAssist: (kind) => ipcRenderer.invoke("assist:cancel", { kind }),
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
