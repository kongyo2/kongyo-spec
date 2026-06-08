import type { SettingKey, Settings, ThemePreference } from "./schemas/settings";
import type { SpecDocument, SpecMeta } from "./schemas/spec";

export interface KongyoApi {
  listSpecs(): Promise<SpecMeta[]>;
  readSpec(id: string): Promise<SpecDocument>;
  createSpec(title: string): Promise<SpecMeta>;
  importSpec(title: string, content: string): Promise<SpecMeta>;
  saveSpec(id: string, content: string): Promise<SpecMeta>;
  renameSpec(id: string, title: string): Promise<SpecMeta>;
  deleteSpec(id: string): Promise<void>;
  getInitialTheme(): ThemePreference;
  getSettings(): Promise<Settings>;
  setSetting<K extends SettingKey>(key: K, value: Settings[K]): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  onFlushBeforeClose(callback: () => void): () => void;
  notifyFlushComplete(): void;
  notifyFlushFailed(): void;
}
