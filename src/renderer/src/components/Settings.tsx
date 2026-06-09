import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ListOrdered,
  type LucideIcon,
  Minus,
  Monitor,
  Moon,
  Palette,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Sun,
  Telescope,
  Trash2,
  Type,
  X,
} from "lucide-react";
import {
  type Accent,
  EDITOR_FONT_SIZE,
  LLM_TEMPERATURE,
  llmProfileDisplayName,
  type LlmProvider,
  MAX_LLM_FALLBACKS,
  type MermaidRenderer,
  PREVIEW_FONT_SIZE,
  type ReadingWidth,
  type RendererLlmProfile,
  type ThemePreference,
  type UpsertLlmProfileInput,
} from "@shared/schemas/settings";
import { ACCENTS, type AppearanceSettings, READING_WIDTHS } from "../lib/appearance";
import type { ResolvedTheme } from "../lib/theme";

export type SettingChange =
  | { key: "theme"; value: ThemePreference }
  | { key: "accent"; value: Accent }
  | { key: "editorFontSize"; value: number }
  | { key: "previewFontSize"; value: number }
  | { key: "readingWidth"; value: ReadingWidth }
  | { key: "mermaidRenderer"; value: MermaidRenderer };

export interface LlmSettings {
  geminiApiKeySet: boolean;
  profiles: RendererLlmProfile[];
  mainId: string;
  fallbackIds: string[];
  storedCount: number;
}

interface SettingsProps {
  theme: ThemePreference;
  appearance: AppearanceSettings;
  resolvedTheme: ResolvedTheme;
  mermaidRenderer: MermaidRenderer;
  llm: LlmSettings;
  onChange: (change: SettingChange) => void;
  onSaveApiKey: (key: string | null) => Promise<boolean>;
  onUpsertProfile: (input: UpsertLlmProfileInput) => Promise<boolean>;
  onDeleteProfile: (id: string) => Promise<boolean>;
  onSetRouting: (mainId: string, fallbackIds: string[]) => void;
  onReset: () => void;
  onClose: () => void;
}

type Section = "appearance" | "typography" | "ai" | "about";

const SECTIONS: { id: Section; label: string; hint: string; icon: LucideIcon }[] = [
  { id: "appearance", label: "外観", hint: "テーマとアクセント", icon: Palette },
  { id: "typography", label: "タイポグラフィ", hint: "文字サイズと横幅", icon: Type },
  { id: "ai", label: "AI アシスト", hint: "モデル · Loom · Lens", icon: Telescope },
  { id: "about", label: "情報", hint: "バージョンと構成", icon: Sparkles },
];

const AI_STUDIO_URL = "https://aistudio.google.com/apikey";

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

const MERMAID_OPTIONS: { value: MermaidRenderer; label: string }[] = [
  { value: "classic", label: "標準" },
  { value: "beautiful", label: "Beautiful" },
];

const PROVIDER_LABEL: Record<LlmProvider, string> = {
  gemini: "Gemini",
  openai: "OpenAI 互換",
};

const PROVIDER_OPTIONS: { value: LlmProvider; label: string }[] = [
  { value: "gemini", label: "Gemini" },
  { value: "openai", label: "OpenAI 互換" },
];

const TECH = ["GFM", "Shiki", "KaTeX", "Mermaid"];
const REPO_URL = "https://github.com/kongyo2/kongyo-spec";
const APP_VERSION = __APP_VERSION__;

interface ProfileDraft {
  id: string | null;
  label: string;
  provider: LlmProvider;
  model: string;
  baseUrl: string;
  temperature: string;
  apiKey: string;
  clearKey: boolean;
  apiKeySet: boolean;
  keyProvider: LlmProvider | null;
  keyBaseUrl: string | null;
}

const NEW_PROFILE_DRAFT: ProfileDraft = {
  id: null,
  label: "",
  provider: "openai",
  model: "",
  baseUrl: "",
  temperature: "",
  apiKey: "",
  clearKey: false,
  apiKeySet: false,
  keyProvider: null,
  keyBaseUrl: null,
};

function draftFromProfile(profile: RendererLlmProfile): ProfileDraft {
  return {
    id: profile.id,
    label: profile.label,
    provider: profile.provider,
    model: profile.model,
    baseUrl: profile.baseUrl ?? "",
    temperature: profile.temperature !== null ? String(profile.temperature) : "",
    apiKey: "",
    clearKey: false,
    apiKeySet: profile.apiKeySet,
    keyProvider: profile.apiKeySet ? profile.provider : null,
    keyBaseUrl: profile.baseUrl,
  };
}

function endpointHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

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

