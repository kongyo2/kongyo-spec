import type {
  AssistAudit,
  AssistKind,
  AssistReview,
  AssistTailor,
  AssistWarp,
  AssistWeave,
  WarpSpecInput,
  WeaveSpecInput,
} from "./schemas/assist";
import type { RestoreResult, SnapshotDocument, SnapshotMeta, TakeSnapshotKind } from "./schemas/history";
import type {
  RendererSettings,
  SettingKey,
  Settings,
  ThemePreference,
  UpsertLlmProfileInput,
} from "./schemas/settings";
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
  listSnapshots(specId: string): Promise<SnapshotMeta[]>;
  readSnapshot(specId: string, snapshotId: string): Promise<SnapshotDocument>;
  takeSnapshot(specId: string, content: string, label: string | null, kind?: TakeSnapshotKind): Promise<SnapshotMeta>;
  restoreSnapshot(specId: string, snapshotId: string): Promise<RestoreResult>;
  deleteSnapshot(specId: string, snapshotId: string): Promise<void>;
  setSnapshotPinned(specId: string, snapshotId: string, pinned: boolean): Promise<SnapshotMeta>;
  getInitialTheme(): ThemePreference;
  getSettings(): Promise<RendererSettings>;
  setSetting<K extends SettingKey>(key: K, value: Settings[K]): Promise<boolean>;
  upsertLlmProfile(input: UpsertLlmProfileInput): Promise<RendererSettings>;
  deleteLlmProfile(id: string): Promise<RendererSettings>;
  setLlmRouting(mainId: string | null, fallbackIds: string[]): Promise<RendererSettings>;
  resetLlmRouting(): Promise<RendererSettings>;
  reviewSpec(content: string): Promise<AssistReview>;
  auditSpec(content: string): Promise<AssistAudit>;
  weaveSpec(input: WeaveSpecInput): Promise<AssistWeave>;
  warpSpec(input: WarpSpecInput): Promise<AssistWarp>;
  tailorSpec(content: string): Promise<AssistTailor>;
  cancelAssist(kind: AssistKind): Promise<void>;
  openExternal(url: string): Promise<void>;
  onFlushBeforeClose(callback: () => void): () => void;
  notifyFlushComplete(): void;
  notifyFlushFailed(): void;
}
