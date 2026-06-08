import type { Accent, ReadingWidth, Settings } from "@shared/schemas/settings";
import type { ResolvedTheme } from "./theme";

export type AppearanceSettings = Pick<Settings, "accent" | "editorFontSize" | "previewFontSize" | "readingWidth">;

interface AccentTone {
  base: string;
  fg: string;
}

export interface AccentPreset {
  id: Accent;
  label: string;
  light: AccentTone;
  dark: AccentTone;
}

export const ACCENTS: readonly AccentPreset[] = [
  {
    id: "indigo",
    label: "Indigo",
    light: { base: "#5b62d6", fg: "#ffffff" },
    dark: { base: "#7c84f0", fg: "#ffffff" },
  },
  {
    id: "violet",
    label: "Violet",
    light: { base: "#7c4ddb", fg: "#ffffff" },
    dark: { base: "#a78bfa", fg: "#1e1145" },
  },
  {
    id: "emerald",
    label: "Emerald",
    light: { base: "#0c8f63", fg: "#ffffff" },
    dark: { base: "#34d399", fg: "#04281d" },
  },
  {
    id: "amber",
    label: "Amber",
    light: { base: "#b45309", fg: "#ffffff" },
    dark: { base: "#fbbf24", fg: "#2a1a00" },
  },
  {
    id: "rose",
    label: "Rose",
    light: { base: "#e11d63", fg: "#ffffff" },
    dark: { base: "#fb7185", fg: "#3f0a17" },
  },
  {
    id: "cyan",
    label: "Cyan",
    light: { base: "#0c87a8", fg: "#ffffff" },
    dark: { base: "#38bdf8", fg: "#042b3a" },
  },
];

const DEFAULT_ACCENT: Accent = "indigo";

export interface ReadingWidthPreset {
  id: ReadingWidth;
  label: string;
  px: number;
}

export const READING_WIDTHS: readonly ReadingWidthPreset[] = [
  { id: "narrow", label: "Narrow", px: 680 },
  { id: "normal", label: "Normal", px: 820 },
  { id: "wide", label: "Wide", px: 1040 },
];

function accentPreset(id: Accent): AccentPreset {
  return ACCENTS.find((preset) => preset.id === id) ?? ACCENTS[0]!;
}

const ACCENT_VARS = [
  "--accent",
  "--accent-hi",
  "--accent-fg",
  "--accent-text",
  "--accent-soft",
  "--accent-line",
  "--accent-glow",
  "--ring",
  "--select-bg",
] as const;

function applyAccent(root: HTMLElement, accent: Accent, resolvedTheme: ResolvedTheme): void {
  if (accent === DEFAULT_ACCENT) {
    for (const name of ACCENT_VARS) root.style.removeProperty(name);
    return;
  }
  const isDark = resolvedTheme === "dark";
  const { base, fg } = accentPreset(accent)[resolvedTheme];
  const mix = (other: string, amount: number): string => `color-mix(in srgb, ${base}, ${other} ${amount}%)`;
  const alpha = (amount: number): string => `color-mix(in srgb, ${base} ${amount}%, transparent)`;

  root.style.setProperty("--accent", base);
  root.style.setProperty("--accent-hi", mix("#ffffff", isDark ? 16 : 12));
  root.style.setProperty("--accent-fg", fg);
  root.style.setProperty("--accent-text", isDark ? mix("#ffffff", 24) : mix("#000000", 14));
  root.style.setProperty("--accent-soft", alpha(isDark ? 16 : 10));
  root.style.setProperty("--accent-line", isDark ? base : alpha(86));
  root.style.setProperty("--accent-glow", alpha(isDark ? 48 : 24));
  root.style.setProperty("--ring", alpha(isDark ? 60 : 50));
  root.style.setProperty("--select-bg", alpha(isDark ? 32 : 20));
}

function readingWidthPx(width: ReadingWidth): number {
  return READING_WIDTHS.find((preset) => preset.id === width)?.px ?? 820;
}

export function applyAppearance(appearance: AppearanceSettings, resolvedTheme: ResolvedTheme): void {
  const root = document.documentElement;
  applyAccent(root, appearance.accent, resolvedTheme);
  root.style.setProperty("--editor-font-size", `${appearance.editorFontSize}px`);
  root.style.setProperty("--preview-font-size", `${appearance.previewFontSize}px`);
  root.style.setProperty("--content-width", `${readingWidthPx(appearance.readingWidth)}px`);
}
