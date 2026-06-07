import type { RefObject } from "react";

interface SearchBarProps {
  query: string;
  matchCount: number;
  currentIndex: number;
  inputRef: RefObject<HTMLInputElement | null>;
  onQuery: (value: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

export function SearchBar({
  query,
  matchCount,
  currentIndex,
  inputRef,
  onQuery,
  onNext,
  onPrev,
  onClose,
}: SearchBarProps): React.ReactElement {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) onPrev();
      else onNext();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  const status = matchCount > 0 ? `${currentIndex + 1} / ${matchCount}` : query.length > 0 ? "0 件" : "";

  return (
    <div className="search-bar" role="search">
      <input
        ref={inputRef}
        type="text"
        className="search-input"
        placeholder="表示テキストを検索…"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="検索キーワード"
      />
      <span className="search-status">{status}</span>
      <button type="button" onClick={onPrev} disabled={matchCount === 0} aria-label="前のマッチ">
        ↑
      </button>
      <button type="button" onClick={onNext} disabled={matchCount === 0} aria-label="次のマッチ">
        ↓
      </button>
      <button type="button" onClick={onClose} aria-label="検索を閉じる">
        ✕
      </button>
    </div>
  );
}
