import { useCallback, useEffect, useState } from "react";
import {
  applyTheme,
  clearLegacyTheme,
  nextPreference,
  resolveTheme,
  systemTheme,
  type ResolvedTheme,
  type ThemePreference,
} from "../lib/theme";

export interface ThemeController {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
  cycle: () => void;
}

export function useTheme(initial: ThemePreference): ThemeController {
  const [preference, setPreference] = useState<ThemePreference>(initial);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(initial));

  useEffect(() => {
    const next = resolveTheme(preference);
    setResolved(next);
    applyTheme(next);
    void window.api
      .setSetting("theme", preference)
      .then((persisted) => {
        if (persisted) clearLegacyTheme();
      })
      .catch(() => undefined);
    if (preference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (): void => {
      const resolvedSystem = systemTheme();
      setResolved(resolvedSystem);
      applyTheme(resolvedSystem);
    };
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [preference]);

  const cycle = useCallback(() => setPreference((prev) => nextPreference(prev)), []);

  return { preference, resolved, setPreference, cycle };
}
