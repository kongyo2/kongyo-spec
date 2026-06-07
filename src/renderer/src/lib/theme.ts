export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "kongyo-spec.theme";

export function loadThemePreference(): ThemePreference {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function saveThemePreference(preference: ThemePreference): void {
  localStorage.setItem(STORAGE_KEY, preference);
}

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
