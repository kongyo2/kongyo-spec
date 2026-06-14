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

const ExcerptSchema = z
  .string()
  .max(4000)
  .transform((value) => (value.trim().length === 0 ? "" : value));

const ReasonSchema = z
  .string()
  .max(4000)
  .transform((value) => value.trim());

const VerdictSchema = z
  .string()
  .max(2000)
  .transform((value) => value.trim())
  .refine((value) => value.length > 0);

export const LensFindingSchema = z
  .object({
    kind: FindingKindSchema,
    excerpt: ExcerptSchema,
    reason: ReasonSchema,
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
  verdict: VerdictSchema,
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

export const ReviewSpecInputSchema = z.object({ content: z.string().min(1) });
export type ReviewSpecInput = z.infer<typeof ReviewSpecInputSchema>;
export function parseReviewSpecInput(raw: unknown): ReviewSpecInput {
  return ReviewSpecInputSchema.parse(raw);
}

export interface AssistReview {
  report: LensReport;
  model: string;
}

const TrimmedSchema = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((value) => value?.trim() ?? "");

const TrimmedBodySchema = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((value) => (value ?? "").replace(/^\n+/, "").replace(/\s+$/, ""));

export const WeaveQuestionSchema = z.object({
  topic: TrimmedSchema(60).transform((value) => (value.length > 0 ? value : "決定")),
  question: TrimmedSchema(2000),
  whyItMatters: TrimmedSchema(2000),
  options: z
    .array(z.string().max(300))
    .max(8)
    .nullish()
    .transform((items) =>
      (items ?? [])
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .slice(0, 4),
    ),
});
export type WeaveQuestion = z.infer<typeof WeaveQuestionSchema>;

export const MAX_WEAVE_MATERIAL_CHARS = 32_000;
export const MAX_WEAVE_WOVEN_CHARS = 48_000;
export const MAX_WEAVE_CONTEXT_CHARS = 16_000;

export const WeaveResultSchema = z.object({
  woven: TrimmedBodySchema(MAX_WEAVE_WOVEN_CHARS),
  questions: z
    .array(WeaveQuestionSchema)
    .max(16)
    .transform((items) => items.filter((item) => item.question.length > 0).slice(0, 6)),
});
export type WeaveResult = z.infer<typeof WeaveResultSchema>;

export function parseWeaveResult(raw: unknown): WeaveResult {
  return WeaveResultSchema.parse(raw);
}

export interface AssistWeave {
  result: WeaveResult;
  model: string;
}

export const WARP_FORMS = ["ears", "mermaid"] as const;
export const WarpFormSchema = z.enum(WARP_FORMS);
export type WarpForm = z.infer<typeof WarpFormSchema>;

export const MERMAID_DIAGRAM_KINDS = [
  "auto",
  "flowchart",
  "sequenceDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "classDiagram",
  "gantt",
] as const;
export const MermaidDiagramKindSchema = z.enum(MERMAID_DIAGRAM_KINDS);
export type MermaidDiagramKind = z.infer<typeof MermaidDiagramKindSchema>;

export const MAX_WARP_MATERIAL_CHARS = 24_000;
export const MAX_WARP_OUTPUT_CHARS = 32_000;

export const WarpResultSchema = z.object({
  output: TrimmedBodySchema(MAX_WARP_OUTPUT_CHARS),
  notes: z
    .array(z.string().max(600))
    .max(12)
    .nullish()
    .transform((items) =>
      (items ?? [])
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .slice(0, 6),
    ),
});
export type WarpResult = z.infer<typeof WarpResultSchema>;

export function parseWarpResult(raw: unknown): WarpResult {
  return WarpResultSchema.parse(raw);
}

export interface AssistWarp {
  result: WarpResult;
  model: string;
}

export const WarpSpecInputSchema = z.object({
  form: WarpFormSchema,
  material: z.string().min(1).max(MAX_WARP_MATERIAL_CHARS),
  title: z.string().max(200).default(""),
  diagram: MermaidDiagramKindSchema.default("auto"),
});
export type WarpSpecInput = z.infer<typeof WarpSpecInputSchema>;
export function parseWarpSpecInput(raw: unknown): WarpSpecInput {
  return WarpSpecInputSchema.parse(raw);
}

export const TAILOR_TASK_SIZES = ["S", "M", "L"] as const;
export const TailorTaskSizeSchema = z.enum(TAILOR_TASK_SIZES);
export type TailorTaskSize = z.infer<typeof TailorTaskSizeSchema>;

export const MAX_TAILOR_TASKS = 16;

const StringListSchema = (maxItem: number, keep: number) =>
  z
    .array(z.string().max(maxItem))
    .max(64)
    .nullish()
    .transform((items) =>
      (items ?? [])
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .slice(0, keep),
    );

export const TailorTaskSchema = z.object({
  title: TrimmedSchema(300),
  summary: TrimmedSchema(2000),
  acceptance: StringListSchema(800, 8),
  verification: TrimmedSchema(800),
  dependsOn: z
    .array(z.number().int().min(1).max(999))
    .max(24)
    .nullish()
    .transform((items) => items ?? []),
  size: z
    .preprocess((value) => (typeof value === "string" ? value.trim().toUpperCase() : value), TailorTaskSizeSchema)
    .catch("M"),
});
export type TailorTask = z.infer<typeof TailorTaskSchema>;

export const TailorPlanSchema = z
  .object({
    approach: TrimmedSchema(4000),
    tasks: z
      .array(TailorTaskSchema)
      .max(64)
      .transform((items) => items.filter((task) => task.title.length > 0).slice(0, MAX_TAILOR_TASKS)),
    blockers: StringListSchema(800, 10),
    notes: StringListSchema(800, 6),
  })
  .transform((plan) => ({
    ...plan,
    tasks: plan.tasks.map((task, index) => ({
      ...task,
      dependsOn: [...new Set(task.dependsOn)]
        .filter((num) => num >= 1 && num <= plan.tasks.length && num !== index + 1)
        .sort((a, b) => a - b),
    })),
  }));
export type TailorPlan = z.infer<typeof TailorPlanSchema>;

export function parseTailorPlan(raw: unknown): TailorPlan {
  return TailorPlanSchema.parse(raw);
}

export const TailorSpecInputSchema = ReviewSpecInputSchema;
export function parseTailorSpecInput(raw: unknown): ReviewSpecInput {
  return TailorSpecInputSchema.parse(raw);
}

export interface AssistTailor {
  plan: TailorPlan;
  model: string;
}

export const ASSIST_KINDS = ["review", "weave", "warp", "tailor", "prism"] as const;
export const AssistKindSchema = z.enum(ASSIST_KINDS);
export type AssistKind = z.infer<typeof AssistKindSchema>;

export const CancelAssistInputSchema = z.object({ kind: AssistKindSchema });
export function parseCancelAssistInput(raw: unknown): z.infer<typeof CancelAssistInputSchema> {
  return CancelAssistInputSchema.parse(raw);
}

export const WeaveQaSchema = z.object({
  question: z.string().min(1).max(2000),
  answer: z.string().min(1).max(4000),
});
export type WeaveQa = z.infer<typeof WeaveQaSchema>;

export const WeaveSpecInputSchema = z.object({
  title: z.string().max(200).default(""),
  material: z.string().max(MAX_WEAVE_WOVEN_CHARS).default(""),
  context: z.string().max(MAX_WEAVE_CONTEXT_CHARS).default(""),
  qa: z.array(WeaveQaSchema).max(12).default([]),
});
export type WeaveSpecInput = z.infer<typeof WeaveSpecInputSchema>;
export function parseWeaveSpecInput(raw: unknown): WeaveSpecInput {
  return WeaveSpecInputSchema.parse(raw);
}

export const PRISM_DIRECTIONS = ["abstract", "concrete"] as const;
export const PrismDirectionSchema = z.enum(PRISM_DIRECTIONS);
export type PrismDirection = z.infer<typeof PrismDirectionSchema>;

export const MAX_PRISM_SELECTION_CHARS = 8_000;
export const MAX_PRISM_CONTEXT_CHARS = 16_000;
export const MAX_PRISM_VARIANT_CHARS = 8_000;
export const MAX_PRISM_VARIANTS = 5;

const PrismTextSchema = z
  .string()
  .max(MAX_PRISM_VARIANT_CHARS)
  .nullish()
  .transform((value) => (value ?? "").replace(/^\n+/, "").replace(/\n+$/, ""));

export const PrismVariantSchema = z.object({
  label: TrimmedSchema(60),
  text: PrismTextSchema,
  note: TrimmedSchema(600),
});
export type PrismVariant = z.infer<typeof PrismVariantSchema>;

function isConformingPrismVariant(variant: PrismVariant): boolean {
  return variant.text.trim().length > 0 && variant.label.length > 0;
}

export const PrismResultSchema = z.object({
  reading: TrimmedSchema(600),
  variants: z
    .array(PrismVariantSchema)
    .max(16)
    .transform((items) => items.filter(isConformingPrismVariant).slice(0, MAX_PRISM_VARIANTS)),
});
export type PrismResult = z.infer<typeof PrismResultSchema>;

export function parsePrismResult(raw: unknown): PrismResult {
  return PrismResultSchema.parse(raw);
}

export interface AssistPrism {
  result: PrismResult;
  model: string;
}

export const PrismSpecInputSchema = z.object({
  direction: PrismDirectionSchema,
  selection: z.string().min(1).max(MAX_PRISM_SELECTION_CHARS),
  title: z.string().max(200).default(""),
  context: z.string().max(MAX_PRISM_CONTEXT_CHARS).default(""),
});
export type PrismSpecInput = z.infer<typeof PrismSpecInputSchema>;
export function parsePrismSpecInput(raw: unknown): PrismSpecInput {
  return PrismSpecInputSchema.parse(raw);
}
