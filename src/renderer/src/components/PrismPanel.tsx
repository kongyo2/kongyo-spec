import {
  ArrowDownToLine,
  ChevronsDown,
  ChevronsUp,
  CircleStop,
  Copy,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Replace,
  TextSelect,
  Triangle,
  Undo2,
  X,
} from "lucide-react";
import type { PrismDirection, PrismVariant } from "@shared/schemas/assist";
import { MAX_PRISM_SELECTION_CHARS, MAX_PRISM_VARIANT_CHARS } from "@shared/schemas/assist";

export type PrismPhase = "compose" | "running" | "done" | "error";

export interface PrismSession {
  phase: PrismPhase;
  direction: PrismDirection;
  selection: string;
  reading: string;
  variants: PrismVariant[];
  drafts: string[];
  replaceTargets: string[];
  replaceRange: { start: number; end: number } | null;
  servedBy: string | null;
  error: string | null;
}

export const INITIAL_PRISM_SESSION: PrismSession = {
  phase: "compose",
  direction: "abstract",
  selection: "",
  reading: "",
  variants: [],
  drafts: [],
  replaceTargets: [],
  replaceRange: null,
  servedBy: null,
  error: null,
};

interface PrismPanelProps {
  session: PrismSession;
  modelLabel: string;
  apiKeySet: boolean;
  onUpdate: (patch: Partial<PrismSession>) => void;
  onRun: (direction?: PrismDirection) => void;
  onCancel: () => void;
  onAdopt: (text: string) => void;
  onCopy: (text: string) => void;
  onPullSelection: () => void;
  onClose: () => void;
  onOpenSettings: () => void;
}

const DIRECTION_META: Record<
  PrismDirection,
  { label: string; short: string; run: string; lede: string; running: string; runningSub: string }
> = {
  abstract: {
    label: "抽象化",
    short: "抽象",
    run: "抽象化して分光",
    lede: "選んだ一節を、目的・意図に近い高度へ引き上げた複数の書き換え案に分けます。余分な具体を削り、実装の自由を取り戻します。",
    running: "高度を上げています…",
    runningSub: "意図を保ったまま、具体を削った切り口を集めています。",
  },
  concrete: {
    label: "具体化",
    short: "具体",
    run: "具体化して分光",
    lede: "選んだ一節を、検証できる振る舞いへ引き下ろした複数の書き換え案に分けます。根拠のない数値は足さず、必要なら【要確認】として残します。",
    running: "高度を下げています…",
    runningSub: "解釈の幅を狭め、検証できる切り口を集めています。",
  },
};

const SELECTION_PLACEHOLDER = [
  "抽象化・具体化したい一節を、そのまま。",
  "Source / Split モードで本文を選んで「選択範囲を取り込む」と、ここに入ります。",
  "",
  "例:",
  "検索ボックスに入力すると 300ms のデバウンスをかけて API を叩き、結果を仮想スクロールで表示する。",
].join("\n");

function DirectionToggle({
  value,
  onPick,
  idle,
}: {
  value: PrismDirection;
  onPick: (direction: PrismDirection) => void;
  idle: boolean;
}): React.ReactElement {
  return (
    <div className="prism-dir-switch" role="group" aria-label="分光の向き">
      <button
        type="button"
        className={`prism-dir${value === "abstract" ? " active" : ""}`}
        aria-pressed={value === "abstract"}
        onClick={() => onPick("abstract")}
      >
        <ChevronsUp size={15} aria-hidden="true" />
        <span className="prism-dir-label">抽象化</span>
        <span className="prism-dir-sub">意図へ引き上げる</span>
      </button>
      <button
        type="button"
        className={`prism-dir${value === "concrete" ? " active" : ""}`}
        aria-pressed={value === "concrete"}
        onClick={() => onPick("concrete")}
      >
        <ChevronsDown size={15} aria-hidden="true" />
        <span className="prism-dir-label">具体化</span>
        <span className="prism-dir-sub">{idle ? "振る舞いへ引き下ろす" : "検証可能へ落とす"}</span>
      </button>
    </div>
  );
}

