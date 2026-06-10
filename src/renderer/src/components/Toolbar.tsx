import {
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Columns2,
  DraftingCompass,
  type LucideIcon,
  Monitor,
  Moon,
  Radar,
  Scissors,
  Search,
  Settings,
  Spool,
  Sun,
  Telescope,
} from "lucide-react";
import type { EditorViewMode } from "@shared/schemas/settings";
import type { ThemePreference } from "../lib/theme";

export type EditorMode = EditorViewMode;

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
  lensOpen: boolean;
  lensAvailable: boolean;
  loomOpen: boolean;
  warpOpen: boolean;
  frayOpen: boolean;
  tailorOpen: boolean;
  frayCount: number;
  pendingCount: number;
  onMode: (mode: EditorMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onSearch: () => void;
  onToggleLens: () => void;
  onToggleLoom: () => void;
  onToggleWarp: () => void;
  onToggleFray: () => void;
  onToggleTailor: () => void;
  onJumpPending: () => void;
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
    lensOpen,
    lensAvailable,
    loomOpen,
    warpOpen,
    frayOpen,
    tailorOpen,
    frayCount,
    pendingCount,
    onMode,
    onPrev,
    onNext,
    onSearch,
    onToggleLens,
    onToggleLoom,
    onToggleWarp,
    onToggleFray,
    onToggleTailor,
    onJumpPending,
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
        {pendingCount > 0 ? (
          <button
            type="button"
            className="pending-badge"
            onClick={onJumpPending}
            title="クリックで次の未決定箇所へ移動"
            aria-label={`未決定 ${pendingCount} 件 — 次の未決定箇所へ移動`}
          >
            <CircleHelp size={12} aria-hidden="true" />
            未決定 {pendingCount}
          </button>
        ) : null}
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
            className={`mode-split${mode === "split" ? " active" : ""}`}
            aria-pressed={mode === "split"}
            aria-label="Split — 左右分割表示 (Ctrl/Cmd+\)"
            title="左右分割 — 編集とプレビューを並べる"
            onClick={() => onMode("split")}
          >
            <Columns2 size={13} aria-hidden="true" />
            Split
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
          className={`icon-button lens-toggle${loomOpen ? " active" : ""}`}
          onClick={onToggleLoom}
          disabled={!lensAvailable}
          aria-pressed={loomOpen}
          aria-label="Loom — 仕様を織る (Ctrl/Cmd+J)"
          title="仕様を織る — 素材と決定から仕様文を組み上げる"
        >
          <Spool size={14} aria-hidden="true" />
          <span className="toggle-text">Loom</span>
        </button>
        <button
          type="button"
          className={`icon-button lens-toggle${warpOpen ? " active" : ""}`}
          onClick={onToggleWarp}
          disabled={!lensAvailable}
          aria-pressed={warpOpen}
          aria-label="Warp — 定型に張る (Ctrl/Cmd+E)"
          title="定型に張る — ユーザーストーリー+EARS や Mermaid 図へ"
        >
          <DraftingCompass size={14} aria-hidden="true" />
          <span className="toggle-text">Warp</span>
        </button>
        <button
          type="button"
          className={`icon-button lens-toggle${lensOpen ? " active" : ""}`}
          onClick={onToggleLens}
          disabled={!lensAvailable}
          aria-pressed={lensOpen}
          aria-label="Lens — 仕様書を診る (Ctrl/Cmd+L)"
          title="仕様書を診る — 過剰な具体と未決定を検出"
        >
          <Telescope size={14} aria-hidden="true" />
          <span className="toggle-text">Lens</span>
        </button>
        <button
          type="button"
          className={`icon-button lens-toggle${frayOpen ? " active" : ""}`}
          onClick={onToggleFray}
          disabled={!lensAvailable}
          aria-pressed={frayOpen}
          aria-label={`Fray — ほつれを検出 (Ctrl/Cmd+G)${frayCount > 0 ? ` — ${frayCount} 件` : ""}`}
          title="ほつれを検出 — 矛盾・リンク切れ・表記ゆれを検査"
        >
          <Radar size={14} aria-hidden="true" />
          <span className="toggle-text">Fray</span>
          {frayCount > 0 ? <span className="fray-count">{frayCount > 99 ? "99+" : frayCount}</span> : null}
        </button>
        <button
          type="button"
          className={`icon-button lens-toggle${tailorOpen ? " active" : ""}`}
          onClick={onToggleTailor}
          disabled={!lensAvailable}
          aria-pressed={tailorOpen}
          aria-label="Tailor — 実装計画を裁つ (Ctrl/Cmd+I)"
          title="実装計画を裁つ — タスク分解と実装 AI への引き渡し"
        >
          <Scissors size={14} aria-hidden="true" />
          <span className="toggle-text">Tailor</span>
        </button>
        <button
          type="button"
          className="icon-button theme-button"
          onClick={onCycleTheme}
          aria-label={`テーマ: ${themePreference}`}
          title="テーマ切り替え"
        >
          <ThemeIcon size={14} aria-hidden="true" />
          <span className="toggle-text">{THEME_TEXT[themePreference]}</span>
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
