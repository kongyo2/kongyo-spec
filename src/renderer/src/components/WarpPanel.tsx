import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  DraftingCompass,
  KeyRound,
  LightbulbIcon,
  ListChecks,
  LoaderCircle,
  RefreshCw,
  Replace,
  TextSelect,
  TriangleAlert,
  Undo2,
  Workflow,
  X,
} from "lucide-react";
import type { MermaidDiagramKind, WarpForm } from "@shared/schemas/assist";
import { MAX_WARP_MATERIAL_CHARS, MAX_WARP_OUTPUT_CHARS, MERMAID_DIAGRAM_KINDS } from "@shared/schemas/assist";
import type { MermaidRenderer } from "@shared/schemas/settings";
import { errorMessage } from "../lib/errors";
import { renderMermaidSvg } from "../lib/mermaid";
import type { ResolvedTheme } from "../lib/theme";

export type WarpPhase = "compose" | "running" | "done" | "error";

export interface WarpSession {
  phase: WarpPhase;
  form: WarpForm;
  diagram: MermaidDiagramKind;
  material: string;
  output: string;
  notes: string[];
  replaceTargets: string[];
  servedBy: string | null;
  error: string | null;
}

export const INITIAL_WARP_SESSION: WarpSession = {
  phase: "compose",
  form: "ears",
  diagram: "auto",
  material: "",
  output: "",
  notes: [],
  replaceTargets: [],
  servedBy: null,
  error: null,
};

interface WarpPanelProps {
  session: WarpSession;
  modelLabel: string;
  apiKeySet: boolean;
  theme: ResolvedTheme;
  mermaidRenderer: MermaidRenderer;
  onUpdate: (patch: Partial<WarpSession>) => void;
  onRun: () => void;
  onInsert: () => void;
  onPullSelection: () => void;
  onClose: () => void;
  onOpenSettings: () => void;
}

const FORM_META: Record<WarpForm, { label: string; run: string; outputLabel: string }> = {
  ears: { label: "ユーザーストーリー + EARS", run: "EARS に張る", outputLabel: "張り上がり(要件)" },
  mermaid: { label: "Mermaid 図", run: "図を起こす", outputLabel: "Mermaid コード" },
};

const DIAGRAM_LABELS: Record<MermaidDiagramKind, string> = {
  auto: "自動",
  flowchart: "フロー",
  sequenceDiagram: "シーケンス",
  "stateDiagram-v2": "状態",
  erDiagram: "ER",
  classDiagram: "クラス",
  gantt: "ガント",
};

const EARS_PLACEHOLDER = [
  "要件のメモ・散文・箇条書きを、そのまま。",
  "",
  "例:",
  "ログインに 5 回失敗したらアカウントを 15 分ロックしたい。",
  "ロック中はその旨を表示して、解除されたらメールで知らせる。",
].join("\n");

const MERMAID_PLACEHOLDER = [
  "流れ・状態・構造の記述を、そのまま。既存の Mermaid コードを貼れば修正します。",
  "",
  "例:",
  "ユーザーが注文を確定すると在庫を引き当てる。",
  "在庫が足りなければ入荷待ちにして通知する。",
].join("\n");

type MermaidPreviewState =
  | { status: "empty" }
  | { status: "rendering" }
  | { status: "done"; svg: string }
  | { status: "error"; message: string };

