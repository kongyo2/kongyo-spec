import { z } from "zod";

export const ThemePreferenceSchema = z.enum(["system", "light", "dark"]);
export type ThemePreference = z.infer<typeof ThemePreferenceSchema>;

export const AccentSchema = z.enum(["indigo", "violet", "emerald", "amber", "rose", "cyan"]);
export type Accent = z.infer<typeof AccentSchema>;

export const ReadingWidthSchema = z.enum(["narrow", "normal", "wide"]);
export type ReadingWidth = z.infer<typeof ReadingWidthSchema>;

export const GeminiModelSchema = z.enum(["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-pro"]);
export type GeminiModel = z.infer<typeof GeminiModelSchema>;

const GeminiApiKeySchema = z.string().min(1).max(512);

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
  readingWidth: ReadingWidthSchema.default("normal"),
  lastActiveSpecId: z.string().min(1).max(200).nullable().default(null),
  windowBounds: WindowBoundsSchema.nullable().default(null),
  geminiApiKey: GeminiApiKeySchema.nullable().default(null),
  geminiModel: GeminiModelSchema.default("gemini-2.5-flash"),
});
export type Settings = z.infer<typeof SettingsSchema>;
export type SettingKey = keyof Settings;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

export type RendererSettings = Omit<Settings, "geminiApiKey"> & { geminiApiKeySet: boolean };

export function toRendererSettings(settings: Settings): RendererSettings {
  const { geminiApiKey, ...rest } = settings;
  return { ...rest, geminiApiKeySet: geminiApiKey !== null };
}

export const DEFAULT_RENDERER_SETTINGS: RendererSettings = toRendererSettings(DEFAULT_SETTINGS);

export const SetSettingInputSchema = z.discriminatedUnion("key", [
  z.object({ key: z.literal("theme"), value: ThemePreferenceSchema }),
  z.object({ key: z.literal("accent"), value: AccentSchema }),
  z.object({ key: z.literal("editorFontSize"), value: EditorFontSizeSchema }),
  z.object({ key: z.literal("previewFontSize"), value: PreviewFontSizeSchema }),
  z.object({ key: z.literal("readingWidth"), value: ReadingWidthSchema }),
  z.object({ key: z.literal("lastActiveSpecId"), value: z.string().min(1).max(200).nullable() }),
  z.object({ key: z.literal("windowBounds"), value: WindowBoundsSchema.nullable() }),
  z.object({ key: z.literal("geminiApiKey"), value: GeminiApiKeySchema.nullable() }),
  z.object({ key: z.literal("geminiModel"), value: GeminiModelSchema }),
]);
export type SetSettingInput = z.infer<typeof SetSettingInputSchema>;
export function parseSetSettingInput(raw: unknown): SetSettingInput {
  return SetSettingInputSchema.parse(raw);
}
