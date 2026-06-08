import { ipcMain, shell } from "electron";
import {
  parseCreateSpecInput,
  parseImportSpecsInput,
  parseOpenExternalInput,
  parseRenameSpecInput,
  parseSaveSpecInput,
  parseSpecIdInput,
} from "@shared/schemas/ipc";
import { createSpec, deleteSpec, importSpecs, listSpecs, readSpec, renameSpec, saveSpec } from "./specsStore";

export function registerIpc(): void {
  ipcMain.handle("specs:list", () => listSpecs());

  ipcMain.handle("specs:read", (_event, raw: unknown) => readSpec(parseSpecIdInput(raw).id));

  ipcMain.handle("specs:create", (_event, raw: unknown) => createSpec(parseCreateSpecInput(raw).title));

  ipcMain.handle("specs:save", (_event, raw: unknown) => {
    const input = parseSaveSpecInput(raw);
    return saveSpec(input.id, input.content);
  });

  ipcMain.handle("specs:rename", (_event, raw: unknown) => {
    const input = parseRenameSpecInput(raw);
    return renameSpec(input.id, input.title);
  });

  ipcMain.handle("specs:delete", (_event, raw: unknown) => deleteSpec(parseSpecIdInput(raw).id));

  ipcMain.handle("specs:import", (_event, raw: unknown) => importSpecs(parseImportSpecsInput(raw).paths));

  ipcMain.handle("shell:openExternal", async (_event, raw: unknown) => {
    const { url } = parseOpenExternalInput(raw);
    if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) {
      throw new Error(`refused to open url with unsupported scheme: ${url}`);
    }
    await shell.openExternal(url);
  });
}
