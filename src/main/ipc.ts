import { ipcMain, shell } from "electron";
import { parseReviewSpecInput, parseWeaveSpecInput } from "@shared/schemas/assist";
import {
  parseCreateSpecInput,
  parseImportSpecsInput,
  parseOpenExternalInput,
  parseRenameSpecInput,
  parseSaveSpecInput,
  parseSpecIdInput,
} from "@shared/schemas/ipc";
import {
  parseDeleteLlmProfileInput,
  parseSetLlmRoutingInput,
  parseSetSettingInput,
  parseUpsertLlmProfileInput,
  toRendererSettings,
} from "@shared/schemas/settings";
import { reviewSpec, weaveSpec } from "./assist";
import { deleteLlmProfile, setLlmRouting, upsertLlmProfile } from "./llmProfiles";
import { isSecretEncryptionAvailable, readSettings, writeSetting } from "./settingsStore";
import { createSpec, deleteSpec, importSpecs, listSpecs, readSpec, renameSpec, saveSpec } from "./specsStore";

export function registerIpc(): void {
  ipcMain.handle("specs:list", () => listSpecs());

  ipcMain.handle("specs:read", (_event, raw: unknown) => readSpec(parseSpecIdInput(raw).id));

  ipcMain.handle("specs:create", (_event, raw: unknown) => createSpec(parseCreateSpecInput(raw).title));

  ipcMain.handle("specs:import", (_event, raw: unknown) => importSpecs(parseImportSpecsInput(raw)));

  ipcMain.handle("specs:save", (_event, raw: unknown) => {
    const input = parseSaveSpecInput(raw);
    return saveSpec(input.id, input.content);
  });

  ipcMain.handle("specs:rename", (_event, raw: unknown) => {
    const input = parseRenameSpecInput(raw);
    return renameSpec(input.id, input.title);
  });

  ipcMain.handle("specs:delete", (_event, raw: unknown) => deleteSpec(parseSpecIdInput(raw).id));

  ipcMain.handle("settings:get", () => toRendererSettings(readSettings()));

  ipcMain.handle("assist:review", (_event, raw: unknown) => reviewSpec(parseReviewSpecInput(raw).content));

  ipcMain.handle("assist:weave", (_event, raw: unknown) => weaveSpec(parseWeaveSpecInput(raw)));

  ipcMain.handle("llm:upsert-profile", (_event, raw: unknown) =>
    toRendererSettings(upsertLlmProfile(parseUpsertLlmProfileInput(raw))),
  );

  ipcMain.handle("llm:delete-profile", (_event, raw: unknown) =>
    toRendererSettings(deleteLlmProfile(parseDeleteLlmProfileInput(raw).id)),
  );

  ipcMain.handle("llm:set-routing", (_event, raw: unknown) =>
    toRendererSettings(setLlmRouting(parseSetLlmRoutingInput(raw))),
  );

  ipcMain.on("settings:get-theme", (event) => {
    event.returnValue = readSettings().theme;
  });

  ipcMain.handle("settings:set", (_event, raw: unknown) => {
    const input = parseSetSettingInput(raw);
    if (input.key === "geminiApiKey" && input.value !== null && !isSecretEncryptionAvailable()) {
      throw new Error("この環境では OS の安全な保存領域を利用できないため、API キーを保存できません。");
    }
    return writeSetting(input.key, input.value);
  });

  ipcMain.handle("shell:openExternal", async (_event, raw: unknown) => {
    const { url } = parseOpenExternalInput(raw);
    if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) {
      throw new Error(`refused to open url with unsupported scheme: ${url}`);
    }
    await shell.openExternal(url);
  });
}
