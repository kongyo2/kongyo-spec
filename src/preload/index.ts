import { contextBridge, ipcRenderer } from "electron";
import type { KongyoApi } from "@shared/api";

const api: KongyoApi = {
  listSpecs: () => ipcRenderer.invoke("specs:list"),
  readSpec: (id) => ipcRenderer.invoke("specs:read", { id }),
  createSpec: (title) => ipcRenderer.invoke("specs:create", { title }),
  saveSpec: (id, content) => ipcRenderer.invoke("specs:save", { id, content }),
  renameSpec: (id, title) => ipcRenderer.invoke("specs:rename", { id, title }),
  deleteSpec: (id) => ipcRenderer.invoke("specs:delete", { id }),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", { url }),
};

contextBridge.exposeInMainWorld("api", api);
