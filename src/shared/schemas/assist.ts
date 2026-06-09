import { z } from "zod";

export const FINDING_KINDS = ["overspec", "speculation", "decision"] as const;
export const FindingKindSchema = z.enum(FINDING_KINDS);
export type FindingKind = z.infer<typeof FindingKindSchema>;

const QuestionSchema = z
  .string()
  .max(8000)
  .nullish()
  .transform((value) => {
    const trimmed = value?.trim() ?? "";
    return trimmed.length > 0 ? trimmed : null;
  });

const RewriteSchema = z
  .string()
  .max(8000)
  .nullish()
  .transform((value) => (value == null || value.trim().length === 0 ? null : value));

export const LensFindingSchema = z.object({
  kind: FindingKindSchema,
  excerpt: z
    .string()
    .max(4000)
    .transform((value) => (value.trim().length === 0 ? "" : value)),
  reason: z
    .string()
    .min(1)
    .max(4000)
    .transform((value) => value.trim()),
  question: QuestionSchema,
  rewrite: RewriteSchema,
});
export type LensFinding = z.infer<typeof LensFindingSchema>;

export const LensAltitudeSchema = z.object({
  intent: z.number().min(0).max(100),
  behavior: z.number().min(0).max(100),
  implementation: z.number().min(0).max(100),
});
export type LensAltitude = z.infer<typeof LensAltitudeSchema>;

export const LensReportSchema = z.object({
  verdict: z
    .string()
    .min(1)
    .max(2000)
    .transform((value) => value.trim()),
  altitude: LensAltitudeSchema,
  findings: z
    .array(LensFindingSchema)
    .max(32)
    .transform((items) => items.slice(0, 12)),
});
export type LensReport = z.infer<typeof LensReportSchema>;

export function parseLensReport(raw: unknown): LensReport {
  return LensReportSchema.parse(raw);
}

export const ReviewSpecInputSchema = z.object({ content: z.string().min(1) });
export type ReviewSpecInput = z.infer<typeof ReviewSpecInputSchema>;
export function parseReviewSpecInput(raw: unknown): ReviewSpecInput {
  return ReviewSpecInputSchema.parse(raw);
}
