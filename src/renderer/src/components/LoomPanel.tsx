import { useRef } from "react";
import {
  ArrowDownToLine,
  CircleStop,
  Combine,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Replace,
  Spool,
  TextSelect,
  Undo2,
  X,
} from "lucide-react";
import type { WeaveResult } from "@shared/schemas/assist";
import { MAX_WEAVE_MATERIAL_CHARS, MAX_WEAVE_WOVEN_CHARS } from "@shared/schemas/assist";

export type LoomPhase = "compose" | "running" | "done" | "error";
export type WeaveKind = "compose" | "reweave";

export interface LoomSession {
  phase: LoomPhase;
  material: string;
  result: WeaveResult | null;
  woven: string;
  answers: string[];
  replaceTargets: string[];
  servedBy: string | null;
  error: string | null;
}

export const INITIAL_LOOM_SESSION: LoomSession = {
  phase: "compose",
  material: "",
  result: null,
  woven: "",
  answers: [],
  replaceTargets: [],
  servedBy: null,
  error: null,
};

interface LoomPanelProps {
  session: LoomSession;
  modelLabel: string;
  apiKeySet: boolean;
  onUpdate: (patch: Partial<LoomSession>) => void;
  onWeave: (kind: WeaveKind) => void;
  onRetry: () => void;
  onCancel: () => void;
  onInsert: () => void;
  onPullSelection: () => void;
  onClose: () => void;
  onOpenSettings: () => void;
}

const MATERIAL_PLACEHOLDER = [
  "メモ・箇条書き・決定事項の断片を、そのまま。",
  "",
  "例:",
  "- 通知が多すぎるという苦情が続いている",
  "- ダイジェストにまとめたい。頻度はユーザーごとに違う",
  "- 既読のものは出さない",
].join("\n");

