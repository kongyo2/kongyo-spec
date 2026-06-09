import { randomUUID } from "node:crypto";
import {
  legacyGeminiProfile,
  MAX_LLM_PROFILES,
  type LlmProfile,
  type SetLlmRoutingInput,
  type Settings,
  type UpsertLlmProfileInput,
} from "@shared/schemas/settings";
import { isSecretEncryptionAvailable, readSettings, writeSetting } from "./settingsStore";

function persist<K extends keyof Settings>(key: K, value: Settings[K]): void {
  if (!writeSetting(key, value)) {
    throw new Error("設定ストアが利用できないため保存できませんでした。");
  }
}

function materializedProfiles(settings: Settings): LlmProfile[] {
  return settings.llmProfiles.length > 0 ? [...settings.llmProfiles] : [legacyGeminiProfile(settings.geminiModel)];
}

export function upsertLlmProfile(input: UpsertLlmProfileInput): Settings {
  if (input.apiKey !== undefined && input.apiKey !== null && !isSecretEncryptionAvailable()) {
    throw new Error("この環境では OS の安全な保存領域を利用できないため、API キーを保存できません。");
  }
  const settings = readSettings();
  const profiles = materializedProfiles(settings);
  const id = input.profile.id ?? randomUUID();
  const index = profiles.findIndex((profile) => profile.id === id);
  if (index === -1 && profiles.length >= MAX_LLM_PROFILES) {
    throw new Error(`モデルは最大 ${MAX_LLM_PROFILES} 件まで登録できます。`);
  }
  const existing = index === -1 ? null : profiles[index]!;
  const next: LlmProfile = {
    id,
    label: input.profile.label,
    provider: input.profile.provider,
    model: input.profile.model,
    baseUrl: input.profile.baseUrl,
    temperature: input.profile.temperature,
    apiKey: input.apiKey === undefined ? (existing?.apiKey ?? null) : input.apiKey,
  };
  if (index === -1) profiles.push(next);
  else profiles[index] = next;
  persist("llmProfiles", profiles);
  if (settings.llmMainProfileId === null) persist("llmMainProfileId", profiles[0]!.id);
  return readSettings();
}

export function deleteLlmProfile(id: string): Settings {
  const settings = readSettings();
  const profiles = materializedProfiles(settings).filter((profile) => profile.id !== id);
  persist("llmProfiles", profiles);
  const fallbackIds = settings.llmFallbackProfileIds.filter(
    (fallbackId) => fallbackId !== id && profiles.some((profile) => profile.id === fallbackId),
  );
  persist("llmFallbackProfileIds", fallbackIds);
  if (settings.llmMainProfileId === id || !profiles.some((profile) => profile.id === settings.llmMainProfileId)) {
    persist("llmMainProfileId", profiles[0]?.id ?? null);
  }
  return readSettings();
}

export function setLlmRouting(input: SetLlmRoutingInput): Settings {
  const settings = readSettings();
  const roster = materializedProfiles(settings);
  const ids = new Set(roster.map((profile) => profile.id));
  const mainId = input.mainId !== null && ids.has(input.mainId) ? input.mainId : (roster[0]?.id ?? null);
  const fallbackIds: string[] = [];
  for (const id of input.fallbackIds) {
    if (id === mainId || !ids.has(id) || fallbackIds.includes(id)) continue;
    fallbackIds.push(id);
  }
  persist("llmMainProfileId", mainId);
  persist("llmFallbackProfileIds", fallbackIds);
  return readSettings();
}
