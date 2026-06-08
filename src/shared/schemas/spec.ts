import { z } from "zod";

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

export function byUpdatedDesc(a: SpecMeta, b: SpecMeta): number {
  return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
}

export const SpecDocumentSchema = z.object({
  meta: SpecFrontmatterSchema,
  content: z.string(),
});

export type SpecDocument = z.infer<typeof SpecDocumentSchema>;

export function parseSpecDocument(raw: unknown): SpecDocument {
  return SpecDocumentSchema.parse(raw);
}
