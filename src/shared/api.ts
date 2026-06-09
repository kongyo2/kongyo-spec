import type { LensReport } from "./schemas/assist";
import type { GeminiModel, RendererSettings, SettingKey, Settings, ThemePreference } from "./schemas/settings";
import type { SpecDocument, SpecMeta } from "./schemas/spec";

export interface ImportSpecEntry {
  id: string;
  title: string;
  content: string;
}

export interface ImportAssetOp {
  srcFile: string;
  url: string;
  dest: string;
}

export interface ImportPlan {
  specs: ImportSpecEntry[];
  assets: ImportAssetOp[];
}

export interface ImportResult {
  metas: SpecMeta[];
  skippedAssets: number;
}

export interface KongyoApi {
  listSpecs(): Promise<SpecMeta[]>;
  readSpec(id: string): Promise<SpecDocument>;
  createSpec(title: string): Promise<SpecMeta>;
  importSpecs(plan: ImportPlan): Promise<ImportResult>;
  getFilePath(file: File): string;
  saveSpec(id: string, content: string): Promise<SpecMeta>;
  renameSpec(id: string, title: string): Promise<SpecMeta>;
  deleteSpec(id: string): Promise<void>;
  getInitialTheme(): ThemePreference;
  getSettings(): Promise<RendererSettings>;
  setSetting<K extends SettingKey>(key: K, value: Settings[K]): Promise<boolean>;
  reviewSpec(content: string, model: GeminiModel): Promise<LensReport>;
  openExternal(url: string): Promise<void>;
  onFlushBeforeClose(callback: () => void): () => void;
  notifyFlushComplete(): void;
  notifyFlushFailed(): void;
}
