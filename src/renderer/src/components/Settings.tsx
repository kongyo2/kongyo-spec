import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  type LucideIcon,
  Minus,
  Monitor,
  Moon,
  Palette,
  Plus,
  RotateCcw,
  Sparkles,
  Sun,
  Type,
  X,
} from "lucide-react";
import {
  type Accent,
  EDITOR_FONT_SIZE,
  PREVIEW_FONT_SIZE,
  type ReadingWidth,
  type ThemePreference,
} from "@shared/schemas/settings";
import { ACCENTS, type AppearanceSettings, READING_WIDTHS } from "../lib/appearance";
import type { ResolvedTheme } from "../lib/theme";

export type SettingChange =
  | { key: "theme"; value: ThemePreference }
  | { key: "accent"; value: Accent }
  | { key: "editorFontSize"; value: number }
  | { key: "previewFontSize"; value: number }
  | { key: "readingWidth"; value: ReadingWidth };

interface SettingsProps {
  theme: ThemePreference;
  appearance: AppearanceSettings;
  resolvedTheme: ResolvedTheme;
  onChange: (change: SettingChange) => void;
  onReset: () => void;
  onClose: () => void;
}

type Section = "appearance" | "typography" | "about";

const SECTIONS: { id: Section; label: string; hint: string; icon: LucideIcon }[] = [
  { id: "appearance", label: "外観", hint: "テーマとアクセント", icon: Palette },
  { id: "typography", label: "タイポグラフィ", hint: "文字サイズと横幅", icon: Type },
  { id: "about", label: "情報", hint: "バージョンと構成", icon: Sparkles },
];

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

const TECH = ["GFM", "Shiki", "KaTeX", "Mermaid"];
const REPO_URL = "https://github.com/kongyo2/kongyo-spec";
const APP_VERSION = __APP_VERSION__;

