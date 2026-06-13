import { useEffect, useRef, useState } from "react";
import type { Highlighter } from "shiki";
import { findPendingDecisions, type PendingRange } from "../lib/pending";
import { getShikiHighlighter, SHIKI_THEMES } from "../lib/shiki";
import type { ResolvedTheme } from "../lib/theme";
import { useAutocomplete } from "../lib/useAutocomplete";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function plainCodeHtml(value: string): string {
  return `<pre class="shiki"><code>${escapeHtml(value)}</code></pre>`;
}

function markPendingDecisions(html: string, ranges: PendingRange[]): string {
  if (ranges.length === 0) return html;
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
    const overlapping = ranges.filter((range) => range.start < end && range.end > start);
    if (overlapping.length === 0) continue;
    const fragment = doc.createDocumentFragment();
    let cursor = 0;
    for (const range of overlapping) {
      const localStart = Math.max(0, range.start - start);
      const localEnd = Math.min(node.data.length, range.end - start);
      if (localStart > cursor) fragment.appendChild(doc.createTextNode(node.data.slice(cursor, localStart)));
      const mark = doc.createElement("mark");
      mark.className = "pending-decision";
      mark.textContent = node.data.slice(localStart, localEnd);
      fragment.appendChild(mark);
      cursor = localEnd;
    }
    if (cursor < node.data.length) fragment.appendChild(doc.createTextNode(node.data.slice(cursor)));
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

interface EditorProps {
  value: string;
  onChange: (next: string) => void;
  theme: ResolvedTheme;
  jump: { start: number; end: number } | null;
  onJumpHandled: () => void;
  onSelectionChange?: (start: number, end: number) => void;
  onScrollRatio?: (ratio: number) => void;
  readOnly?: boolean;
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
    const pendingRanges = findPendingDecisions(source);
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
    setHtml(markPendingDecisions(raw, pendingRanges));
  }, [highlighter, value]);

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
    const textarea = textareaRef.current;
    const ghostLayer = ghostRef.current;
    if (ghost && textarea && ghostLayer) {
      ghostLayer.scrollTop = textarea.scrollTop;
      ghostLayer.scrollLeft = textarea.scrollLeft;
    }
  }, [ghost]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (readOnly === true) return;
    if (autocompleteKeyDown(event)) return;
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
        onSelect={(event) => onSelectionChange?.(event.currentTarget.selectionStart, event.currentTarget.selectionEnd)}
        onBlur={dismissAutocomplete}
        onMouseDown={handlePointerDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        aria-label="Markdown ソースエディタ"
      />
    </div>
  );
}
