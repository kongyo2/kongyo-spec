import { ipcMain, shell } from "electron";
import {
  parseAuditSpecInput,
  parseCancelAssistInput,
  parseReviewSpecInput,
  parseTailorSpecInput,
  parseWarpSpecInput,
  parseWeaveSpecInput,
} from "@shared/schemas/assist";
import {
  parseHistoryListInput,
  parseHistoryPinInput,
  parseHistorySnapshotInput,
  parseHistoryTakeInput,
} from "@shared/schemas/history";
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
import { auditSpec, cancelAssist, reviewSpec, tailorSpec, warpSpec, weaveSpec } from "./assist";
import {
  deleteSnapshot,
  listSnapshots,
  readSnapshot,
  schedulePruneAllHistories,
  setSnapshotPinned,
  takeSnapshot,
} from "./historyStore";
import { deleteLlmProfile, resetLlmRouting, setLlmRouting, upsertLlmProfile } from "./llmProfiles";
import { isSecretEncryptionAvailable, readSettings, writeSetting } from "./settingsStore";
import {
  createSpec,
  deleteSpec,
  importSpecs,
  listSpecs,
  readSpec,
  renameSpec,
  restoreSpec,
  saveSpec,
} from "./specsStore";

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

  ipcMain.handle("history:list", (_event, raw: unknown) => listSnapshots(parseHistoryListInput(raw).specId));

  ipcMain.handle("history:read", (_event, raw: unknown) => {
    const input = parseHistorySnapshotInput(raw);
    return readSnapshot(input.specId, input.snapshotId);
  });

  ipcMain.handle("history:take", (_event, raw: unknown) => {
    const input = parseHistoryTakeInput(raw);
    return takeSnapshot(input.specId, input.content, input.kind, input.label);
  });

  ipcMain.handle("history:set-pinned", (_event, raw: unknown) => {
    const input = parseHistoryPinInput(raw);
    return setSnapshotPinned(input.specId, input.snapshotId, input.pinned);
  });

  ipcMain.handle("history:restore", (_event, raw: unknown) => {
    const input = parseHistorySnapshotInput(raw);
    return restoreSpec(input.specId, input.snapshotId);
  });

  ipcMain.handle("history:delete", (_event, raw: unknown) => {
    const input = parseHistorySnapshotInput(raw);
    return deleteSnapshot(input.specId, input.snapshotId);
  });

  ipcMain.handle("settings:get", () => toRendererSettings(readSettings()));

  ipcMain.handle("assist:review", (_event, raw: unknown) => reviewSpec(parseReviewSpecInput(raw).content));

  ipcMain.handle("assist:audit", (_event, raw: unknown) => auditSpec(parseAuditSpecInput(raw).content));

  ipcMain.handle("assist:weave", (_event, raw: unknown) => weaveSpec(parseWeaveSpecInput(raw)));

  ipcMain.handle("assist:warp", (_event, raw: unknown) => warpSpec(parseWarpSpecInput(raw)));

  ipcMain.handle("assist:tailor", (_event, raw: unknown) => tailorSpec(parseTailorSpecInput(raw).content));

  ipcMain.handle("assist:cancel", (_event, raw: unknown) => cancelAssist(parseCancelAssistInput(raw).kind));

  ipcMain.handle("llm:upsert-profile", (_event, raw: unknown) =>
    toRendererSettings(upsertLlmProfile(parseUpsertLlmProfileInput(raw))),
  );

  ipcMain.handle("llm:delete-profile", (_event, raw: unknown) =>
    toRendererSettings(deleteLlmProfile(parseDeleteLlmProfileInput(raw).id)),
  );

  ipcMain.handle("llm:set-routing", (_event, raw: unknown) =>
    toRendererSettings(setLlmRouting(parseSetLlmRoutingInput(raw))),
  );

  ipcMain.handle("llm:reset-routing", () => toRendererSettings(resetLlmRouting()));

  ipcMain.on("settings:get-theme", (event) => {
    event.returnValue = readSettings().theme;
  });

  ipcMain.handle("settings:set", (_event, raw: unknown) => {
    const input = parseSetSettingInput(raw);
    if (input.key === "geminiApiKey" && input.value !== null && !isSecretEncryptionAvailable()) {
      throw new Error("この環境では OS の安全な保存領域を利用できないため、API キーを保存できません。");
    }
    const persisted = writeSetting(input.key, input.value);
    // 保持上限の変更は既存の履歴にも適用する (次のスナップショットを待たせない)。
    // 選び直しの連打で低い上限の間引きが走り切らないよう、予約はデバウンスされる
    if (persisted && input.key === "maxSnapshotsPerSpec") schedulePruneAllHistories();
    return persisted;
  });

  ipcMain.handle("shell:openExternal", async (_event, raw: unknown) => {
    const { url } = parseOpenExternalInput(raw);
    if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) {
      throw new Error(`refused to open url with unsupported scheme: ${url}`);
    }
    await shell.openExternal(url);
  });
}
