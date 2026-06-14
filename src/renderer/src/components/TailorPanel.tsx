import { useMemo } from "react";
import {
  ArrowDownToLine,
  Check,
  CircleStop,
  Copy,
  History,
  KeyRound,
  ListTodo,
  LoaderCircle,
  RefreshCw,
  Scissors,
  Send,
  TriangleAlert,
  X,
} from "lucide-react";
import type { TailorPlan, TailorTask } from "@shared/schemas/assist";
import { computeTaskLanes, type TaskLanes } from "../lib/tailor";

export type TailorState =
  | { status: "idle" }
  | { status: "running"; model: string }
  | { status: "done"; plan: TailorPlan; model: string; tailoredContent: string }
  | { status: "error"; message: string };

interface TailorPanelProps {
  state: TailorState;
  modelLabel: string;
  apiKeySet: boolean;
  docContent: string;
  pendingCount: number;
  planInDoc: boolean;
  onRun: () => void;
  onCancel: () => void;
  onClose: () => void;
  onInsert: () => void;
  onCopyPlan: () => void;
  onCopyHandoff: () => void;
  onJumpExcerpt: (excerpt: string) => void;
  onOpenSettings: () => void;
}

function TaskCard({
  task,
  index,
  lane,
  parallel,
  onJumpExcerpt,
}: {
  task: TailorTask;
  index: number;
  lane: number;
  parallel: boolean;
  onJumpExcerpt: (excerpt: string) => void;
}): React.ReactElement {
  return (
    <article className={`tailor-task${parallel ? " parallel" : ""}`}>
      <header className="tailor-task-head">
        <span className="tailor-task-num" aria-hidden="true">
          {index + 1}
        </span>
        <span className="tailor-task-title">{task.title}</span>
        {lane === -1 ? (
          <span className="tailor-lane cyclic" title="依存が循環しているため着手順を決められません">
            循環
          </span>
        ) : (
          <span className="tailor-lane" title={`依存上、${lane + 1} 段目に着手できるタスク`}>
            段{lane + 1}
          </span>
        )}
        {parallel ? (
          <span className="tailor-parallel" title="同じ段のタスクと依存が重ならず、並行して着手できます">
            P
          </span>
        ) : null}
        <span className={`tailor-size size-${task.size.toLowerCase()}`} title="相対的な規模">
          {task.size}
        </span>
      </header>
      {task.summary.length > 0 ? <p className="tailor-task-summary">{task.summary}</p> : null}
      {task.acceptance.map((excerpt, i) => (
        <button
          type="button"
          key={i}
          className="lens-excerpt tailor-acceptance"
          title="仕様書の該当箇所を表示"
          onClick={() => onJumpExcerpt(excerpt)}
        >
          {excerpt}
        </button>
      ))}
      {task.verification.length > 0 ? (
        <p className="tailor-verify">
          <Check size={13} aria-hidden="true" />
          <span>{task.verification}</span>
        </p>
      ) : null}
      {task.dependsOn.length > 0 ? (
        <p className="tailor-deps">依存: {task.dependsOn.map((num) => `#${num}`).join(", ")}</p>
      ) : null}
    </article>
  );
}

