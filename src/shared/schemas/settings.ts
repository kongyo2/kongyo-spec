import { z } from "zod";

export const ThemePreferenceSchema = z.enum(["system", "light", "dark"]);
export type ThemePreference = z.infer<typeof ThemePreferenceSchema>;

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
  lastActiveSpecId: z.string().min(1).max(200).nullable().default(null),
  windowBounds: WindowBoundsSchema.nullable().default(null),
});
export type Settings = z.infer<typeof SettingsSchema>;
export type SettingKey = keyof Settings;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

export const SetSettingInputSchema = z.discriminatedUnion("key", [
  z.object({ key: z.literal("theme"), value: ThemePreferenceSchema }),
  z.object({ key: z.literal("lastActiveSpecId"), value: z.string().min(1).max(200).nullable() }),
  z.object({ key: z.literal("windowBounds"), value: WindowBoundsSchema.nullable() }),
]);
export type SetSettingInput = z.infer<typeof SetSettingInputSchema>;
export function parseSetSettingInput(raw: unknown): SetSettingInput {
  return SetSettingInputSchema.parse(raw);
}
