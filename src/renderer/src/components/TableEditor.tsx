import { AlignCenter, AlignJustify, AlignLeft, AlignRight, type LucideIcon, Plus, Trash2 } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  type ColumnAlign,
  columnCount,
  cycleAlign,
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  serializeTable,
  setAlign,
  setCell,
  type TableModel,
} from "../lib/table";
import { renderCached } from "../lib/markdown";

export interface TableFocus {
  row: number;
  col: number;
}

interface TableEditorProps {
  model: TableModel;
  initialFocus: TableFocus | null;
  onApply: (model: TableModel) => void;
  onCancel: () => void;
}

const ALIGN_ICON: Record<ColumnAlign, LucideIcon> = {
  none: AlignJustify,
  left: AlignLeft,
  center: AlignCenter,
  right: AlignRight,
};

const ALIGN_LABEL: Record<ColumnAlign, string> = {
  none: "既定 (左)",
  left: "左揃え",
  center: "中央揃え",
  right: "右揃え",
};

const ALIGN_CSS: Record<ColumnAlign, "left" | "center" | "right"> = {
  none: "left",
  left: "left",
  center: "center",
  right: "right",
};

export function TableEditor({ model, initialFocus, onApply, onCancel }: TableEditorProps): React.ReactElement {
  const [data, setData] = useState<TableModel>(model);
  const gridRef = useRef<HTMLDivElement>(null);
  const pendingFocusRef = useRef<TableFocus | null>(initialFocus ?? { row: -1, col: 0 });
  const cols = useMemo(() => columnCount(data), [data]);

  const focusCell = (row: number, col: number): void => {
    const cell = gridRef.current?.querySelector<HTMLInputElement>(`input[data-r="${row}"][data-c="${col}"]`);
    if (cell) {
      cell.focus();
      cell.select();
    }
  };

  useLayoutEffect(() => {
    const target = pendingFocusRef.current;
    if (!target) return;
    pendingFocusRef.current = null;
    focusCell(target.row, target.col);
  });

  const queueFocus = (row: number, col: number): void => {
    pendingFocusRef.current = { row, col };
  };

  const lastRow = data.rows.length - 1;

  const moveVertical = (row: number, col: number, dir: 1 | -1): void => {
    const next = Math.max(-1, Math.min(lastRow, row + dir));
    focusCell(next, col);
  };

  const moveDown = (row: number, col: number): void => {
    if (row < lastRow) {
      focusCell(row + 1, col);
      return;
    }
    queueFocus(data.rows.length, col);
    setData((current) => insertRow(current, current.rows.length));
  };

  const moveNext = (row: number, col: number): void => {
    if (col < cols - 1) {
      focusCell(row, col + 1);
      return;
    }
    if (row < lastRow) {
      focusCell(row + 1, 0);
      return;
    }
    queueFocus(data.rows.length, 0);
    setData((current) => insertRow(current, current.rows.length));
  };

  const movePrev = (row: number, col: number): void => {
    if (col > 0) {
      focusCell(row, col - 1);
      return;
    }
    if (row > -1) {
      focusCell(row - 1, cols - 1);
    }
  };

  const handleCellKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, row: number, col: number): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) moveVertical(row, col, -1);
      else moveDown(row, col);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      if (event.shiftKey) movePrev(row, col);
      else moveNext(row, col);
      return;
    }
    if (event.key === "ArrowUp" && !event.altKey) {
      event.preventDefault();
      moveVertical(row, col, -1);
      return;
    }
    if (event.key === "ArrowDown" && !event.altKey) {
      event.preventDefault();
      moveVertical(row, col, 1);
    }
  };

  const editCell = (row: number, col: number, value: string): void => {
    setData((current) => setCell(current, row, col, value));
  };

  const renderCell = (row: number, col: number): React.ReactElement => {
    const value = row < 0 ? (data.header[col] ?? "") : (data.rows[row]?.[col] ?? "");
    return (
      <input
        key={`${row}:${col}`}
        className={`te-cell${row < 0 ? " te-cell-head" : ""}`}
        data-r={row}
        data-c={col}
        value={value}
        spellCheck={false}
        style={{ textAlign: ALIGN_CSS[data.aligns[col] ?? "none"] }}
        onChange={(event) => editCell(row, col, event.target.value)}
        onKeyDown={(event) => handleCellKeyDown(event, row, col)}
        aria-label={row < 0 ? `見出し 第${col + 1}列` : `第${row + 1}行 第${col + 1}列`}
      />
    );
  };

  const gridStyle = { gridTemplateColumns: `auto repeat(${cols}, minmax(132px, 1fr)) auto` } as React.CSSProperties;

  return (
    <div className="modal-overlay te-overlay" role="presentation">
      <div
        className="modal te-modal"
        role="dialog"
        aria-modal="true"
        aria-label="テーブルを編集"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      >
        <div className="te-header">
          <h2 className="modal-title">テーブルを編集</h2>
          <p className="te-hint">
            セルをクリックして直接入力。<kbd>Tab</kbd> / <kbd>Enter</kbd> で次のセルへ、行末では自動で行を追加します。
          </p>
        </div>

        <div className="te-scroll">
          <div className="te-grid" ref={gridRef} style={gridStyle}>
            <div className="te-corner" />
            {data.aligns.map((align, col) => {
              const Icon = ALIGN_ICON[align];
              return (
                <div className="te-colctrl" key={`colctrl-${col}`}>
                  <button
                    type="button"
                    className="te-align"
                    title={`列の揃え: ${ALIGN_LABEL[align]} (クリックで切替)`}
                    aria-label={`第${col + 1}列の揃え: ${ALIGN_LABEL[align]}`}
                    onClick={() => setData((current) => setAlign(current, col, cycleAlign(align)))}
                  >
                    <Icon size={13} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="te-mini te-insert"
                    title="左に列を挿入"
                    aria-label={`第${col + 1}列の左に列を挿入`}
                    onClick={() => {
                      queueFocus(-1, col);
                      setData((current) => insertColumn(current, col));
                    }}
                  >
                    <Plus size={12} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="te-mini te-remove"
                    title="この列を削除"
                    aria-label={`第${col + 1}列を削除`}
                    disabled={cols <= 1}
                    onClick={() => {
                      queueFocus(-1, Math.max(0, col - 1));
                      setData((current) => deleteColumn(current, col));
                    }}
                  >
                    <Trash2 size={12} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className="te-addcol"
              title="右端に列を追加"
              aria-label="列を追加"
              onClick={() => {
                queueFocus(-1, cols);
                setData((current) => insertColumn(current, columnCount(current)));
              }}
            >
              <Plus size={14} aria-hidden="true" />
            </button>

            <div className="te-rowctrl te-rowctrl-head" aria-hidden="true">
              見出し
            </div>
            {data.header.map((_, col) => renderCell(-1, col))}
            <div className="te-rowspacer" />

            {data.rows.map((row, rowIndex) => (
              <Fragment key={`row-${rowIndex}`}>
                <div className="te-rowctrl">
                  <button
                    type="button"
                    className="te-mini te-insert"
                    title="上に行を挿入"
                    aria-label={`第${rowIndex + 1}行の上に行を挿入`}
                    onClick={() => {
                      queueFocus(rowIndex, 0);
                      setData((current) => insertRow(current, rowIndex));
                    }}
                  >
                    <Plus size={12} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="te-mini te-remove"
                    title="この行を削除"
                    aria-label={`第${rowIndex + 1}行を削除`}
                    onClick={() => {
                      queueFocus(Math.min(rowIndex, data.rows.length - 2), 0);
                      setData((current) => deleteRow(current, rowIndex));
                    }}
                  >
                    <Trash2 size={12} aria-hidden="true" />
                  </button>
                </div>
                {row.map((_, col) => renderCell(rowIndex, col))}
                <div className="te-rowspacer" />
              </Fragment>
            ))}
          </div>

          <button
            type="button"
            className="te-addrow"
            onClick={() => {
              queueFocus(data.rows.length, 0);
              setData((current) => insertRow(current, current.rows.length));
            }}
          >
            <Plus size={14} aria-hidden="true" />
            行を追加
          </button>
        </div>

        <LivePreview model={data} />

        <div className="modal-actions">
          <button type="button" className="modal-cancel" onClick={onCancel}>
            キャンセル
          </button>
          <button type="button" className="modal-confirm" onClick={() => onApply(data)}>
            適用
          </button>
        </div>
      </div>
    </div>
  );
}

function LivePreview({ model }: { model: TableModel }): React.ReactElement {
  const [html, setHtml] = useState("");
  const markdown = useMemo(() => serializeTable(model), [model]);

  useEffect(() => {
    let active = true;
    const handle = window.setTimeout(() => {
      void renderCached(markdown, []).then((result) => {
        if (active) setHtml(result);
      });
    }, 120);
    return () => {
      active = false;
      window.clearTimeout(handle);
    };
  }, [markdown]);

  return (
    <div className="te-preview">
      <span className="te-preview-label">プレビュー</span>
      <div className="markdown-body te-preview-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
