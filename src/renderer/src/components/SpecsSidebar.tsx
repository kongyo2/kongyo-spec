import type { SpecMeta } from "@shared/schemas/spec";

interface SpecsSidebarProps {
  specs: SpecMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
}

function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SpecsSidebar({
  specs,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: SpecsSidebarProps): React.ReactElement {
  return (
    <div className="specs-sidebar">
      <div className="specs-header">
        <span className="sidebar-heading">仕様書一覧</span>
        <button type="button" className="new-spec-button" onClick={onNew} aria-label="新規作成">
          + 新規作成
        </button>
      </div>
      {specs.length === 0 ? (
        <p className="specs-empty">仕様書がありません。「新規作成」から始めましょう。</p>
      ) : (
        <ul className="specs-list">
          {specs.map((spec) => (
            <li key={spec.id} className={`spec-item${spec.id === activeId ? " active" : ""}`}>
              <button type="button" className="spec-select" onClick={() => onSelect(spec.id)}>
                <span className="spec-title">{spec.title || "Untitled"}</span>
                <span className="spec-stamp">{formatStamp(spec.updatedAt)}</span>
              </button>
              <span className="spec-actions">
                <button
                  type="button"
                  className="spec-action"
                  title="名前を変更"
                  aria-label="名前を変更"
                  onClick={() => onRename(spec.id)}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="spec-action"
                  title="削除"
                  aria-label="削除"
                  onClick={() => onDelete(spec.id)}
                >
                  🗑
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
