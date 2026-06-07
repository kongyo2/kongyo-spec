import { useEffect, useRef, useState } from "react";

export type DialogState =
  | { kind: "new" }
  | { kind: "rename"; id: string; current: string }
  | { kind: "delete"; id: string; title: string };

interface DialogProps {
  state: DialogState;
  onCancel: () => void;
  onSubmitTitle: (title: string) => void;
  onConfirmDelete: (id: string) => void;
}

export function Dialog({ state, onCancel, onSubmitTitle, onConfirmDelete }: DialogProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState<string>(state.kind === "rename" ? state.current : "");

  useEffect(() => {
    if (state.kind !== "delete") inputRef.current?.focus();
    inputRef.current?.select();
  }, [state]);

  const title = state.kind === "new" ? "新規仕様書を作成" : state.kind === "rename" ? "名前を変更" : "仕様書を削除";

  const submit = (): void => {
    if (state.kind === "delete") {
      onConfirmDelete(state.id);
      return;
    }
    const trimmed = value.trim();
    if (trimmed.length > 0) onSubmitTitle(trimmed);
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="modal-title">{title}</h2>
        {state.kind === "delete" ? (
          <p className="modal-body">「{state.title}」を削除します。この操作は元に戻せません。</p>
        ) : (
          <input
            ref={inputRef}
            className="modal-input"
            type="text"
            value={value}
            placeholder="タイトルを入力"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
              }
            }}
          />
        )}
        <div className="modal-actions">
          <button type="button" className="modal-cancel" onClick={onCancel}>
            キャンセル
          </button>
          <button
            type="button"
            className={state.kind === "delete" ? "modal-danger" : "modal-confirm"}
            onClick={submit}
            disabled={state.kind !== "delete" && value.trim().length === 0}
          >
            {state.kind === "delete" ? "削除" : "決定"}
          </button>
        </div>
      </div>
    </div>
  );
}