function MermaidLivePreview({
  code,
  theme,
  renderer,
}: {
  code: string;
  theme: ResolvedTheme;
  renderer: MermaidRenderer;
}): React.ReactElement {
  const [preview, setPreview] = useState<MermaidPreviewState>({ status: "empty" });

  useEffect(() => {
    const source = code.trim();
    if (source.length === 0) {
      setPreview({ status: "empty" });
      return;
    }
    let cancelled = false;
    setPreview((prev) => (prev.status === "done" ? prev : { status: "rendering" }));
    const handle = window.setTimeout(() => {
      renderMermaidSvg(source, theme, renderer).then(
        (svg) => {
          if (!cancelled) setPreview({ status: "done", svg });
        },
        (err: unknown) => {
          if (!cancelled) setPreview({ status: "error", message: errorMessage(err) });
        },
      );
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [code, theme, renderer]);

  if (preview.status === "empty") return <div className="warp-preview warp-preview-empty">コードがありません</div>;
  if (preview.status === "error") {
    return (
      <div className="warp-preview warp-preview-error" role="alert">
        <TriangleAlert size={13} aria-hidden="true" />
        <span>{preview.message}</span>
      </div>
    );
  }
  if (preview.status === "rendering") {
    return (
      <div className="warp-preview warp-preview-empty">
        <LoaderCircle className="lens-spin" size={16} aria-hidden="true" />
      </div>
    );
  }
  return <div className="warp-preview" aria-label="図のプレビュー" dangerouslySetInnerHTML={{ __html: preview.svg }} />;
}

export function WarpPanel({
  session,
  modelLabel,
  apiKeySet,
  theme,
  mermaidRenderer,
  onUpdate,
  onRun,
  onInsert,
  onPullSelection,
  onClose,
  onOpenSettings,
}: WarpPanelProps): React.ReactElement {
  const meta = FORM_META[session.form];

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
        <p className="lens-intro-title">{session.form === "ears" ? "経糸を張っています…" : "図を起こしています…"}</p>
        <p className="lens-intro-text">
          {session.form === "ears"
            ? "素材を検証可能な受け入れ基準に張り直しています。"
            : "素材の流れを読み取り、Mermaid に写し取っています。"}
        </p>
        <span className="lens-model-chip">{modelLabel}</span>
      </div>
    );
  } else if (session.phase === "error") {
    body = (
      <div className="lens-intro">
        <p className="lens-intro-title">張れませんでした</p>
        <p className="lens-error-text">{session.error}</p>
        <button type="button" className="lens-run" onClick={onRun}>
          <RefreshCw size={14} aria-hidden="true" />
          再試行
        </button>
      </div>
    );
  } else if (session.phase === "done") {
    body = (
      <>
        {session.form === "mermaid" ? (
          <section className="loom-block">
            <header className="loom-block-head">
              <span className="loom-block-label">プレビュー</span>
            </header>
            <MermaidLivePreview code={session.output} theme={theme} renderer={mermaidRenderer} />
          </section>
        ) : null}
        <section className="loom-block">
          <header className="loom-block-head">
            <span className="loom-block-label">{meta.outputLabel}</span>
            {session.output.length > 0 ? <span className="loom-block-count">{session.output.length} 字</span> : null}
          </header>
          <textarea
            className="loom-woven warp-output"
            value={session.output}
            maxLength={MAX_WARP_OUTPUT_CHARS}
            spellCheck={false}
            aria-label={`${meta.outputLabel}(挿入前に編集できます)`}
            onChange={(event) => onUpdate({ output: event.target.value })}
          />
          <div className="loom-actions">
            <button type="button" className="lens-run" disabled={session.output.trim().length === 0} onClick={onInsert}>
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
              onClick={() => onUpdate({ phase: "compose", output: "", notes: [], error: null })}
            >
              <Undo2 size={13} aria-hidden="true" />
              素材に戻る
            </button>
          </div>
        </section>
        {session.notes.length > 0 ? (
          <section className="loom-block">
            <header className="loom-block-head">
              <span className="loom-block-label">確認すべき点</span>
              <span className="loom-block-count">{session.notes.length} 件</span>
            </header>
            <ul className="warp-notes">
              {session.notes.map((note, index) => (
                <li key={index}>
                  <LightbulbIcon size={13} aria-hidden="true" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <p className="lens-meta">{session.servedBy ?? modelLabel}</p>
      </>
    );
  } else {
    body = (
      <div className="loom-compose">
        <p className="loom-lede">
          Warp は素材を定型に張り直します。素材に無いことは書かず、欠けは【未決定】として残します。
        </p>
        <div className="warp-form-switch" role="group" aria-label="出力形式">
          {(Object.keys(FORM_META) as WarpForm[]).map((form) => (
            <button
              type="button"
              key={form}
              className={session.form === form ? "active" : ""}
              aria-pressed={session.form === form}
              onClick={() => onUpdate({ form })}
            >
              {form === "ears" ? (
                <ListChecks size={13} aria-hidden="true" />
              ) : (
                <Workflow size={13} aria-hidden="true" />
              )}
              {FORM_META[form].label}
            </button>
          ))}
        </div>
        {session.form === "mermaid" ? (
          <div className="warp-diagram-row" role="group" aria-label="図の種類">
            {MERMAID_DIAGRAM_KINDS.map((kind) => (
              <button
                type="button"
                key={kind}
                className={`loom-option${session.diagram === kind ? " selected" : ""}`}
                onClick={() => onUpdate({ diagram: kind })}
              >
                {DIAGRAM_LABELS[kind]}
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          className="loom-material"
          value={session.material}
          maxLength={MAX_WARP_MATERIAL_CHARS}
          placeholder={session.form === "ears" ? EARS_PLACEHOLDER : MERMAID_PLACEHOLDER}
          spellCheck={false}
          aria-label="素材(要件メモや流れの記述)"
          onChange={(event) => onUpdate({ material: event.target.value })}
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
        <button
          type="button"
          className="lens-run loom-weave"
          disabled={session.material.trim().length === 0}
          onClick={onRun}
        >
          <DraftingCompass size={14} aria-hidden="true" />
          {meta.run}
        </button>
        <p className="loom-hint">
          {session.form === "ears"
            ? "散文の要求が WHEN / THEN / SHALL の検証可能な基準になります。"
            : "既存の Mermaid ブロックを取り込めば、構文の修正と整理を行います。"}
        </p>
        <span className="lens-model-chip">{modelLabel}</span>
      </div>
    );
  }

  return (
    <aside className="lens-panel loom-panel" aria-label="Warp 定型への張り直し">
      <div className="lens-head">
        <span className="sidebar-heading">Warp</span>
        <div className="lens-head-actions">
          <button
            type="button"
            className="lens-head-button"
            title="閉じる"
            aria-label="Warp を閉じる"
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
