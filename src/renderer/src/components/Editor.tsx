import { useEffect, useRef, useState } from "react";
import type { Highlighter } from "shiki";
import { getShikiHighlighter, SHIKI_THEMES } from "../lib/shiki";
import type { ResolvedTheme } from "../lib/theme";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface EditorProps {
  value: string;
  onChange: (next: string) => void;
  theme: ResolvedTheme;
}

export function Editor({ value, onChange, theme }: EditorProps): React.ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const [highlighter, setHighlighter] = useState<Highlighter | null>(null);
  const [html, setHtml] = useState<string>(() => `<pre class="shiki"><code>${escapeHtml(value)}</code></pre>`);

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
    if (!highlighter) {
      setHtml(`<pre class="shiki"><code>${escapeHtml(value)}</code></pre>`);
      return;
    }
    try {
      setHtml(highlighter.codeToHtml(value.length > 0 ? value : " ", { lang: "markdown", themes: SHIKI_THEMES }));
    } catch {
      setHtml(`<pre class="shiki"><code>${escapeHtml(value)}</code></pre>`);
    }
  }, [highlighter, value]);

  const syncScroll = (): void => {
    const textarea = textareaRef.current;
    const backdrop = backdropRef.current;
    if (!textarea || !backdrop) return;
    backdrop.scrollTop = textarea.scrollTop;
    backdrop.scrollLeft = textarea.scrollLeft;
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const textarea = event.currentTarget;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    if (start === end && !event.shiftKey) {
      onChange(`${value.slice(0, start)}  ${value.slice(end)}`);
      requestAnimationFrame(() => {
        textarea.selectionStart = start + 2;
        textarea.selectionEnd = start + 2;
      });
      return;
    }

    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const block = value.slice(lineStart, end);
    const modified = event.shiftKey ? block.replace(/^ {1,2}/gm, "") : block.replace(/^/gm, "  ");
    onChange(value.slice(0, lineStart) + modified + value.slice(end));
    requestAnimationFrame(() => {
      textarea.selectionStart = lineStart;
      textarea.selectionEnd = lineStart + modified.length;
    });
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
        aria-label="Markdown ソースエディタ"
      />
    </div>
  );
}
