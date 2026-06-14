import { useEffect, useRef, useState } from "react";
import type { Highlighter } from "shiki";
import { applyFormat, type FormatAction } from "../lib/format";
import { findMatches } from "../lib/findReplace";
import { findPendingDecisions } from "../lib/pending";
import { getShikiHighlighter, SHIKI_THEMES } from "../lib/shiki";
import type { ResolvedTheme } from "../lib/theme";
import { buildToc } from "../lib/toc";
import { useAutocomplete } from "../lib/useAutocomplete";
import { EditorToolbar } from "./EditorToolbar";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function plainCodeHtml(value: string): string {
  return `<pre class="shiki"><code>${escapeHtml(value)}</code></pre>`;
}

interface RangeMark {
  start: number;
  end: number;
  className: string;
}

function decorateRanges(html: string, marks: RangeMark[]): string {
  if (marks.length === 0) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number }[] = [];
  let offset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    nodes.push({ node, start: offset });
    offset += node.data.length;
  }
  for (const { node, start } of nodes) {
    const end = start + node.data.length;
    const overlapping = marks.filter((mark) => mark.start < end && mark.end > start);
    if (overlapping.length === 0) continue;
    const points = new Set<number>([0, node.data.length]);
    for (const mark of overlapping) {
      points.add(Math.max(0, mark.start - start));
      points.add(Math.min(node.data.length, mark.end - start));
    }
    const sorted = [...points].sort((a, b) => a - b);
    const fragment = doc.createDocumentFragment();
    for (let i = 0; i < sorted.length - 1; i++) {
      const from = sorted[i]!;
      const to = sorted[i + 1]!;
      if (to <= from) continue;
      const slice = node.data.slice(from, to);
      const classes = overlapping
        .filter((mark) => mark.start - start <= from && mark.end - start >= to)
        .flatMap((mark) => mark.className.split(" "));
      if (classes.length === 0) {
        fragment.appendChild(doc.createTextNode(slice));
      } else {
        const mark = doc.createElement("mark");
        mark.className = [...new Set(classes)].join(" ");
        mark.textContent = slice;
        fragment.appendChild(mark);
      }
    }
    node.parentNode?.replaceChild(fragment, node);
  }
  return doc.body.innerHTML;
}

function setSelectionSoon(textarea: HTMLTextAreaElement, start: number, end: number): void {
  requestAnimationFrame(() => {
    textarea.selectionStart = start;
    textarea.selectionEnd = end;
  });
}

export interface EditorSearchHighlight {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  activeIndex: number;
}

interface EditorProps {
  value: string;
  onChange: (next: string) => void;
  theme: ResolvedTheme;
  jump: { start: number; end: number } | null;
  onJumpHandled: () => void;
  onSelectionChange?: (start: number, end: number) => void;
  onScrollRatio?: (ratio: number) => void;
  readOnly?: boolean;
  searchHighlight?: EditorSearchHighlight | null;
  onNotice?: (message: string) => void;
  autocompleteEnabled?: boolean;
  autocompleteModelId?: string;
  autocompleteDocId?: string;
  onAutocompleteNotice?: (message: string) => void;
}

