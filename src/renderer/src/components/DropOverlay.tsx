import { FileDown } from "lucide-react";

export function DropOverlay(): React.ReactElement {
  return (
    <div className="drop-overlay" aria-hidden="true">
      <div className="drop-card">
        <span className="drop-icon">
          <FileDown size={30} aria-hidden="true" />
        </span>
        <p className="drop-title">Markdown をドロップ</p>
        <p className="drop-sub">
          <code>.md</code> ファイルを新しい仕様書として読み込みます
        </p>
      </div>
    </div>
  );
}