export function PrismPanel({
  session,
  modelLabel,
  apiKeySet,
  onUpdate,
  onRun,
  onCancel,
  onAdopt,
  onCopy,
  onPullSelection,
  onClose,
  onOpenSettings,
}: PrismPanelProps): React.ReactElement {
  const meta = DIRECTION_META[session.direction];

  const setDraft = (index: number, value: string): void => {
    const next =
      session.drafts.length === session.variants.length ? [...session.drafts] : session.variants.map((v) => v.text);
    next[index] = value;
    onUpdate({ drafts: next });
  };

  const draftAt = (index: number): string => session.drafts[index] ?? session.variants[index]?.text ?? "";

  let body: React.ReactElement;
  if (!apiKeySet) {
    body = (
      <div className="lens-intro">
        <span className="lens-intro-mark">
          <KeyRound size={20} aria-hidden="true" />
        </span>
        <p className="lens-intro-title">Gemini API キーが必要です</p>
        <p className="lens-intro-text">設定の「AI アシスト」で Google AI Studio のキーを登録すると使えます。</p>
        <button type="button" className="lens-run" onClick={onOpenSettings}>
          設定を開く
        </button>
      </div>
    );
  } else if (session.phase === "running") {
    body = (
      <div className="lens-intro">
        <LoaderCircle className="lens-spin" size={24} aria-hidden="true" />
        <p className="lens-intro-title">{meta.running}</p>
        <p className="lens-intro-text">{meta.runningSub}</p>
        <span className="lens-model-chip">{modelLabel}</span>
        <button type="button" className="loom-ghost assist-cancel" onClick={onCancel}>
          <CircleStop size={13} aria-hidden="true" />
          中止
        </button>
      </div>
    );
  } else if (session.phase === "error") {
    body = (
      <div className="lens-intro">
        <p className="lens-intro-title">分光できませんでした</p>
        <p className="lens-error-text">{session.error}</p>
        <button type="button" className="lens-run" onClick={() => onRun()}>
          <RefreshCw size={14} aria-hidden="true" />
          再試行
        </button>
      </div>
    );
  } else if (session.phase === "done") {
    const variants = session.variants;
    body = (
      <>
        <section className="loom-block">
          <header className="loom-block-head">
            <span className="loom-block-label">
              {session.direction === "abstract" ? (
                <ChevronsUp size={13} aria-hidden="true" />
              ) : (
                <ChevronsDown size={13} aria-hidden="true" />
              )}
              {meta.label}の案
            </span>
            <span className="loom-block-count">{variants.length} 通り</span>
          </header>
          {session.reading.length > 0 ? (
            <p className="prism-reading">
              <Triangle size={12} aria-hidden="true" />
              <span>{session.reading}</span>
            </p>
          ) : null}
          <div className="prism-variants">
            {variants.map((variant, index) => (
              <article className="prism-variant" key={index}>
                <header className="prism-variant-head">
                  <span className="prism-variant-label">{variant.label}</span>
                  <button
                    type="button"
                    className="prism-variant-copy"
                    title="この案をコピー"
                    aria-label={`案「${variant.label}」をコピー`}
                    onClick={() => onCopy(draftAt(index))}
                  >
                    <Copy size={12} aria-hidden="true" />
                  </button>
                </header>
                <textarea
                  className="prism-variant-text"
                  value={draftAt(index)}
                  maxLength={MAX_PRISM_VARIANT_CHARS}
                  spellCheck={false}
                  aria-label={`案「${variant.label}」(採用前に編集できます)`}
                  onChange={(event) => setDraft(index, event.target.value)}
                />
                {variant.note.length > 0 ? <p className="prism-variant-note">{variant.note}</p> : null}
                <button
                  type="button"
                  className="lens-run prism-adopt"
                  disabled={draftAt(index).trim().length === 0}
                  onClick={() => onAdopt(draftAt(index))}
                >
                  {session.replaceTargets.length > 0 ? (
                    <Replace size={13} aria-hidden="true" />
                  ) : (
                    <ArrowDownToLine size={13} aria-hidden="true" />
                  )}
                  {session.replaceTargets.length > 0 ? "選択箇所と置き換え" : "エディタへ挿入"}
                </button>
              </article>
            ))}
          </div>
        </section>
        <section className="loom-block">
          <header className="loom-block-head">
            <span className="loom-block-label">
              <RefreshCw size={13} aria-hidden="true" />
              もう一度分ける
            </span>
          </header>
          <div className="prism-redo" role="group" aria-label="別の向きで分光し直す">
            <button
              type="button"
              className={`loom-option${session.direction === "abstract" ? " selected" : ""}`}
              onClick={() => onRun("abstract")}
            >
              <ChevronsUp size={13} aria-hidden="true" />
              抽象化で
            </button>
            <button
              type="button"
              className={`loom-option${session.direction === "concrete" ? " selected" : ""}`}
              onClick={() => onRun("concrete")}
            >
              <ChevronsDown size={13} aria-hidden="true" />
              具体化で
            </button>
          </div>
          <button
            type="button"
            className="loom-ghost"
            onClick={() => onUpdate({ phase: "compose", variants: [], drafts: [], reading: "", error: null })}
          >
            <Undo2 size={13} aria-hidden="true" />
            一節を選び直す
          </button>
        </section>
        <p className="lens-meta">{session.servedBy ?? modelLabel}</p>
      </>
    );
  } else {
    const ready = session.selection.trim().length > 0;
    body = (
      <div className="loom-compose">
        <p className="loom-lede">{meta.lede}</p>
        <DirectionToggle value={session.direction} onPick={(direction) => onUpdate({ direction })} idle={!ready} />
        <textarea
          className="loom-material prism-selection"
          value={session.selection}
          maxLength={MAX_PRISM_SELECTION_CHARS}
          placeholder={SELECTION_PLACEHOLDER}
          spellCheck={false}
          aria-label="分光する一節"
          onChange={(event) => onUpdate({ selection: event.target.value, replaceTargets: [], replaceRange: null })}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              onRun();
            }
          }}
        />
        <div className="loom-compose-row">
          <button
            type="button"
            className="loom-ghost"
            title="Source / Split モードで選択した範囲を取り込み、採用時にその箇所を置き換えます"
            onClick={onPullSelection}
          >
            <TextSelect size={13} aria-hidden="true" />
            選択範囲を取り込む
          </button>
          {session.replaceTargets.length > 0 ? (
            <button
              type="button"
              className="loom-target-chip"
              title="採用時にこの箇所を置き換えます。クリックで解除"
              onClick={() => onUpdate({ replaceTargets: [], replaceRange: null })}
            >
              置き換え対象 {session.replaceTargets[0]!.length} 字
              <X size={11} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <button type="button" className="lens-run loom-weave" disabled={!ready} onClick={() => onRun()}>
          {session.direction === "abstract" ? (
            <ChevronsUp size={14} aria-hidden="true" />
          ) : (
            <ChevronsDown size={14} aria-hidden="true" />
          )}
          {meta.run}
        </button>
        <p className="loom-hint">
          一節を {DIRECTION_META.abstract.short}・{DIRECTION_META.concrete.short}{" "}
          それぞれ複数の切り口に分け、選んで本文へ。Ctrl/⌘+Enter でも分光します。
        </p>
        <span className="lens-model-chip">{modelLabel}</span>
      </div>
    );
  }

  return (
    <aside className="lens-panel prism-panel" aria-label="Prism 抽象度の分光">
      <div className="lens-head">
        <span className="sidebar-heading">Prism</span>
        <div className="lens-head-actions">
          <button
            type="button"
            className="lens-head-button"
            title="閉じる"
            aria-label="Prism を閉じる"
            onClick={onClose}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="lens-body">{body}</div>
    </aside>
  );
}
