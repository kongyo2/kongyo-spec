import { z } from "zod";
import { SpecFrontmatterSchema } from "./spec";

/** 手動スナップショットのラベル上限 */
export const MAX_SNAPSHOT_LABEL_CHARS = 120;

export const SNAPSHOT_KINDS = ["auto", "manual", "guard"] as const;
export const SnapshotKindSchema = z.enum(SNAPSHOT_KINDS);
export type SnapshotKind = z.infer<typeof SnapshotKindSchema>;

export const SnapshotMetaSchema = z.object({
  id: z.string().min(1),
  specId: z.string().min(1),
  takenAt: z.string(),
  kind: SnapshotKindSchema,
  label: z.string().nullable(),
  lines: z.number().int().nonnegative(),
  chars: z.number().int().nonnegative(),
});
export type SnapshotMeta = z.infer<typeof SnapshotMetaSchema>;

// frontmatter は文字列しか持てないため、数値は coerce し、欠損や破損は
// 一覧から弾かずに既定値で読めるようにする(label の空文字は「ラベルなし」)
export const SnapshotFrontmatterSchema = z.object({
  id: z.string().min(1),
  specId: z.string().min(1),
  takenAt: z.string(),
  kind: SnapshotKindSchema,
  label: z
    .string()
    .catch("")
    .transform((value) => (value.length === 0 ? null : value)),
  lines: z.coerce.number().int().nonnegative().catch(0),
  chars: z.coerce.number().int().nonnegative().catch(0),
});

export function parseSnapshotFrontmatter(raw: unknown): SnapshotMeta {
  return SnapshotFrontmatterSchema.parse(raw);
}

export const SnapshotDocumentSchema = z.object({
  meta: SnapshotMetaSchema,
  content: z.string(),
});
export type SnapshotDocument = z.infer<typeof SnapshotDocumentSchema>;

export const RestoreResultSchema = z.object({
  meta: SpecFrontmatterSchema,
  content: z.string(),
});
export type RestoreResult = z.infer<typeof RestoreResultSchema>;

export const HistoryListInputSchema = z.object({ specId: z.string().min(1).max(200) });
export type HistoryListInput = z.infer<typeof HistoryListInputSchema>;
export function parseHistoryListInput(raw: unknown): HistoryListInput {
  return HistoryListInputSchema.parse(raw);
}

export const HistorySnapshotInputSchema = z.object({
  specId: z.string().min(1).max(200),
  snapshotId: z.string().min(1).max(200),
});
export type HistorySnapshotInput = z.infer<typeof HistorySnapshotInputSchema>;
export function parseHistorySnapshotInput(raw: unknown): HistorySnapshotInput {
  return HistorySnapshotInputSchema.parse(raw);
}

export const HistoryTakeInputSchema = z.object({
  specId: z.string().min(1).max(200),
  content: z.string(),
  label: z.string().max(MAX_SNAPSHOT_LABEL_CHARS).nullable(),
});
export type HistoryTakeInput = z.infer<typeof HistoryTakeInputSchema>;
export function parseHistoryTakeInput(raw: unknown): HistoryTakeInput {
  return HistoryTakeInputSchema.parse(raw);
}

export function byTakenAtDesc(a: SnapshotMeta, b: SnapshotMeta): number {
  return a.takenAt < b.takenAt ? 1 : a.takenAt > b.takenAt ? -1 : 0;
}