function ProfileEditor({
  draft,
  saving,
  onDraft,
  onSave,
  onCancel,
}: {
  draft: ProfileDraft;
  saving: boolean;
  onDraft: (next: ProfileDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}): React.ReactElement {
  const modelOk = draft.model.trim().length > 0 && !/[\s　]/.test(draft.model.trim());
  const urlOk = draft.baseUrl.trim().length === 0 || /^https?:\/\//i.test(draft.baseUrl.trim());
  const tempRaw = draft.temperature.trim();
  const tempValue = Number(tempRaw);
  const tempOk =
    tempRaw.length === 0 ||
    (Number.isFinite(tempValue) && tempValue >= LLM_TEMPERATURE.min && tempValue <= LLM_TEMPERATURE.max);
  const valid = modelOk && urlOk && tempOk;
  const draftBaseUrl = draft.baseUrl.trim().length > 0 ? draft.baseUrl.trim() : null;
  const keyCarries = draft.apiKeySet && draft.keyProvider === draft.provider && draft.keyBaseUrl === draftBaseUrl;

  return (
    <div className="settings-llm-editor">
      <div className="settings-llm-editor-grid">
        <label className="settings-llm-field">
          <span>プロバイダ</span>
          <Segmented
            label="プロバイダ"
            value={draft.provider}
            options={PROVIDER_OPTIONS}
            onSelect={(value) => onDraft({ ...draft, provider: value })}
          />
        </label>
        <label className="settings-llm-field">
          <span>表示名(任意)</span>
          <input
            className="settings-key-input"
            value={draft.label}
            maxLength={60}
            placeholder="例: 速いやつ / 社内 LLM"
            spellCheck={false}
            onChange={(event) => onDraft({ ...draft, label: event.target.value })}
          />
        </label>
        <label className="settings-llm-field">
          <span>モデル名</span>
          <input
            className={`settings-key-input${draft.model.length > 0 && !modelOk ? " invalid" : ""}`}
            value={draft.model}
            maxLength={200}
            placeholder={draft.provider === "gemini" ? "gemini-3.5-flash" : "gpt-5.2-mini / qwen3 など"}
            spellCheck={false}
            onChange={(event) => onDraft({ ...draft, model: event.target.value })}
          />
        </label>
        <label className="settings-llm-field">
          <span>temperature(空欄 = 既定)</span>
          <input
            className={`settings-key-input${tempOk ? "" : " invalid"}`}
            type="number"
            value={draft.temperature}
            min={LLM_TEMPERATURE.min}
            max={LLM_TEMPERATURE.max}
            step={0.1}
            placeholder="Lens 0.2 / Loom 0.3"
            onChange={(event) => onDraft({ ...draft, temperature: event.target.value })}
          />
        </label>
        <label className="settings-llm-field wide">
          <span>エンドポイント{draft.provider === "openai" ? "(OpenAI 互換 /v1)" : "(任意)"}</span>
          <input
            className={`settings-key-input${urlOk ? "" : " invalid"}`}
            value={draft.baseUrl}
            maxLength={2000}
            placeholder={
              draft.provider === "openai" ? "https://api.openai.com/v1(空欄 = OpenAI)" : "空欄 = Google 既定"
            }
            spellCheck={false}
            onChange={(event) => onDraft({ ...draft, baseUrl: event.target.value })}
          />
        </label>
        <label className="settings-llm-field wide">
          <span>API キー</span>
          <div className="settings-llm-key-row">
            <input
              className="settings-key-input"
              type="password"
              value={draft.apiKey}
              maxLength={4096}
              autoComplete="off"
              spellCheck={false}
              disabled={draft.clearKey}
              placeholder={
                draft.clearKey
                  ? "保存時にキーを削除します"
                  : keyCarries
                    ? "設定済み — 変更する場合のみ入力"
                    : draft.apiKeySet
                      ? "接続先変更により保存時にキーは破棄されます"
                      : draft.provider === "gemini"
                        ? "空欄 = 共通の Gemini キーを使用"
                        : "空欄 = キーなしで接続(ローカル LLM 等)"
              }
              onChange={(event) => onDraft({ ...draft, apiKey: event.target.value })}
            />
            {keyCarries ? (
              <button
                type="button"
                className={`settings-llm-keyclear${draft.clearKey ? " active" : ""}`}
                aria-pressed={draft.clearKey}
                onClick={() => onDraft({ ...draft, clearKey: !draft.clearKey, apiKey: "" })}
              >
                キーを削除
              </button>
            ) : null}
          </div>
        </label>
      </div>
      <div className="settings-llm-editor-actions">
        <button type="button" className="settings-key-save" disabled={!valid || saving} onClick={onSave}>
          {saving ? "保存中…" : "保存"}
        </button>
        <button type="button" className="settings-llm-cancel" onClick={onCancel}>
          キャンセル
        </button>
      </div>
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
  mermaidRenderer,
  llm,
  onChange,
  onSaveApiKey,
  onUpsertProfile,
  onDeleteProfile,
  onSetRouting,
  onReset,
  onClose,
}: SettingsProps): React.ReactElement {
  const [section, setSection] = useState<Section>("appearance");
  const [keyDraft, setKeyDraft] = useState("");
  const [keySaving, setKeySaving] = useState(false);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [deleteArmedId, setDeleteArmedId] = useState<string | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  const submitKeyDraft = (): void => {
    const trimmed = keyDraft.trim();
    if (trimmed.length === 0 || keySaving) return;
    setKeySaving(true);
    void onSaveApiKey(trimmed)
      .then((saved) => {
        if (saved) setKeyDraft("");
      })
      .finally(() => setKeySaving(false));
  };

  const submitProfileDraft = (): void => {
    if (profileDraft === null || profileSaving) return;
    const tempRaw = profileDraft.temperature.trim();
    const input: UpsertLlmProfileInput = {
      profile: {
        ...(profileDraft.id !== null ? { id: profileDraft.id } : {}),
        label: profileDraft.label.trim(),
        provider: profileDraft.provider,
        model: profileDraft.model.trim(),
        baseUrl: profileDraft.baseUrl.trim().length > 0 ? profileDraft.baseUrl.trim() : null,
        temperature: tempRaw.length > 0 ? Number(tempRaw) : null,
      },
      ...(profileDraft.clearKey
        ? { apiKey: null }
        : profileDraft.apiKey.trim().length > 0
          ? { apiKey: profileDraft.apiKey.trim() }
          : {}),
    };
    setProfileSaving(true);
    void onUpsertProfile(input)
      .then((saved) => {
        if (saved) setProfileDraft(null);
      })
      .finally(() => setProfileSaving(false));
  };

  const setMainProfile = (id: string): void => {
    onSetRouting(
      id,
      llm.fallbackIds.filter((fallbackId) => fallbackId !== id),
    );
  };

  const fallbacksFull = llm.fallbackIds.length >= MAX_LLM_FALLBACKS;

  const toggleFallback = (id: string): void => {
    const has = llm.fallbackIds.includes(id);
    if (!has && fallbacksFull) return;
    const next = has ? llm.fallbackIds.filter((fallbackId) => fallbackId !== id) : [...llm.fallbackIds, id];
    onSetRouting(llm.mainId, next);
  };

  const requestDelete = (id: string): void => {
    if (deleteArmedId !== id) {
      setDeleteArmedId(id);
      return;
    }
    setDeleteArmedId(null);
    if (profileDraft?.id === id) setProfileDraft(null);
    void onDeleteProfile(id);
  };

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
                <Row title="Mermaid 描画" desc="図表のレンダリングエンジン。Beautiful は Vercel 製の洗練された描画">
                  <Segmented
                    label="Mermaid 描画"
                    value={mermaidRenderer}
                    options={MERMAID_OPTIONS}
                    onSelect={(value) => onChange({ key: "mermaidRenderer", value })}
                  />
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
            ) : section === "ai" ? (
              <div className="settings-panel" key="ai">
                <p className="settings-ai-philosophy">
                  仕様書の著者はあなたです。Loom はあなたの言葉だけを仕様に織り上げ、Lens
                  は削るべき過剰な具体と人間が決めるべき問いだけを返します。
                </p>
                <div className="settings-row stack">
                  <div className="settings-row-label">
                    <span className="settings-row-title">
                      Gemini API キー(共通)
                      <span className={`settings-key-state${llm.geminiApiKeySet ? " set" : ""}`}>
                        {llm.geminiApiKeySet ? "設定済み" : "未設定"}
                      </span>
                    </span>
                    <span className="settings-row-desc">
                      Gemini プロバイダのモデルが既定で使うキー。OS
                      の安全な保存領域で暗号化され、この端末にのみ保存されます。
                    </span>
                  </div>
                  <div className="settings-key-controls">
                    <input
                      type="password"
                      className="settings-key-input"
                      value={keyDraft}
                      placeholder={llm.geminiApiKeySet ? "変更する場合のみ入力" : "AIza…"}
                      autoComplete="off"
                      spellCheck={false}
                      aria-label="Gemini API キー"
                      onChange={(event) => setKeyDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") submitKeyDraft();
                      }}
                    />
                    <button
                      type="button"
                      className="settings-key-save"
                      disabled={keyDraft.trim().length === 0 || keySaving}
                      onClick={submitKeyDraft}
                    >
                      {keySaving ? "保存中…" : "保存"}
                    </button>
                    {llm.geminiApiKeySet ? (
                      <button type="button" className="settings-key-remove" onClick={() => void onSaveApiKey(null)}>
                        削除
                      </button>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="settings-inline-link"
                    onClick={() => void window.api.openExternal(AI_STUDIO_URL).catch(() => undefined)}
                  >
                    Google AI Studio でキーを取得
                    <ArrowUpRight size={13} aria-hidden="true" />
                  </button>
                </div>

                <div className="settings-row stack">
                  <div className="settings-row-label">
                    <span className="settings-row-title">モデル</span>
                    <span className="settings-row-desc">
                      Loom と Lens が使うモデル。モデル名・temperature・エンドポイントは自由に設定でき、OpenAI 互換 API
                      も登録できます。メインが失敗するとフォールバックを ON にした順に試します。
                    </span>
                  </div>
                  <div className="settings-llm-list" role="list">
                    {llm.profiles.map((profile) => {
                      const isMain = profile.id === llm.mainId;
                      const fallbackIndex = llm.fallbackIds.indexOf(profile.id);
                      const detail = [
                        PROVIDER_LABEL[profile.provider],
                        profile.model,
                        ...(profile.baseUrl !== null ? [endpointHost(profile.baseUrl)] : []),
                        ...(profile.temperature !== null ? [`T=${profile.temperature}`] : []),
                      ].join(" · ");
                      return (
                        <div key={profile.id} className={`settings-llm-row${isMain ? " main" : ""}`} role="listitem">
                          <button
                            type="button"
                            className={`settings-llm-radio${isMain ? " active" : ""}`}
                            role="radio"
                            aria-checked={isMain}
                            aria-label={`${llmProfileDisplayName(profile)} をメインにする`}
                            title="メインにする"
                            onClick={() => setMainProfile(profile.id)}
                          >
                            <span aria-hidden="true" />
                          </button>
                          <div className="settings-llm-id">
                            <span className="settings-llm-name">
                              {llmProfileDisplayName(profile)}
                              {isMain ? <span className="settings-llm-main-chip">メイン</span> : null}
                            </span>
                            <span className="settings-llm-sub">{detail}</span>
                          </div>
                          <div className="settings-llm-actions">
                            {!isMain ? (
                              <button
                                type="button"
                                className={`settings-llm-fb${fallbackIndex >= 0 ? " active" : ""}`}
                                aria-pressed={fallbackIndex >= 0}
                                disabled={fallbackIndex < 0 && fallbacksFull}
                                title={
                                  fallbackIndex < 0 && fallbacksFull
                                    ? `フォールバックは最大 ${MAX_LLM_FALLBACKS} 件です`
                                    : "フォールバックに含める(ON にした順に試行)"
                                }
                                onClick={() => toggleFallback(profile.id)}
                              >
                                <ListOrdered size={12} aria-hidden="true" />
                                {fallbackIndex >= 0 ? `FB ${fallbackIndex + 1}` : "FB"}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="settings-llm-iconbtn"
                              aria-label={`${llmProfileDisplayName(profile)} を編集`}
                              title="編集"
                              onClick={() => {
                                setDeleteArmedId(null);
                                setProfileDraft(draftFromProfile(profile));
                              }}
                            >
                              <Pencil size={13} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className={`settings-llm-iconbtn danger${deleteArmedId === profile.id ? " armed" : ""}`}
                              aria-label={`${llmProfileDisplayName(profile)} を削除`}
                              title={
                                llm.storedCount === 0
                                  ? "内蔵の既定モデルは削除できません"
                                  : deleteArmedId === profile.id
                                    ? "もう一度クリックで削除"
                                    : "削除"
                              }
                              disabled={llm.storedCount === 0}
                              onClick={() => requestDelete(profile.id)}
                            >
                              <Trash2 size={13} aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {profileDraft !== null ? (
                    <ProfileEditor
                      draft={profileDraft}
                      saving={profileSaving}
                      onDraft={setProfileDraft}
                      onSave={submitProfileDraft}
                      onCancel={() => setProfileDraft(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      className="settings-llm-add"
                      onClick={() => {
                        setDeleteArmedId(null);
                        setProfileDraft(NEW_PROFILE_DRAFT);
                      }}
                    >
                      <Plus size={14} aria-hidden="true" />
                      モデルを追加
                    </button>
                  )}
                </div>
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
