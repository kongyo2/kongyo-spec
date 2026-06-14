import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Regex,
  Replace,
  ReplaceAll,
  WholeWord,
  X,
} from "lucide-react";
import type { RefObject } from "react";

interface SearchBarProps {
  query: string;
  replace: string;
  showReplace: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  regexInvalid: boolean;
  matchCount: number;
  currentIndex: number;
  inputRef: RefObject<HTMLInputElement | null>;
  onQuery: (value: string) => void;
  onReplaceChange: (value: string) => void;
  onToggleReplace: () => void;
  onToggleCase: () => void;
  onToggleWord: () => void;
  onToggleRegex: () => void;
  onNext: () => void;
  onPrev: () => void;
  onReplaceOne: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
}

export function SearchBar({
  query,
  replace,
  showReplace,
  caseSensitive,
  wholeWord,
  regex,
  regexInvalid,
  matchCount,
  currentIndex,
  inputRef,
  onQuery,
  onReplaceChange,
  onToggleReplace,
  onToggleCase,
  onToggleWord,
  onToggleRegex,
  onNext,
  onPrev,
  onReplaceOne,
  onReplaceAll,
  onClose,
}: SearchBarProps): React.ReactElement {
  const handleFindKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) onPrev();
      else onNext();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  const handleReplaceKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey || event.altKey) onReplaceAll();
      else onReplaceOne();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  const status = regexInvalid
    ? "無効な正規表現"
    : matchCount > 0
      ? `${currentIndex + 1} / ${matchCount}`
      : query.length > 0
        ? "0 件"
        : "";

  return (
    <div className="search-bar" role="search">
      <button
        type="button"
        className="search-expand"
        onClick={onToggleReplace}
        aria-expanded={showReplace}
        aria-label={showReplace ? "置換欄を閉じる" : "置換欄を開く"}
        title={showReplace ? "置換欄を閉じる" : "置換欄を開く"}
      >
        {showReplace ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
      </button>

      <div className="search-fields">
        <div className="search-row">
          <div className={`search-field${regexInvalid ? " invalid" : ""}`}>
            <input
              ref={inputRef}
              type="text"
              className="search-input"
              placeholder="検索…"
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              onKeyDown={handleFindKeyDown}
              aria-label="検索キーワード"
            />
            <div className="search-options">
              <button
                type="button"
                className={caseSensitive ? "active" : ""}
                onClick={onToggleCase}
                aria-pressed={caseSensitive}
                aria-label="大文字と小文字を区別"
                title="大文字と小文字を区別"
              >
                <CaseSensitive size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={wholeWord ? "active" : ""}
                onClick={onToggleWord}
                aria-pressed={wholeWord}
                aria-label="単語単位で一致"
                title="単語単位で一致"
              >
                <WholeWord size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={regex ? "active" : ""}
                onClick={onToggleRegex}
                aria-pressed={regex}
                aria-label="正規表現"
                title="正規表現"
              >
                <Regex size={15} aria-hidden="true" />
              </button>
            </div>
          </div>
          <span className="search-status">{status}</span>
          <button
            type="button"
            onClick={onPrev}
            disabled={matchCount === 0}
            aria-label="前のマッチ"
            title="前へ (Shift+Enter)"
          >
            <ChevronUp size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={matchCount === 0}
            aria-label="次のマッチ"
            title="次へ (Enter)"
          >
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        </div>

        {showReplace ? (
          <div className="search-row">
            <div className="search-field">
              <input
                type="text"
                className="search-input"
                placeholder="置換後…"
                value={replace}
                onChange={(event) => onReplaceChange(event.target.value)}
                onKeyDown={handleReplaceKeyDown}
                aria-label="置換後のテキスト"
              />
            </div>
            <button
              type="button"
              onClick={onReplaceOne}
              disabled={matchCount === 0}
              aria-label="このマッチを置換"
              title="置換 (Enter)"
            >
              <Replace size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onReplaceAll}
              disabled={matchCount === 0}
              aria-label="すべて置換"
              title="すべて置換 (Ctrl/Cmd+Enter)"
            >
              <ReplaceAll size={14} aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>

      <button type="button" className="search-close" onClick={onClose} aria-label="検索を閉じる" title="閉じる (Esc)">
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