export function LoomPanel({
  session,
  modelLabel,
  apiKeySet,
  onUpdate,
  onWeave,
  onRetry,
  onCancel,
  onInsert,
  onPullSelection,
  onClose,
  onOpenSettings,
}: LoomPanelProps): React.ReactElement {
  const answerRefs = useRef<(HTMLInputElement | null)[]>([]);

  const setAnswer = (index: number, value: string): void => {
    const next = [...session.answers];
    next[index] = value;
    onUpdate({ answers: next });
  };

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
        <p className="lens-intro-title">織っています…</p>
        <p className="lens-intro-text">あなたの言葉を仕様の形に。決めるべき問いを集めています。</p>
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
        <p className="lens-intro-title">織れませんでした</p>
        <p className="lens-error-text">{session.error}</p>
        <button type="button" className="lens-run" onClick={onRetry}>
          <RefreshCw size={14} aria-hidden="true" />
          再試行
        </button>
      </div>
    );
  } else if (session.phase === "done" && session.result !== null) {
    const questions = session.result.questions;
    const answeredCount = session.answers.filter((answer) => answer.trim().length > 0).length;
    body = (
      <>
        <section className="loom-block">
          <header className="loom-block-head">
            <span className="loom-block-label">織り上がり</span>
            {session.woven.length > 0 ? <span className="loom-block-count">{session.woven.length} 字</span> : null}
          </header>
          <textarea
            className="loom-woven"
            value={session.woven}
            maxLength={MAX_WEAVE_WOVEN_CHARS}
            placeholder="問いに答えて「織り込む」と、ここに本文が現れます。"
            spellCheck={false}
            aria-label="織り上がり(挿入前に編集できます)"
            onChange={(event) => onUpdate({ woven: event.target.value })}
          />
          <div className="loom-actions">
            <button type="button" className="lens-run" disabled={session.woven.trim().length === 0} onClick={onInsert}>
              {session.replaceTargets.length > 0 ? (
                <Replace size={14} aria-hidden="true" />
              ) : (
                <ArrowDownToLine size={14} aria-hidden="true" />
              )}
              {session.replaceTargets.length > 1
                ? `${session.replaceTargets.length} 箇所と置き換え`
                : session.replaceTargets.length === 1
                  ? "選択箇所と置き換え"
                  : "エディタへ挿入"}
            </button>
            <button
              type="button"
              className="loom-ghost"
              onClick={() => onUpdate({ phase: "compose", result: null, woven: "", answers: [], error: null })}
            >
              <Undo2 size={13} aria-hidden="true" />
              素材に戻る
            </button>
          </div>
        </section>

        {questions.length > 0 ? (
          <section className="loom-block">
            <header className="loom-block-head">
              <span className="loom-block-label">問い — あなたが決めること</span>
              <span className="loom-block-count">
                {answeredCount}/{questions.length}
              </span>
            </header>
            <div className="loom-questions">
              {questions.map((question, index) => (
                <article className="loom-question" key={index}>
                  <span className="loom-topic">{question.topic}</span>
                  <p className="loom-question-text">{question.question}</p>
                  {question.whyItMatters.length > 0 ? (
                    <p className="loom-question-why">{question.whyItMatters}</p>
                  ) : null}
                  {question.options.length > 0 ? (
                    <div className="loom-options" role="group" aria-label="考えられる方向">
                      {question.options.map((option) => (
                        <button
                          type="button"
                          key={option}
                          className={`loom-option${session.answers[index] === option ? " selected" : ""}`}
                          onClick={() => setAnswer(index, session.answers[index] === option ? "" : option)}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <input
                    ref={(node) => {
                      answerRefs.current[index] = node;
                    }}
                    className="loom-answer"
                    value={session.answers[index] ?? ""}
                    placeholder="あなたの決定(空欄なら未決定のまま)"
                    aria-label={`問い ${index + 1} への回答`}
                    onChange={(event) => setAnswer(index, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      answerRefs.current[index + 1]?.focus();
                    }}
                  />
                </article>
              ))}
            </div>
            <button
              type="button"
              className="lens-run loom-reweave"
              disabled={answeredCount === 0}
              onClick={() => onWeave("reweave")}
            >
              <Combine size={14} aria-hidden="true" />
              回答を織り込む
            </button>
          </section>
        ) : null}
        <p className="lens-meta">{session.servedBy ?? modelLabel}</p>
      </>
    );
  } else {
    const hasMaterial = session.material.trim().length > 0;
    body = (
      <div className="loom-compose">
        <p className="loom-lede">
          Loom はあなたの言葉だけで仕様を織ります。素材に無いことは書かず、足りないことは「問い」として返します。
        </p>
        <textarea
          className="loom-material"
          value={session.material}
          maxLength={MAX_WEAVE_MATERIAL_CHARS}
          placeholder={MATERIAL_PLACEHOLDER}
          spellCheck={false}
          aria-label="素材(メモ・箇条書き)"
          onChange={(event) => onUpdate({ material: event.target.value })}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              onWeave("compose");
            }
          }}
        />
        <div className="loom-compose-row">
          <button
            type="button"
            className="loom-ghost"
            title="Source モードで選択した範囲を素材に追加し、挿入時に置き換えます"
            onClick={onPullSelection}
          >
            <TextSelect size={13} aria-hidden="true" />
            選択範囲を取り込む
          </button>
          {session.replaceTargets.length > 0 ? (
            <button
              type="button"
              className="loom-target-chip"
              title="挿入時に取り込んだ選択範囲をすべて置き換えます。クリックで解除"
              onClick={() => onUpdate({ replaceTargets: [] })}
            >
              置き換え対象{" "}
              {session.replaceTargets.length > 1
                ? `${session.replaceTargets.length} 箇所`
                : `${session.replaceTargets[0]!.length} 字`}
              <X size={11} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <button type="button" className="lens-run loom-weave" onClick={() => onWeave("compose")}>
          <Spool size={14} aria-hidden="true" />
          {hasMaterial ? "織る" : "問いから始める"}
        </button>
        <p className="loom-hint">
          {hasMaterial ? "Ctrl/⌘+Enter でも織れます。" : "素材が空のときは、仕様の骨格を立ち上げる問いだけが返ります。"}
        </p>
        <span className="lens-model-chip">{modelLabel}</span>
      </div>
    );
  }

  return (
    <aside className="lens-panel loom-panel" aria-label="Loom 仕様の織り">
      <div className="lens-head">
        <span className="sidebar-heading">Loom</span>
        <div className="lens-head-actions">
          <button
            type="button"
            className="lens-head-button"
            title="閉じる"
            aria-label="Loom を閉じる"
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
