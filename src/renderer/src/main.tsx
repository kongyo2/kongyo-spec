import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_RENDERER_SETTINGS, type RendererSettings } from "@shared/schemas/settings";
import "@fontsource-variable/geist/index.css";
import "@fontsource-variable/geist-mono/index.css";
import "katex/dist/katex.min.css";
import "./styles.css";
import { App } from "./App";
import { applyAppearance } from "./lib/appearance";
import { applyTheme, clearLegacyTheme, readLegacyTheme, resolveTheme, type ThemePreference } from "./lib/theme";

function initialThemePreference(): ThemePreference {
  // A not-yet-migrated legacy preference is the authoritative durable value at
  // this point (SQLite still reports the default), so honor it synchronously.
  const legacy = readLegacyTheme();
  if (legacy !== null) return legacy;
  try {
    const theme = window.api.getInitialTheme();
    if (theme === "system" || theme === "light" || theme === "dark") return theme;
  } catch {
    // fall through to the default
  }
  return "system";
}

// Apply the persisted theme synchronously — before the async settings load and
// before the window is shown — so a dark startup never flashes the light theme.
applyTheme(resolveTheme(initialThemePreference()));

async function loadInitialSettings(): Promise<RendererSettings> {
  try {
    const settings = await window.api.getSettings();
    const legacy = readLegacyTheme();
    if (legacy !== null) {
      if (legacy === settings.theme) {
        clearLegacyTheme();
        return settings;
      }
      const persisted = await window.api.setSetting("theme", legacy);
      if (persisted) clearLegacyTheme();
      return { ...settings, theme: legacy };
    }
    return settings;
  } catch {
    return { ...DEFAULT_RENDERER_SETTINGS };
  }
}

async function bootstrap(): Promise<void> {
  const container = document.getElementById("root");
  if (!container) throw new Error("#root element not found");
  const settings = await loadInitialSettings();
  const resolved = resolveTheme(settings.theme);
  applyTheme(resolved);
  applyAppearance(
    {
      accent: settings.accent,
      editorFontSize: settings.editorFontSize,
      previewFontSize: settings.previewFontSize,
      readingWidth: settings.readingWidth,
    },
    resolved,
  );
  createRoot(container).render(
    <StrictMode>
      <App initialSettings={settings} />
    </StrictMode>,
  );
}

void bootstrap();
