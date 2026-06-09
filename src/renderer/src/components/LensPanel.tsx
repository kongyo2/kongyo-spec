import { useEffect, useState } from "react";
import {
  Check,
  CornerDownRight,
  KeyRound,
  LoaderCircle,
  MessageCircleQuestionMark,
  RefreshCw,
  Replace,
  Telescope,
  X,
} from "lucide-react";
import type { FindingKind, LensFinding, LensReport } from "@shared/schemas/assist";
import type { GeminiModel } from "@shared/schemas/settings";

export type LensState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; report: LensReport }
  | { status: "error"; message: string };

interface LensPanelProps {
  state: LensState;
  model: GeminiModel;
  apiKeySet: boolean;
  docContent: string;
  onRun: () => void;
  onClose: () => void;
  onApply: (excerpt: string, rewrite: string) => boolean;
  onJump: (excerpt: string) => void;
  onOpenSettings: () => void;
}

const KIND_META: Record<FindingKind, { label: string; hint: string }> = {
  overspec: { label: "過剰具体", hint: "実装の自由を不必要に奪っている記述" },
  speculation: { label: "推測", hint: "根拠が書かれていない具体値・選択" },
  decision: { label: "未決定", hint: "人間が決めるべき未記載の事項" },
};

const MODEL_LABEL: Record<GeminiModel, string> = {
  "gemini-2.5-flash-lite": "Gemini 2.5 Flash-Lite",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "gemini-2.5-pro": "Gemini 2.5 Pro",
};

function AltitudeMeter({ report }: { report: LensReport }): React.ReactElement {
  const { intent, behavior, implementation } = report.altitude;
  const total = Math.max(1, intent + behavior + implementation);
  const pct = {
    intent: Math.round((intent / total) * 100),
    behavior: Math.round((behavior / total) * 100),
    implementation: Math.round((implementation / total) * 100),
  };
  const segments = [
    { key: "intent", label: "意図", value: pct.intent },
    { key: "behavior", label: "振る舞い", value: pct.behavior },
    { key: "implementation", label: "実装", value: pct.implementation },
  ];
  return (
    <div className="lens-altitude">
      <div className="lens-altitude-bar" role="img" aria-label="仕様書の高度バランス">
        {segments.map((seg) =>
          seg.value > 0 ? <span key={seg.key} className={`seg-${seg.key}`} style={{ width: `${seg.value}%` }} /> : null,
        )}
      </div>
      <div className="lens-altitude-legend">
        {segments.map((seg) => (
          <span key={seg.key} className="lens-altitude-key">
            <i className={`seg-${seg.key}`} aria-hidden="true" />
            {seg.label} {seg.value}%
          </span>
        ))}
      </div>
    </div>
  );
}

function FindingCard({
  finding,
  applied,
  applicable,
  onApply,
  onJump,
  onDismiss,
}: {
  finding: LensFinding;
  applied: boolean;
  applicable: boolean;
  onApply: () => void;
  onJump: () => void;
  onDismiss: () => void;
}): React.ReactElement {
  const meta = KIND_META[finding.kind];
  return (
    <article className={`lens-finding kind-${finding.kind}`}>
      <header className="lens-finding-head">
        <span className="lens-kind-badge" title={meta.hint}>
          {meta.label}
        </span>
        <button type="button" className="lens-dismiss" aria-label="この指摘を確認済みにする" onClick={onDismiss}>
          <X size={13} aria-hidden="true" />
        </button>
      </header>
      {finding.excerpt.length > 0 ? (
        <button type="button" className="lens-excerpt" title="該当箇所を表示" onClick={onJump}>
          {finding.excerpt}
        </button>
      ) : null}
      <p className="lens-reason">{finding.reason}</p>
      {finding.question !== null ? (
        <p className="lens-question">
          <MessageCircleQuestionMark size={13} aria-hidden="true" />
          <span>{finding.question}</span>
        </p>
      ) : null}
      {finding.rewrite !== null ? (
        <div className="lens-rewrite">
          <div className="lens-rewrite-text">
            <CornerDownRight size={13} aria-hidden="true" />
            <span>{finding.rewrite}</span>
          </div>
          {applied ? (
            <span className="lens-applied">
              <Check size={13} aria-hidden="true" />
              適用しました
            </span>
          ) : (
            <button type="button" className="lens-apply" disabled={!applicable} onClick={onApply}>
              <Replace size={13} aria-hidden="true" />
              {applicable ? "書き換えを適用" : "本文と一致しません"}
            </button>
          )}
        </div>
      ) : null}
    </article>
  );
}

