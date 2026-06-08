import { ChevronLeft, ChevronRight, type LucideIcon, Monitor, Moon, Search, Settings, Sun } from "lucide-react";
import type { ThemePreference } from "../lib/theme";

export type EditorMode = "preview" | "source";

interface ToolbarProps {
  specTitle: string;
  pageTitle: string;
  pageIndex: number;
  pageCount: number;
  prevTitle: string | null;
  nextTitle: string | null;
  mode: EditorMode;
  saving: boolean;
  themePreference: ThemePreference;
  onMode: (mode: EditorMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onSearch: () => void;
  onCycleTheme: () => void;
  onOpenSettings: () => void;
}

const THEME_ICON: Record<ThemePreference, LucideIcon> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

const THEME_TEXT: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl ";

export function Toolbar(props: ToolbarProps): React.ReactElement {
  const {
    specTitle,
    pageTitle,
    pageIndex,
    pageCount,
    prevTitle,
    nextTitle,
    mode,
    saving,
    themePreference,
    onMode,
    onPrev,
    onNext,
    onSearch,
    onCycleTheme,
    onOpenSettings,
  } = props;

  const ThemeIcon = THEME_ICON[themePreference];

  return (
    <div className="toolbar">
      <div className="toolbar-breadcrumb">
        <span className="crumb-spec">{specTitle || "Untitled"}</span>
        <ChevronRight className="crumb-sep" size={14} aria-hidden="true" />
        <span className="crumb-page">{pageTitle}</span>
        <span className="crumb-count">{pageCount > 0 ? `${pageIndex + 1} / ${pageCount}` : "0 / 0"}</span>
        {saving ? <span className="saving-indicator">保存中…</span> : null}
      </div>

      <div className="toolbar-controls">
        <div className="seq-nav">
          <button
            type="button"
            onClick={onPrev}
            disabled={prevTitle === null}
            title={prevTitle ?? ""}
            aria-label="前のページ"
          >
            <ChevronLeft size={14} aria-hidden="true" />
            Prev
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={nextTitle === null}
            title={nextTitle ?? ""}
            aria-label="次のページ"
          >
            Next
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>

        <div className="mode-toggle" role="group" aria-label="表示モード">
          <button
            type="button"
            className={mode === "preview" ? "active" : ""}
            aria-pressed={mode === "preview"}
            onClick={() => onMode("preview")}
          >
            Preview
          </button>
          <button
            type="button"
            className={mode === "source" ? "active" : ""}
            aria-pressed={mode === "source"}
            onClick={() => onMode("source")}
          >
            Source
          </button>
        </div>

        <button type="button" className="icon-button" onClick={onSearch} aria-label="検索 (Ctrl/Cmd+F)" title="検索">
          <Search size={14} aria-hidden="true" />
          <kbd>{MOD}F</kbd>
        </button>
        <button
          type="button"
          className="icon-button theme-button"
          onClick={onCycleTheme}
          aria-label={`テーマ: ${themePreference}`}
          title="テーマ切り替え"
        >
          <ThemeIcon size={14} aria-hidden="true" />
          {THEME_TEXT[themePreference]}
        </button>
        <button
          type="button"
          className="icon-button square"
          onClick={onOpenSettings}
          aria-label="設定 (Ctrl/Cmd+,)"
          title="設定"
        >
          <Settings size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
