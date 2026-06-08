import { FolderInput } from "lucide-react";

export function DropOverlay({ active }: { active: boolean }): React.ReactElement | null {
  if (!active) return null;
  return (
    <div className="drop-overlay" aria-hidden="true">
      <div className="drop-overlay-card">
        <FolderInput size={52} strokeWidth={1.5} aria-hidden="true" />
        <p className="drop-overlay-title">フォルダをドロップして取り込み</p>
        <p className="drop-overlay-hint">フォルダ内の Markdown（.md / .markdown）を仕様書として追加します</p>
      </div>
    </div>
  );
}
