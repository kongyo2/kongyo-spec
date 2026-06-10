import { z } from "zod";

export const ThemePreferenceSchema = z.enum(["system", "light", "dark"]);
export type ThemePreference = z.infer<typeof ThemePreferenceSchema>;

export const AccentSchema = z.enum(["indigo", "violet", "emerald", "amber", "rose", "cyan"]);
export type Accent = z.infer<typeof AccentSchema>;

export const ReadingWidthSchema = z.enum(["narrow", "normal", "wide"]);
export type ReadingWidth = z.infer<typeof ReadingWidthSchema>;

export const MermaidRendererSchema = z.enum(["classic", "beautiful"]);
export type MermaidRenderer = z.infer<typeof MermaidRendererSchema>;

export const LineHeightSchema = z.enum(["compact", "normal", "relaxed"]);
export type LineHeight = z.infer<typeof LineHeightSchema>;

export const EditorViewModeSchema = z.enum(["preview", "split", "source"]);
export type EditorViewMode = z.infer<typeof EditorViewModeSchema>;

export const SPLIT_RATIO = { min: 0.25, max: 0.75, default: 0.5 } as const;
const SplitRatioSchema = z.number().min(SPLIT_RATIO.min).max(SPLIT_RATIO.max);

const ModelNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => !/[\s　]/.test(value), "モデル名に空白は使えません");

const ApiKeySchema = z.string().min(1).max(4096);

export const LlmProviderSchema = z.enum(["gemini", "openai"]);
export type LlmProvider = z.infer<typeof LlmProviderSchema>;

export const LLM_TEMPERATURE = { min: 0, max: 2 } as const;
const TemperatureSchema = z.number().min(LLM_TEMPERATURE.min).max(LLM_TEMPERATURE.max);

const BaseUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => /^https?:\/\//i.test(value), "エンドポイントは http(s):// で始まる URL を指定してください");

const ProfileIdSchema = z.string().min(1).max(64);

export const LlmProfileSchema = z.object({
  id: ProfileIdSchema,
  label: z.string().trim().max(60).default(""),
  provider: LlmProviderSchema.default("gemini"),
  model: ModelNameSchema,
  baseUrl: BaseUrlSchema.nullable().default(null),
  apiKey: ApiKeySchema.nullable().default(null),
  temperature: TemperatureSchema.nullable().default(null),
});
export type LlmProfile = z.infer<typeof LlmProfileSchema>;

export const LEGACY_GEMINI_PROFILE_ID = "gemini-default";
export const MAX_LLM_PROFILES = 16;
export const MAX_LLM_FALLBACKS = 8;

export const EDITOR_FONT_SIZE = { min: 11, max: 20, default: 13 } as const;
export const PREVIEW_FONT_SIZE = { min: 13, max: 21, default: 15 } as const;

const EditorFontSizeSchema = z.number().int().min(EDITOR_FONT_SIZE.min).max(EDITOR_FONT_SIZE.max);
const PreviewFontSizeSchema = z.number().int().min(PREVIEW_FONT_SIZE.min).max(PREVIEW_FONT_SIZE.max);

export const WindowBoundsSchema = z.object({
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  x: z.number().int().nullable(),
  y: z.number().int().nullable(),
  maximized: z.boolean(),
});
export type WindowBounds = z.infer<typeof WindowBoundsSchema>;

export const SettingsSchema = z.object({
  theme: ThemePreferenceSchema.default("system"),
  accent: AccentSchema.default("indigo"),
  editorFontSize: EditorFontSizeSchema.default(EDITOR_FONT_SIZE.default),
  previewFontSize: PreviewFontSizeSchema.default(PREVIEW_FONT_SIZE.default),
  editorLineHeight: LineHeightSchema.default("normal"),
  previewLineHeight: LineHeightSchema.default("normal"),
  readingWidth: ReadingWidthSchema.default("normal"),
  mermaidRenderer: MermaidRendererSchema.default("classic"),
  defaultViewMode: EditorViewModeSchema.default("preview"),
  splitRatio: SplitRatioSchema.default(SPLIT_RATIO.default),
  frayAutoCheck: z.boolean().default(true),
  lastActiveSpecId: z.string().min(1).max(200).nullable().default(null),
  windowBounds: WindowBoundsSchema.nullable().default(null),
  geminiApiKey: ApiKeySchema.max(512).nullable().default(null),
  geminiModel: ModelNameSchema.default("gemini-2.5-flash"),
  llmProfiles: z.array(LlmProfileSchema).max(MAX_LLM_PROFILES).default([]),
  llmMainProfileId: ProfileIdSchema.nullable().default(null),
  llmFallbackProfileIds: z.array(ProfileIdSchema).max(MAX_LLM_FALLBACKS).default([]),
});
export type Settings = z.infer<typeof SettingsSchema>;
export type SettingKey = keyof Settings;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

export type RendererLlmProfile = Omit<LlmProfile, "apiKey"> & { apiKeySet: boolean };

export type RendererSettings = Omit<Settings, "geminiApiKey" | "llmProfiles"> & {
  geminiApiKeySet: boolean;
  llmProfiles: RendererLlmProfile[];
};

export function toRendererSettings(settings: Settings): RendererSettings {
  const { geminiApiKey, llmProfiles, ...rest } = settings;
  return {
    ...rest,
    geminiApiKeySet: geminiApiKey !== null,
    llmProfiles: llmProfiles.map(({ apiKey, ...profile }) => ({ ...profile, apiKeySet: apiKey !== null })),
  };
}

