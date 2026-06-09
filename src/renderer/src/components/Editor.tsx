import { useEffect, useRef, useState } from "react";
import type { Highlighter } from "shiki";
import { getShikiHighlighter, SHIKI_THEMES } from "../lib/shiki";
import type { ResolvedTheme } from "../lib/theme";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function plainCodeHtml(value: string): string {
  return `<pre class="shiki"><code>${escapeHtml(value)}</code></pre>`;
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
}

export function Editor({
  value,
  onChange,
  theme,
  jump,
  onJumpHandled,
  onSelectionChange,
}: EditorProps): React.ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const [highlighter, setHighlighter] = useState<Highlighter | null>(null);
  const [html, setHtml] = useState<string>(() => plainCodeHtml(value));

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
    if (!highlighter) {
      setHtml(plainCodeHtml(value));
      return;
    }
    try {
      setHtml(highlighter.codeToHtml(value.length > 0 ? value : " ", { lang: "markdown", themes: SHIKI_THEMES }));
    } catch {
      setHtml(plainCodeHtml(value));
    }
  }, [highlighter, value]);

  const syncScroll = (): void => {
    const textarea = textareaRef.current;
    const backdrop = backdropRef.current;
    if (!textarea || !backdrop) return;
    backdrop.scrollTop = textarea.scrollTop;
    backdrop.scrollLeft = textarea.scrollLeft;
  };

  useEffect(() => {
    if (!jump) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
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
    textarea.scrollTop = Math.max(0, offsetBottom - textarea.clientHeight / 2);
    const backdrop = backdropRef.current;
    if (backdrop) {
      backdrop.scrollTop = textarea.scrollTop;
      backdrop.scrollLeft = textarea.scrollLeft;
    }
    onJumpHandled();
  }, [jump, onJumpHandled]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
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
    <div className="editor" data-theme={theme}>
      <div
        className="editor-backdrop"
        ref={backdropRef}
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <textarea
        ref={textareaRef}
        className="editor-input"
        value={value}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onScroll={syncScroll}
        onKeyDown={handleKeyDown}
        onSelect={(event) => onSelectionChange?.(event.currentTarget.selectionStart, event.currentTarget.selectionEnd)}
        aria-label="Markdown ソースエディタ"
      />
    </div>
  );
}