export function TailorPanel({
  state,
  modelLabel,
  apiKeySet,
  docContent,
  pendingCount,
  planInDoc,
  onRun,
  onCancel,
  onClose,
  onInsert,
  onCopyPlan,
  onCopyHandoff,
  onJumpExcerpt,
  onOpenSettings,
}: TailorPanelProps): React.ReactElement {
  const schedule = useMemo<TaskLanes>(() => computeTaskLanes(state.status === "done" ? state.plan.tasks : []), [state]);

  const handoffBlock = (
    <section className="loom-block tailor-handoff">
      <header className="loom-block-head">
        <span className="loom-block-label">実装 AI へ引き渡す</span>
      </header>
      <p className="tailor-handoff-text">
        仕様書{state.status === "done" || planInDoc ? "と実装計画" : ""}
        を、未決定ガード付きの単一プロンプトに組み立てます。実装エージェントにそのまま貼り付けられます。
      </p>
      {pendingCount > 0 ? (
        <p className="tailor-pending-warn">
          <TriangleAlert size={13} aria-hidden="true" />
          <span>未決定が {pendingCount} 件残っています。プロンプトには「スタブに留める」指示が入ります。</span>
        </p>
      ) : null}
      <button type="button" className="loom-ghost tailor-handoff-copy" onClick={onCopyHandoff}>
        <Send size={13} aria-hidden="true" />
        実装プロンプトをコピー
      </button>
    </section>
  );

  let body: React.ReactElement;
  if (!apiKeySet) {
    body = (
      <>
        <div className="lens-intro tailor-intro">
          <span className="lens-intro-mark">
            <KeyRound size={20} aria-hidden="true" />
          </span>
          <p className="lens-intro-title">計画の裁断には API キーが必要です</p>
          <p className="lens-intro-text">設定の「AI アシスト」で Google AI Studio のキーを登録すると使えます。</p>
          <button type="button" className="lens-run" onClick={onOpenSettings}>
            設定を開く
          </button>
        </div>
        {handoffBlock}
      </>
    );
  } else if (state.status === "running") {
    body = (
      <div className="lens-intro">
        <LoaderCircle className="lens-spin" size={24} aria-hidden="true" />
        <p className="lens-intro-title">計画を裁っています…</p>
        <p className="lens-intro-text">受け入れ条件を検証可能なタスクに割り付けています。</p>
        <span className="lens-model-chip">{state.model}</span>
        <button type="button" className="loom-ghost assist-cancel" onClick={onCancel}>
          <CircleStop size={13} aria-hidden="true" />
          中止
        </button>
      </div>
    );
  } else if (state.status === "error") {
    body = (
      <div className="lens-intro">
        <p className="lens-intro-title">裁てませんでした</p>
        <p className="lens-error-text">{state.message}</p>
        <button type="button" className="lens-run" onClick={onRun}>
          <RefreshCw size={14} aria-hidden="true" />
          再試行
        </button>
      </div>
    );
  } else if (state.status === "done") {
    const { plan } = state;
    const stale = docContent !== state.tailoredContent;
    body = (
      <>
        {stale ? (
          <p className="lens-stale">
            <History size={13} aria-hidden="true" />
            <span>本文が裁断時点から変更されています。計画は当時の内容に基づきます。</span>
          </p>
        ) : null}
        {plan.approach.length > 0 ? <p className="lens-verdict">{plan.approach}</p> : null}
        {plan.blockers.length > 0 ? (
          <section className="tailor-blockers" aria-label="着手前に決めること">
            <h3 className="tailor-blockers-title">
              <TriangleAlert size={13} aria-hidden="true" />
              着手前に人間が決めること
              <span className="panel-section-count">{plan.blockers.length}</span>
            </h3>
            <ul>
              {plan.blockers.map((blocker, index) => (
                <li key={index}>{blocker}</li>
              ))}
            </ul>
          </section>
        ) : null}
        <section className="loom-block">
          <header className="loom-block-head">
            <span className="loom-block-label">タスク</span>
            <span className="loom-block-count">
              {plan.tasks.length} 件{schedule.laneCount > 1 ? ` · ${schedule.laneCount} 段` : ""}
            </span>
          </header>
          {schedule.cyclic.length > 0 ? (
            <p className="tailor-cycle-warn">
              <TriangleAlert size={13} aria-hidden="true" />
              <span>
                タスク {schedule.cyclic.map((num) => `#${num}`).join(", ")} の依存が循環しています。裁ち直すか、依存を
                見直してください。
              </span>
            </p>
          ) : null}
          <div className="tailor-tasks">
            {plan.tasks.map((task, index) => (
              <TaskCard
                key={index}
                task={task}
                index={index}
                lane={schedule.lanes[index] ?? -1}
                parallel={schedule.parallel[index] === true}
                onJumpExcerpt={onJumpExcerpt}
              />
            ))}
          </div>
        </section>
        {plan.notes.length > 0 ? (
          <section className="loom-block">
            <header className="loom-block-head">
              <span className="loom-block-label">補足</span>
            </header>
            <ul className="warp-notes">
              {plan.notes.map((note, index) => (
                <li key={index}>
                  <ListTodo size={13} aria-hidden="true" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <div className="loom-actions tailor-actions">
          <button type="button" className="lens-run" onClick={onInsert}>
            <ArrowDownToLine size={14} aria-hidden="true" />
            {planInDoc ? "本文の実装計画を更新" : "「実装計画」として挿入"}
          </button>
          <button type="button" className="loom-ghost" onClick={onCopyPlan}>
            <Copy size={13} aria-hidden="true" />
            計画をコピー
          </button>
        </div>
        {handoffBlock}
        <p className="lens-meta">
          タスク {plan.tasks.length} 件 · {state.model}
        </p>
      </>
    );
  } else {
    body = (
      <>
        <div className="lens-intro tailor-intro">
          <span className="lens-intro-mark">
            <Scissors size={20} aria-hidden="true" />
          </span>
          <p className="lens-intro-title">仕様を計画に裁つ</p>
          <p className="lens-intro-text">
            受け入れ条件を、検証可能な実装タスクの列に裁断します。Tailor は仕様に無い作業を計画に足しません。
          </p>
          <button type="button" className="lens-run" onClick={onRun}>
            <Scissors size={14} aria-hidden="true" />
            計画を裁つ
          </button>
          <span className="lens-model-chip">{modelLabel}</span>
        </div>
        {handoffBlock}
      </>
    );
  }

  return (
    <aside className="lens-panel tailor-panel" aria-label="Tailor 実装計画">
      <div className="lens-head">
        <span className="sidebar-heading">Tailor</span>
        <div className="lens-head-actions">
          {state.status === "done" ? (
            <button
              type="button"
              className="lens-head-button"
              title="計画を裁ち直す"
              aria-label="計画を裁ち直す"
              onClick={onRun}
            >
              <RefreshCw size={13} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="lens-head-button"
            title="閉じる"
            aria-label="Tailor を閉じる"
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
