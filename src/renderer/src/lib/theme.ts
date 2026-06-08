import type { ThemePreference } from "@shared/schemas/settings";

export type { ThemePreference };
export type ResolvedTheme = "light" | "dark";

export function systemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference;
}

export function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.dataset["theme"] = resolved;
}

export function nextPreference(current: ThemePreference): ThemePreference {
  return current === "system" ? "light" : current === "light" ? "dark" : "system";
}

const LEGACY_STORAGE_KEY = "kongyo-spec.theme";

export function readLegacyTheme(): ThemePreference | null {
  const value = localStorage.getItem(LEGACY_STORAGE_KEY);
  return value === "system" || value === "light" || value === "dark" ? value : null;
}

export function clearLegacyTheme(): void {
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}