export const DEFAULT_RENDERER_SETTINGS: RendererSettings = toRendererSettings(DEFAULT_SETTINGS);

export interface LlmRouting<P extends { id: string }> {
  roster: P[];
  main: P;
  fallbacks: P[];
}

function resolveRouting<P extends { id: string }>(
  profiles: P[],
  mainId: string | null,
  fallbackIds: string[],
  legacy: P,
): LlmRouting<P> {
  const roster = profiles.length > 0 ? profiles : [legacy];
  const main = (mainId !== null ? roster.find((profile) => profile.id === mainId) : undefined) ?? roster[0]!;
  const fallbacks: P[] = [];
  for (const id of fallbackIds) {
    if (id === main.id) continue;
    const profile = roster.find((candidate) => candidate.id === id);
    if (profile && !fallbacks.includes(profile)) fallbacks.push(profile);
  }
  return { roster, main, fallbacks };
}

export function legacyGeminiProfile(geminiModel: string): LlmProfile {
  return {
    id: LEGACY_GEMINI_PROFILE_ID,
    label: "",
    provider: "gemini",
    model: geminiModel,
    baseUrl: null,
    apiKey: null,
    temperature: null,
  };
}

export function settingsLlmRouting(settings: Settings): LlmRouting<LlmProfile> {
  return resolveRouting(
    settings.llmProfiles,
    settings.llmMainProfileId,
    settings.llmFallbackProfileIds,
    legacyGeminiProfile(settings.geminiModel),
  );
}

export function rendererLlmRouting(settings: {
  llmProfiles: RendererLlmProfile[];
  llmMainProfileId: string | null;
  llmFallbackProfileIds: string[];
  geminiModel: string;
}): LlmRouting<RendererLlmProfile> {
  const { apiKey, ...legacy } = legacyGeminiProfile(settings.geminiModel);
  return resolveRouting(settings.llmProfiles, settings.llmMainProfileId, settings.llmFallbackProfileIds, {
    ...legacy,
    apiKeySet: apiKey !== null,
  });
}

export function llmProfileDisplayName(profile: { label: string; model: string }): string {
  return profile.label.trim().length > 0 ? profile.label.trim() : profile.model;
}

export const UpsertLlmProfileInputSchema = z.object({
  profile: z.object({
    id: ProfileIdSchema.optional(),
    label: z.string().trim().max(60).default(""),
    provider: LlmProviderSchema,
    model: ModelNameSchema,
    baseUrl: BaseUrlSchema.nullable().default(null),
    temperature: TemperatureSchema.nullable().default(null),
  }),
  apiKey: ApiKeySchema.nullable().optional(),
});
export type UpsertLlmProfileInput = z.infer<typeof UpsertLlmProfileInputSchema>;
export function parseUpsertLlmProfileInput(raw: unknown): UpsertLlmProfileInput {
  return UpsertLlmProfileInputSchema.parse(raw);
}

export const DeleteLlmProfileInputSchema = z.object({ id: ProfileIdSchema });
export function parseDeleteLlmProfileInput(raw: unknown): z.infer<typeof DeleteLlmProfileInputSchema> {
  return DeleteLlmProfileInputSchema.parse(raw);
}

export const SetLlmRoutingInputSchema = z.object({
  mainId: ProfileIdSchema.nullable(),
  fallbackIds: z.array(ProfileIdSchema).max(MAX_LLM_FALLBACKS),
});
export type SetLlmRoutingInput = z.infer<typeof SetLlmRoutingInputSchema>;
export function parseSetLlmRoutingInput(raw: unknown): SetLlmRoutingInput {
  return SetLlmRoutingInputSchema.parse(raw);
}

export const SetSettingInputSchema = z.discriminatedUnion("key", [
  z.object({ key: z.literal("theme"), value: ThemePreferenceSchema }),
  z.object({ key: z.literal("accent"), value: AccentSchema }),
  z.object({ key: z.literal("editorFontSize"), value: EditorFontSizeSchema }),
  z.object({ key: z.literal("previewFontSize"), value: PreviewFontSizeSchema }),
  z.object({ key: z.literal("editorLineHeight"), value: LineHeightSchema }),
  z.object({ key: z.literal("previewLineHeight"), value: LineHeightSchema }),
  z.object({ key: z.literal("readingWidth"), value: ReadingWidthSchema }),
  z.object({ key: z.literal("mermaidRenderer"), value: MermaidRendererSchema }),
  z.object({ key: z.literal("defaultViewMode"), value: EditorViewModeSchema }),
  z.object({ key: z.literal("splitRatio"), value: SplitRatioSchema }),
  z.object({ key: z.literal("frayAutoCheck"), value: z.boolean() }),
  z.object({ key: z.literal("lastActiveSpecId"), value: z.string().min(1).max(200).nullable() }),
  z.object({ key: z.literal("windowBounds"), value: WindowBoundsSchema.nullable() }),
  z.object({ key: z.literal("geminiApiKey"), value: ApiKeySchema.max(512).nullable() }),
  z.object({ key: z.literal("geminiModel"), value: ModelNameSchema }),
]);
export type SetSettingInput = z.infer<typeof SetSettingInputSchema>;
export function parseSetSettingInput(raw: unknown): SetSettingInput {
  return SetSettingInputSchema.parse(raw);
}
