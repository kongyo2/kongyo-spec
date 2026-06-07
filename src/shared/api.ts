import type { SpecDocument, SpecMeta } from "./schemas/spec";

export interface KongyoApi {
  listSpecs(): Promise<SpecMeta[]>;
  readSpec(id: string): Promise<SpecDocument>;
  createSpec(title: string): Promise<SpecMeta>;
  saveSpec(id: string, content: string): Promise<SpecMeta>;
  renameSpec(id: string, title: string): Promise<SpecMeta>;
  deleteSpec(id: string): Promise<void>;
  openExternal(url: string): Promise<void>;
}