export function LensPanel({
  state,
  model,
  apiKeySet,
  docContent,
  onRun,
  onClose,
  onApply,
  onJump,
  onOpenSettings,
}: LensPanelProps): React.ReactElement {
  const [applied, setApplied] = useState<ReadonlySet<number>>(new Set());
  const [dismissed, setDismissed] = useState<ReadonlySet<number>>(new Set());

  const report = state.status === "done" ? state.report : null;
  useEffect(() => {
    setApplied(new Set());
    setDismissed(new Set());
  }, [report]);

  const handleApply = (index: number, finding: LensFinding): void => {
    if (finding.rewrite === null) return;
    if (onApply(finding.excerpt, finding.rewrite)) {
      setApplied((prev) => new Set(prev).add(index));
    }
  };

  let body: React.ReactElement;
  if (state.status === "running") {
    body = (
      <div className="lens-intro">
        <LoaderCircle className="lens-spin" size={24} aria-hidden="true" />
        <p className="lens-intro-title">仕様書を読んでいます…</p>
        <p className="lens-intro-text">削るべき具体と、決めるべき問いを探しています。</p>
        <span className="lens-model-chip">{MODEL_LABEL[model]}</span>
      </div>
    );
  } else if (state.status === "error") {
    body = (
      <div className="lens-intro">
        <p className="lens-intro-title">レビューできませんでした</p>
        <p className="lens-error-text">{state.message}</p>
        <button type="button" className="lens-run" onClick={onRun}>
          <RefreshCw size={14} aria-hidden="true" />
          再試行
        </button>
      </div>
    );
  } else if (state.status === "done") {
    const findings = state.report.findings;
    const visible = findings.map((finding, index) => ({ finding, index })).filter(({ index }) => !dismissed.has(index));
    body = (
      <>
        <p className="lens-verdict">{state.report.verdict}</p>
        <AltitudeMeter report={state.report} />
        {findings.length === 0 ? (
          <div className="lens-clear">
            <Check size={16} aria-hidden="true" />
            <p>指摘はありません。この高度のまま実装に渡せます。</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="lens-clear">
            <Check size={16} aria-hidden="true" />
            <p>すべての指摘を確認しました。</p>
          </div>
        ) : (
          <div className="lens-findings">
            {visible.map(({ finding, index }) => (
              <FindingCard
                key={index}
                finding={finding}
                applied={applied.has(index)}
                applicable={finding.excerpt.length > 0 && docContent.includes(finding.excerpt)}
                onApply={() => handleApply(index, finding)}
                onJump={() => onJump(finding.excerpt)}
                onDismiss={() => setDismissed((prev) => new Set(prev).add(index))}
              />
            ))}
          </div>
        )}
        <p className="lens-meta">
          指摘 {findings.length} 件 · {MODEL_LABEL[model]}
        </p>
      </>
    );
  } else if (!apiKeySet) {
    body = (
      <div className="lens-intro">
        <span className="lens-intro-mark">
          <KeyRound size={20} aria-hidden="true" />
        </span>
        <p className="lens-intro-title">Gemini API キーが必要です</p>
        <p className="lens-intro-text">設定の「AI レビュー」で Google AI Studio のキーを登録すると使えます。</p>
        <button type="button" className="lens-run" onClick={onOpenSettings}>
          設定を開く
        </button>
      </div>
    );
  } else {
    body = (
      <div className="lens-intro">
        <span className="lens-intro-mark">
          <Telescope size={20} aria-hidden="true" />
        </span>
        <p className="lens-intro-title">仕様書を診る</p>
        <p className="lens-intro-text">
          過剰な具体・根拠のない断定・未決定の問いを検出します。Lens は仕様を書き足しません。
        </p>
        <button type="button" className="lens-run" onClick={onRun}>
          <Telescope size={14} aria-hidden="true" />
          レビューを実行
        </button>
        <span className="lens-model-chip">{MODEL_LABEL[model]}</span>
      </div>
    );
  }

  return (
    <aside className="lens-panel" aria-label="Lens レビュー">
      <div className="lens-head">
        <span className="sidebar-heading">Lens</span>
        <div className="lens-head-actions">
          {state.status === "done" ? (
            <button
              type="button"
              className="lens-head-button"
              title="再レビュー"
              aria-label="再レビュー"
              onClick={onRun}
            >
              <RefreshCw size={13} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="lens-head-button"
            title="閉じる"
            aria-label="Lens を閉じる"
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