function Row({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="settings-row">
      <div className="settings-row-label">
        <span className="settings-row-title">{title}</span>
        <span className="settings-row-desc">{desc}</span>
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: LucideIcon }[];
  onSelect: (value: T) => void;
}): React.ReactElement {
  return (
    <div className="settings-seg" role="group" aria-label={label}>
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            className={option.value === value ? "active" : ""}
            aria-pressed={option.value === value}
            onClick={() => onSelect(option.value)}
          >
            {Icon ? <Icon size={14} aria-hidden="true" /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}): React.ReactElement {
  const clamp = (next: number): number => Math.min(max, Math.max(min, next));
  return (
    <div className="settings-stepper" role="group" aria-label={label}>
      <button type="button" aria-label="小さく" disabled={value <= min} onClick={() => onChange(clamp(value - 1))}>
        <Minus size={14} aria-hidden="true" />
      </button>
      <span className="settings-stepper-value">
        {value}
        <span className="settings-stepper-unit">px</span>
      </span>
      <button type="button" aria-label="大きく" disabled={value >= max} onClick={() => onChange(clamp(value + 1))}>
        <Plus size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

function focusableWithin(container: HTMLElement): HTMLElement[] {
  const selector = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter((el) => el.getClientRects().length > 0);
}

export function Settings({
  theme,
  appearance,
  resolvedTheme,
  onChange,
  onReset,
  onClose,
}: SettingsProps): React.ReactElement {
  const [section, setSection] = useState<Section>("appearance");
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    shellRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  const trapFocus = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Tab") return;
    const shell = shellRef.current;
    if (!shell) return;
    const focusables = focusableWithin(shell);
    if (focusables.length === 0) {
      event.preventDefault();
      shell.focus();
      return;
    }
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const activeEl = document.activeElement;
    if (event.shiftKey) {
      if (activeEl === first || activeEl === shell || !shell.contains(activeEl)) {
        event.preventDefault();
        last.focus();
      }
    } else if (activeEl === last || !shell.contains(activeEl)) {
      event.preventDefault();
      first.focus();
    }
  };

  const active = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0]!;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        ref={shellRef}
        className="settings-shell"
        role="dialog"
        aria-modal="true"
        aria-label="設定"
        tabIndex={-1}
        onKeyDown={trapFocus}
        onClick={(event) => event.stopPropagation()}
      >
        <nav className="settings-nav" aria-label="設定カテゴリ">
          <div className="settings-nav-head">
            <span className="settings-nav-kicker">Kongyo Spec</span>
            <span className="settings-nav-title">設定</span>
          </div>
          <div className="settings-nav-list">
            {SECTIONS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-nav-item${item.id === section ? " active" : ""}`}
                  aria-current={item.id === section ? "page" : undefined}
                  onClick={() => setSection(item.id)}
                >
                  <Icon size={15} aria-hidden="true" />
                  <span className="settings-nav-item-text">
                    <span className="settings-nav-item-label">{item.label}</span>
                    <span className="settings-nav-item-hint">{item.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </nav>

        <div className="settings-main">
          <header className="settings-head">
            <div>
              <h2 className="settings-head-title">{active.label}</h2>
              <p className="settings-head-hint">{active.hint}</p>
            </div>
            <button type="button" className="settings-close" aria-label="閉じる" onClick={onClose}>
              <X size={16} aria-hidden="true" />
            </button>
          </header>

          <div className="settings-body">
            {section === "appearance" ? (
              <div className="settings-panel" key="appearance">
                <Row title="テーマ" desc="アプリ全体の配色">
                  <Segmented
                    label="テーマ"
                    value={theme}
                    options={THEME_OPTIONS}
                    onSelect={(value) => onChange({ key: "theme", value })}
                  />
                </Row>
                <Row title="アクセントカラー" desc="強調・選択・リンクの色">
                  <div className="settings-swatches" role="group" aria-label="アクセントカラー">
                    {ACCENTS.map((preset) => {
                      const selected = preset.id === appearance.accent;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          className={`settings-swatch${selected ? " active" : ""}`}
                          style={{ "--swatch": preset[resolvedTheme].base } as React.CSSProperties}
                          aria-pressed={selected}
                          aria-label={preset.label}
                          title={preset.label}
                          onClick={() => onChange({ key: "accent", value: preset.id })}
                        >
                          {selected ? <Check size={14} strokeWidth={3} aria-hidden="true" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </Row>
              </div>
            ) : section === "typography" ? (
              <div className="settings-panel" key="typography">
                <Row title="エディタの文字サイズ" desc="ソース編集時のフォント">
                  <Stepper
                    label="エディタの文字サイズ"
                    value={appearance.editorFontSize}
                    min={EDITOR_FONT_SIZE.min}
                    max={EDITOR_FONT_SIZE.max}
                    onChange={(value) => onChange({ key: "editorFontSize", value })}
                  />
                </Row>
                <Row title="プレビューの文字サイズ" desc="レンダリング本文のフォント">
                  <Stepper
                    label="プレビューの文字サイズ"
                    value={appearance.previewFontSize}
                    min={PREVIEW_FONT_SIZE.min}
                    max={PREVIEW_FONT_SIZE.max}
                    onChange={(value) => onChange({ key: "previewFontSize", value })}
                  />
                </Row>
                <Row title="本文の横幅" desc="プレビュー本文の最大幅">
                  <Segmented
                    label="本文の横幅"
                    value={appearance.readingWidth}
                    options={READING_WIDTHS.map((preset) => ({ value: preset.id, label: preset.label }))}
                    onSelect={(value) => onChange({ key: "readingWidth", value })}
                  />
                </Row>
              </div>
            ) : (
              <div className="settings-panel" key="about">
                <div className="settings-about">
                  <span className="settings-about-mark" aria-hidden="true">
                    <Sparkles size={22} />
                  </span>
                  <div className="settings-about-id">
                    <span className="settings-about-name">
                      Kongyo <span className="settings-about-name-accent">Spec</span>
                    </span>
                    {APP_VERSION ? <span className="settings-about-version">v{APP_VERSION}</span> : null}
                  </div>
                  <p className="settings-about-tagline">
                    AI 駆動開発のためのデスクトップ仕様書エディタ。仮想ページ・GFM・数式・図表をネイティブに。
                  </p>
                  <div className="settings-chips">
                    {TECH.map((tech) => (
                      <span key={tech} className="settings-chip">
                        {tech}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  className="settings-link"
                  onClick={() => void window.api.openExternal(REPO_URL).catch(() => undefined)}
                >
                  <span>GitHub リポジトリ</span>
                  <ArrowUpRight size={15} aria-hidden="true" />
                </button>
                <button type="button" className="settings-reset" onClick={onReset}>
                  <RotateCcw size={14} aria-hidden="true" />
                  設定を初期値に戻す
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
