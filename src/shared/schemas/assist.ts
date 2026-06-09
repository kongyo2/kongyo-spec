import { z } from "zod";
import { GeminiModelSchema } from "./settings";

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

export const LensFindingSchema = z
  .object({
    kind: FindingKindSchema,
    excerpt: z
      .string()
      .max(4000)
      .transform((value) => (value.trim().length === 0 ? "" : value)),
    reason: z
      .string()
      .max(4000)
      .transform((value) => value.trim()),
    question: QuestionSchema,
    rewrite: RewriteSchema,
  })
  .transform((finding) => (finding.kind === "overspec" ? finding : { ...finding, rewrite: null }));
export type LensFinding = z.infer<typeof LensFindingSchema>;

function isConformingFinding(finding: LensFinding): boolean {
  if (finding.reason.length === 0) return false;
  switch (finding.kind) {
    case "overspec":
      return finding.excerpt.length > 0;
    case "speculation":
      return finding.excerpt.length > 0 && finding.question !== null;
    case "decision":
      return finding.question !== null;
  }
}

function normalizeAltitude(value: { intent: number; behavior: number; implementation: number }): {
  intent: number;
  behavior: number;
  implementation: number;
} {
  const total = value.intent + value.behavior + value.implementation;
  const shares = [
    { key: "intent" as const, exact: (value.intent / total) * 100 },
    { key: "behavior" as const, exact: (value.behavior / total) * 100 },
    { key: "implementation" as const, exact: (value.implementation / total) * 100 },
  ];
  const result = { intent: 0, behavior: 0, implementation: 0 };
  for (const share of shares) result[share.key] = Math.floor(share.exact);
  let remainder = 100 - (result.intent + result.behavior + result.implementation);
  const byFraction = [...shares].sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)));
  for (const share of byFraction) {
    if (remainder <= 0) break;
    result[share.key] += 1;
    remainder -= 1;
  }
  return result;
}

export const LensAltitudeSchema = z
  .object({
    intent: z.number().min(0).max(100),
    behavior: z.number().min(0).max(100),
    implementation: z.number().min(0).max(100),
  })
  .refine((value) => value.intent + value.behavior + value.implementation > 0)
  .transform(normalizeAltitude);
export type LensAltitude = z.infer<typeof LensAltitudeSchema>;

export const LensReportSchema = z.object({
  verdict: z
    .string()
    .max(2000)
    .transform((value) => value.trim())
    .refine((value) => value.length > 0),
  altitude: LensAltitudeSchema,
  findings: z
    .array(LensFindingSchema)
    .max(32)
    .transform((items) => items.filter(isConformingFinding).slice(0, 12)),
});
export type LensReport = z.infer<typeof LensReportSchema>;

export function parseLensReport(raw: unknown): LensReport {
  return LensReportSchema.parse(raw);
}

export const ReviewSpecInputSchema = z.object({ content: z.string().min(1), model: GeminiModelSchema });
export type ReviewSpecInput = z.infer<typeof ReviewSpecInputSchema>;
export function parseReviewSpecInput(raw: unknown): ReviewSpecInput {
  return ReviewSpecInputSchema.parse(raw);
}
