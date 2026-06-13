import { z } from "zod";
import { byStringDesc } from "../compare";

export const SpecFrontmatterSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type SpecMeta = z.infer<typeof SpecFrontmatterSchema>;

export function parseFrontmatter(raw: unknown): SpecMeta {
  return SpecFrontmatterSchema.parse(raw);
}

export const byUpdatedDesc = byStringDesc<SpecMeta>((meta) => meta.updatedAt);

export const SpecDocumentSchema = z.object({
  meta: SpecFrontmatterSchema,
  content: z.string(),
});

export type SpecDocument = z.infer<typeof SpecDocumentSchema>;

export function parseSpecDocument(raw: unknown): SpecDocument {
  return SpecDocumentSchema.parse(raw);
}
