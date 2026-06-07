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
}

const THEME_LABEL: Record<ThemePreference, string> = {
  system: "🖥 System",
  light: "☀ Light",
  dark: "🌙 Dark",
};

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
  } = props;

  return (
    <div className="toolbar">
      <div className="toolbar-breadcrumb">
        <span className="crumb-spec">{specTitle || "Untitled"}</span>
        <span className="crumb-sep">›</span>
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
            ‹ Prev
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={nextTitle === null}
            title={nextTitle ?? ""}
            aria-label="次のページ"
          >
            Next ›
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
          🔍
        </button>
        <button
          type="button"
          className="icon-button theme-button"
          onClick={onCycleTheme}
          aria-label={`テーマ: ${themePreference}`}
          title="テーマ切り替え"
        >
          {THEME_LABEL[themePreference]}
        </button>
      </div>
    </div>
  );
}