export function Editor({
  value,
  onChange,
  theme,
  jump,
  onJumpHandled,
  onSelectionChange,
  onScrollRatio,
  readOnly,
  searchHighlight,
  onNotice,
  autocompleteEnabled,
  autocompleteModelId,
  autocompleteDocId,
  onAutocompleteNotice,
}: EditorProps): React.ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const suppressSyncRef = useRef(false);
  const [highlighter, setHighlighter] = useState<Highlighter | null>(null);
  const [html, setHtml] = useState<string>(() => plainCodeHtml(value));

  const {
    ghost,
    handleInput,
    handleKeyDown: autocompleteKeyDown,
    handleBlur: dismissAutocomplete,
    handlePointerDown,
    handleCompositionStart,
    handleCompositionEnd,
  } = useAutocomplete({
    enabled: autocompleteEnabled === true && readOnly !== true,
    modelId: autocompleteModelId ?? "",
    docId: autocompleteDocId ?? "",
    readOnly: readOnly === true,
    value,
    onChange,
    textareaRef,
    onNotice: onAutocompleteNotice,
  });

  const searchQuery = searchHighlight?.query ?? "";
  const searchCase = searchHighlight?.caseSensitive ?? false;
  const searchWord = searchHighlight?.wholeWord ?? false;
  const searchRegex = searchHighlight?.regex ?? false;
  const searchActive = searchHighlight?.activeIndex ?? -1;

  useEffect(() => {
    let active = true;
    void getShikiHighlighter().then((instance) => {
      if (active) setHighlighter(instance);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) onSelectionChange?.(textarea.selectionStart, textarea.selectionEnd);
  }, [onSelectionChange]);

  useEffect(() => {
    const source = value.replace(/\r\n?/g, "\n");
    const marks: RangeMark[] = findPendingDecisions(source).map((range) => ({
      start: range.start,
      end: range.end,
      className: "pending-decision",
    }));
    if (searchQuery.length > 0) {
      const ranges = findMatches(source, searchQuery, {
        caseSensitive: searchCase,
        wholeWord: searchWord,
        regex: searchRegex,
      });
      ranges.forEach((range, index) => {
        marks.push({
          start: range.start,
          end: range.end,
          className: index === searchActive ? "editor-search-hit editor-search-hit-current" : "editor-search-hit",
        });
      });
    }
    let raw: string;
    if (!highlighter) {
      raw = plainCodeHtml(source);
    } else {
      try {
        raw = highlighter.codeToHtml(source.length > 0 ? source : " ", { lang: "markdown", themes: SHIKI_THEMES });
      } catch {
        raw = plainCodeHtml(source);
      }
    }
    setHtml(decorateRanges(raw, marks));
  }, [highlighter, value, searchQuery, searchCase, searchWord, searchRegex, searchActive]);

  const syncScroll = (): void => {
    const textarea = textareaRef.current;
    const backdrop = backdropRef.current;
    if (!textarea || !backdrop) return;
    backdrop.scrollTop = textarea.scrollTop;
    backdrop.scrollLeft = textarea.scrollLeft;
    const ghostLayer = ghostRef.current;
    if (ghostLayer) {
      ghostLayer.scrollTop = textarea.scrollTop;
      ghostLayer.scrollLeft = textarea.scrollLeft;
    }
    if (suppressSyncRef.current) {
      suppressSyncRef.current = false;
      return;
    }
    if (onScrollRatio) {
      const range = textarea.scrollHeight - textarea.clientHeight;
      onScrollRatio(range > 0 ? textarea.scrollTop / range : 0);
    }
  };

  useEffect(() => {
    if (!jump) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    dismissAutocomplete();
    const end = Math.min(jump.end, textarea.value.length);
    const start = Math.min(jump.start, end);
    const full = textarea.value;
    const priorHeight = textarea.style.height;
    textarea.style.height = "0";
    textarea.value = full.slice(0, start);
    const offsetBottom = textarea.scrollHeight;
    textarea.style.height = priorHeight;
    textarea.value = full;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(start, end);
    onSelectionChange?.(start, end);
    const targetTop = Math.max(0, offsetBottom - textarea.clientHeight / 2);
    if (textarea.scrollTop !== targetTop) suppressSyncRef.current = true;
    textarea.scrollTop = targetTop;
    const backdrop = backdropRef.current;
    if (backdrop) {
      backdrop.scrollTop = textarea.scrollTop;
      backdrop.scrollLeft = textarea.scrollLeft;
    }
    onJumpHandled();
  }, [jump, onJumpHandled, dismissAutocomplete]);

  useEffect(() => {
    if (searchActive < 0) return;
    const textarea = textareaRef.current;
    const backdrop = backdropRef.current;
    if (!textarea || !backdrop) return;
    const current = backdrop.querySelector<HTMLElement>(".editor-search-hit-current");
    if (!current) return;
    const top = current.offsetTop;
    const bottom = top + current.offsetHeight;
    const viewTop = textarea.scrollTop;
    const viewBottom = viewTop + textarea.clientHeight;
    if (top >= viewTop && bottom <= viewBottom) return;
    const max = textarea.scrollHeight - textarea.clientHeight;
    const next = Math.max(0, Math.min(top - textarea.clientHeight / 2, max));
    textarea.scrollTop = next;
    backdrop.scrollTop = next;
  }, [html, searchActive]);

  useEffect(() => {
    const textarea = textareaRef.current;
    const ghostLayer = ghostRef.current;
    if (ghost && textarea && ghostLayer) {
      ghostLayer.scrollTop = textarea.scrollTop;
      ghostLayer.scrollLeft = textarea.scrollLeft;
    }
  }, [ghost]);

  const applyFormatAction = (action: FormatAction): void => {
    const textarea = textareaRef.current;
    if (!textarea || readOnly === true) return;
    const context = action === "toc" ? { toc: buildToc(value) } : undefined;
    const result = applyFormat(
      action,
      { value, selectionStart: textarea.selectionStart, selectionEnd: textarea.selectionEnd },
      context,
    );
    if (!result) {
      if (action === "toc") onNotice?.("見出しがないため目次を作成できません");
      return;
    }
    dismissAutocomplete();
    onChange(result.value);
    setSelectionSoon(textarea, result.selectionStart, result.selectionEnd);
    requestAnimationFrame(() => textarea.focus());
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (readOnly === true) return;
    if (autocompleteKeyDown(event)) return;

    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
      const key = event.key.toLowerCase();
      const action: FormatAction | null = key === "b" ? "bold" : key === "i" ? "italic" : key === "k" ? "link" : null;
      if (action) {
        event.preventDefault();
        applyFormatAction(action);
        return;
      }
    }

    if (event.key !== "Tab") return;
    event.preventDefault();
    const textarea = event.currentTarget;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    if (start === end && !event.shiftKey) {
      onChange(`${value.slice(0, start)}  ${value.slice(end)}`);
      setSelectionSoon(textarea, start + 2, start + 2);
      return;
    }

    if (start === end) {
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const newlineIndex = value.indexOf("\n", start);
      const lineEnd = newlineIndex === -1 ? value.length : newlineIndex;
      const line = value.slice(lineStart, lineEnd);
      const dedented = line.replace(/^ {1,2}/, "");
      const removed = line.length - dedented.length;
      onChange(value.slice(0, lineStart) + dedented + value.slice(lineEnd));
      const cursor = Math.max(lineStart, start - removed);
      setSelectionSoon(textarea, cursor, cursor);
      return;
    }

    const blockStart = value.lastIndexOf("\n", start - 1) + 1;
    const newlineIndex = value.indexOf("\n", end - 1);
    const blockEnd = newlineIndex === -1 ? value.length : newlineIndex;
    const block = value.slice(blockStart, blockEnd);
    const modified = event.shiftKey ? block.replace(/^ {1,2}/gm, "") : block.replace(/^/gm, "  ");
    onChange(value.slice(0, blockStart) + modified + value.slice(blockEnd));
    setSelectionSoon(textarea, blockStart, blockStart + modified.length);
  };

  return (
    <div className={`editor${ghost?.reflow ? " reflow" : ""}`} data-theme={theme}>
      {readOnly === true ? null : <EditorToolbar onAction={applyFormatAction} />}
      <div className="editor-surface">
        <div
          className="editor-backdrop"
          ref={backdropRef}
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {ghost ? (
          <div className={`editor-ghost${ghost.reflow ? " reflow" : ""}`} ref={ghostRef} aria-hidden="true">
            {value.slice(0, ghost.anchor)}
            <span className="editor-ghost-text">{ghost.text}</span>
            {ghost.reflow ? <span className="editor-ghost-suffix">{value.slice(ghost.anchor)}</span> : null}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          className="editor-input"
          value={value}
          spellCheck={false}
          readOnly={readOnly === true}
          onChange={(event) => {
            onChange(event.target.value);
            handleInput();
          }}
          onScroll={syncScroll}
          onKeyDown={handleKeyDown}
          onSelect={(event) =>
            onSelectionChange?.(event.currentTarget.selectionStart, event.currentTarget.selectionEnd)
          }
          onBlur={dismissAutocomplete}
          onMouseDown={handlePointerDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          aria-label="Markdown ソースエディタ"
        />
      </div>
    </div>
  );
}
