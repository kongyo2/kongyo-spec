import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_SETTINGS, type Settings } from "@shared/schemas/settings";
import "katex/dist/katex.min.css";
import "./styles.css";
import { App } from "./App";
import { applyTheme, resolveTheme } from "./lib/theme";

const LEGACY_THEME_KEY = "kongyo-spec.theme";

async function loadInitialSettings(): Promise<Settings> {
  try {
    const settings = await window.api.getSettings();
    const legacy = localStorage.getItem(LEGACY_THEME_KEY);
    if (legacy === "system" || legacy === "light" || legacy === "dark") {
      if (legacy === settings.theme) {
        localStorage.removeItem(LEGACY_THEME_KEY);
        return settings;
      }
      const persisted = await window.api.setSetting("theme", legacy);
      if (persisted) localStorage.removeItem(LEGACY_THEME_KEY);
      return { ...settings, theme: legacy };
    }
    return settings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function bootstrap(): Promise<void> {
  const container = document.getElementById("root");
  if (!container) throw new Error("#root element not found");
  const settings = await loadInitialSettings();
  applyTheme(resolveTheme(settings.theme));
  createRoot(container).render(
    <StrictMode>
      <App initialSettings={settings} />
    </StrictMode>,
  );
}

void bootstrap();
