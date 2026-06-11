import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Check, Copy, History, LoaderCircle, Pin, RefreshCw, Trash2, Undo2, X } from "lucide-react";
import {
  MAX_SNAPSHOT_LABEL_CHARS,
  type SnapshotDocument,
  type SnapshotKind,
  type SnapshotMeta,
} from "@shared/schemas/history";
import { diffLines, diffStats, foldContext, type DiffRow } from "../lib/diff";
import { ipcErrorMessage } from "../lib/errors";

export interface SelvageState {
  snapshots: SnapshotMeta[] | null;
  error: string | null;
}

interface SelvagePanelProps {
  state: SelvageState;
  docContent: string;
  busy: boolean;
  onTake: (label: string | null) => void;
  onLoad: (snapshotId: string) => Promise<SnapshotDocument>;
  onRestore: (snapshotId: string) => void;
  onCopy: (snapshotId: string) => void;
  onDelete: (snapshotId: string) => void;
  onReload: () => void;
  onClose: () => void;
}

const KIND_LABEL: Record<SnapshotKind, string> = {
  auto: "自動",
  manual: "手動",
  guard: "復元前",
};

// 巨大な差分でパネルが固まらないよう、描画する行数は抑える
const MAX_RENDER_ROWS = 400;

function relativeTime(iso: string): string {
  const elapsed = Date.now() - Date.parse(iso);
  if (!Number.isFinite(elapsed) || elapsed < 0) return "たった今";
  if (elapsed < 60_000) return "たった今";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes} 分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 時間前`;
  const days = Math.floor(hours / 24);
  if (days < 31) return `${days} 日前`;
  const date = new Date(iso);
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

function absoluteTime(iso: string): string {
  const stamp = Date.parse(iso);
  return Number.isFinite(stamp) ? new Date(stamp).toLocaleString() : iso;
}

function DiffView({ rows, truncated }: { rows: DiffRow[]; truncated: number }): React.ReactElement {
  return (
    <div className="selvage-diff" role="region" aria-label="この版と現在の差分">
      {rows.map((row, index) =>
        row.kind === "skip" ? (
          <div key={index} className="selvage-diff-skip">
            ⋯ {row.count} 行 変化なし ⋯
          </div>
        ) : (
          <div key={index} className={`selvage-diff-row ${row.kind}`}>
            <span className="selvage-diff-sign" aria-hidden="true">
              {row.kind === "add" ? "+" : row.kind === "del" ? "−" : " "}
            </span>
            <span className="selvage-diff-text">{row.text.length > 0 ? row.text : " "}</span>
          </div>
        ),
      )}
      {truncated > 0 ? <div className="selvage-diff-skip">⋯ 残り {truncated} 行は省略 ⋯</div> : null}
    </div>
  );
}

export function SelvagePanel({
  state,
  docContent,
  busy,
  onTake,
  onLoad,
  onRestore,
  onCopy,
  onDelete,
  onReload,
  onClose,
}: SelvagePanelProps): React.ReactElement {
  const [labelDraft, setLabelDraft] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ id: string; content: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"restore" | "delete" | null>(null);
  const [, setClockTick] = useState(0);

  // 相対時刻(「3 分前」)が開きっぱなしでも古びないよう毎分描き直す
  useEffect(() => {
    const handle = window.setInterval(() => setClockTick((tick) => tick + 1), 60_000);
    return () => window.clearInterval(handle);
  }, []);

  useEffect(() => {
    if (selectedId === null) {
      setLoaded(null);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoadError(null);
    onLoad(selectedId).then(
      (snapshot) => {
        if (!cancelled) setLoaded({ id: selectedId, content: snapshot.content });
      },
      (err: unknown) => {
        if (cancelled) return;
        setLoaded(null);
        setLoadError(ipcErrorMessage(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [selectedId, onLoad]);

  // 再取得や削除で選択中の版が消えたら選択を畳む
  useEffect(() => {
    if (selectedId === null || state.snapshots === null) return;
    if (!state.snapshots.some((snapshot) => snapshot.id === selectedId)) {
      setSelectedId(null);
      setConfirmAction(null);
    }
  }, [state.snapshots, selectedId]);

  const deferredContent = useDeferredValue(docContent);
  const diff = useMemo(() => {
    if (!loaded) return null;
    // old=現在 / new=その版: 緑は戻すと復活する行、赤は戻すと消える行
    const ops = diffLines(deferredContent, loaded.content);
    const rows = foldContext(ops);
    return {
      id: loaded.id,
      rows: rows.slice(0, MAX_RENDER_ROWS),
      truncated: Math.max(0, rows.length - MAX_RENDER_ROWS),
      stats: diffStats(ops),
      identical: ops.every((op) => op.kind === "same"),
    };
  }, [loaded, deferredContent]);

  const submitLabel = (): void => {
    const trimmed = labelDraft.trim();
    onTake(trimmed.length > 0 ? trimmed.slice(0, MAX_SNAPSHOT_LABEL_CHARS) : null);
    setLabelDraft("");
  };

  const selectSnapshot = (id: string): void => {
    setSelectedId((prev) => (prev === id ? null : id));
    setConfirmAction(null);
  };

  let listBody: React.ReactElement;
  if (state.snapshots === null) {
    listBody = (
      <div className="selvage-loading">
        <LoaderCircle className="lens-spin" size={16} aria-hidden="true" />
        <p>留めた版を読み込んでいます…</p>
      </div>
    );
  } else if (state.snapshots.length === 0) {
    listBody = (
      <div className="lens-clear">
        <History size={16} aria-hidden="true" />
        <p>まだ留めた版がありません。編集を進めると自動で留まり、いつでもここから巻き戻せます。</p>
      </div>
    );
  } else {
    listBody = (
      <div className="selvage-list">
        {state.snapshots.map((snapshot) => {
          const selected = selectedId === snapshot.id;
          const detailReady = selected && diff !== null && diff.id === snapshot.id;
          return (
            <div key={snapshot.id} className="selvage-entry">
              <button
                type="button"
                className={`selvage-card${selected ? " selected" : ""}`}
                aria-expanded={selected}
                onClick={() => selectSnapshot(snapshot.id)}
              >
                <span className="selvage-card-head">
                  <span className={`selvage-kind-chip kind-${snapshot.kind}`}>{KIND_LABEL[snapshot.kind]}</span>
                  <span className="selvage-card-time" title={absoluteTime(snapshot.takenAt)}>
                    {relativeTime(snapshot.takenAt)}
                  </span>
                  <span className="selvage-card-size">{snapshot.lines} 行</span>
                </span>
                {snapshot.label !== null ? <span className="selvage-card-label">{snapshot.label}</span> : null}
              </button>
              {selected ? (
                <div className="selvage-detail">
                  {loadError !== null ? (
                    <p className="lens-error-text">{loadError}</p>
                  ) : !detailReady ? (
                    <div className="selvage-loading">
                      <LoaderCircle className="lens-spin" size={14} aria-hidden="true" />
                      <p>差分を計算しています…</p>
                    </div>
                  ) : diff.identical ? (
                    <p className="selvage-identical">
                      <Check size={13} aria-hidden="true" />
                      現在の本文と同じ内容です
                    </p>
                  ) : (
                    <>
                      <p className="selvage-diff-summary">
                        この版に戻すと <span className="add">+{diff.stats.added}</span>{" "}
                        <span className="del">−{diff.stats.removed}</span> 行
                      </p>
                      <DiffView rows={diff.rows} truncated={diff.truncated} />
                    </>
                  )}
                  <div className="selvage-actions">
                    {confirmAction === "restore" ? (
                      <>
                        <button
                          type="button"
                          className="selvage-confirm"
                          disabled={busy}
                          onClick={() => {
                            setConfirmAction(null);
                            onRestore(snapshot.id);
                          }}
                        >
                          <Undo2 size={13} aria-hidden="true" />
                          本当に戻す
                        </button>
                        <button type="button" className="loom-ghost" onClick={() => setConfirmAction(null)}>
                          やめる
                        </button>
                      </>
                    ) : confirmAction === "delete" ? (
                      <>
                        <button
                          type="button"
                          className="selvage-confirm"
                          onClick={() => {
                            setConfirmAction(null);
                            onDelete(snapshot.id);
                          }}
                        >
                          <Trash2 size={13} aria-hidden="true" />
                          本当に削除
                        </button>
                        <button type="button" className="loom-ghost" onClick={() => setConfirmAction(null)}>
                          やめる
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="selvage-restore"
                          disabled={busy || !detailReady || loadError !== null || diff?.identical === true}
                          title="現在の状態も復元前に自動で留まります"
                          onClick={() => setConfirmAction("restore")}
                        >
                          <Undo2 size={13} aria-hidden="true" />
                          この版に戻す
                        </button>
                        <button
                          type="button"
                          className="loom-ghost"
                          title="この版の本文をクリップボードへ"
                          onClick={() => onCopy(snapshot.id)}
                        >
                          <Copy size={13} aria-hidden="true" />
                          コピー
                        </button>
                        <button
                          type="button"
                          className="loom-ghost selvage-danger"
                          title="この版を履歴から削除"
                          onClick={() => setConfirmAction("delete")}
                        >
                          <Trash2 size={13} aria-hidden="true" />
                          削除
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <aside className="lens-panel selvage-panel" aria-label="Selvage 版の履歴">
      <div className="lens-head">
        <span className="sidebar-heading">Selvage</span>
        <div className="lens-head-actions">
          <button
            type="button"
            className="lens-head-button"
            title="履歴を読み直す"
            aria-label="履歴を読み直す"
            onClick={onReload}
          >
            <RefreshCw size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="lens-head-button"
            title="閉じる"
            aria-label="Selvage を閉じる"
            onClick={onClose}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="lens-body">
        <section className="fray-section">
          <h3 className="fray-section-title">
            <Pin size={13} aria-hidden="true" />
            いまを留める
          </h3>
          <div className="selvage-take">
            <input
              type="text"
              className="selvage-label-input"
              placeholder="ラベル(任意) 例: レビュー前"
              value={labelDraft}
              maxLength={MAX_SNAPSHOT_LABEL_CHARS}
              onChange={(event) => setLabelDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) submitLabel();
              }}
            />
            <button type="button" className="selvage-take-button" disabled={busy} onClick={submitLabel}>
              <Pin size={13} aria-hidden="true" />
              留める
            </button>
          </div>
          <p className="selvage-hint">編集を進めると約 5 分おきに自動で留まります。復元の直前も自動で残ります。</p>
        </section>
        <section className="fray-section">
          <h3 className="fray-section-title">
            <History size={13} aria-hidden="true" />
            留めた版
            {state.snapshots !== null ? <span className="fray-section-count">{state.snapshots.length}</span> : null}
          </h3>
          {state.error !== null ? <p className="lens-error-text">{state.error}</p> : null}
          {listBody}
        </section>
      </div>
    </aside>
  );
}
