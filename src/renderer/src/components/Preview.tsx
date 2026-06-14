import { useEffect, useMemo, useRef, useState } from "react";
import type { MermaidRenderer } from "@shared/schemas/settings";
import { copyText } from "../lib/clipboard";
import { safeDecode, scrollToId } from "../lib/dom";
import { renderCached } from "../lib/markdown";
import { renderMermaidIn } from "../lib/mermaid";
import { applyHighlights, clearHighlights } from "../lib/search";
import type { ResolvedTheme } from "../lib/theme";

export interface HeadingInfo {
  id: string;
  text: string;
  level: number;
}

export interface TableEditRequest {
  pageLineStart: number;
  pageLineEnd: number;
  raw: string;
  focus: { row: number; col: number } | null;
}

interface PreviewProps {
  pageContent: string;
  headingIds: string[];
  linkDefs: string;
  scrollResetKey: string;
  theme: ResolvedTheme;
  mermaidRenderer: MermaidRenderer;
  searchQuery: string;
  searchCurrentInPage: number;
  pendingAnchor: string | null;
  onAnchorHandled: () => void;
  onHeadings: (headings: HeadingInfo[]) => void;
  onActiveHeading: (id: string | null) => void;
  onLinkActivate: (href: string) => void;
  onTableEdit?: (request: TableEditRequest) => void;
  scrollSyncRef?: React.MutableRefObject<((ratio: number) => void) | null>;
}

function decorateCodeBlocks(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>("pre.shiki").forEach((pre) => {
    if (pre.querySelector(".copy-button")) return;
    const code = pre.querySelector("code");
    const langClass = Array.from(code?.classList ?? []).find((name) => name.startsWith("language-"));
    if (langClass) {
      const label = document.createElement("span");
      label.className = "code-lang";
      label.textContent = langClass.slice("language-".length);
      pre.appendChild(label);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-button";
    button.textContent = "Copy";
    button.setAttribute("aria-label", "コードをコピー");
    button.addEventListener("click", () => {
      void copyText(code?.textContent ?? "").then((ok) => {
        button.textContent = ok ? "Copied" : "Failed";
        window.setTimeout(() => {
          button.textContent = "Copy";
        }, 1200);
      });
    });
    pre.appendChild(button);
  });
}

function cellFocus(cell: HTMLTableCellElement): { row: number; col: number } {
  const col = cell.cellIndex;
  const tr = cell.parentElement;
  const section = tr?.parentElement;
  if (!tr || !section || section.tagName === "THEAD") return { row: -1, col };
  const row = Array.prototype.indexOf.call(section.children, tr);
  return { row, col };
}

interface TableLineRange {
  pageLineStart: number;
  pageLineEnd: number;
  raw: string;
}

function tableLineRange(table: Element, pageContent: string, linkDefs: string): TableLineRange | null {
  const [startStr, endStr] = (table.getAttribute("data-mdtbl") ?? "").split(":");
  const linkDefsNewlines = (linkDefs.match(/\n/g) ?? []).length;
  const pageLineStart = Number(startStr) - 1 - linkDefsNewlines;
  const pageLineEnd = Number(endStr) - 1 - linkDefsNewlines;
  if (!Number.isInteger(pageLineStart) || !Number.isInteger(pageLineEnd)) return null;
  const lines = pageContent.replace(/\r\n?/g, "\n").split("\n");
  if (pageLineStart < 0 || pageLineEnd < pageLineStart || pageLineEnd >= lines.length) return null;
  return { pageLineStart, pageLineEnd, raw: lines.slice(pageLineStart, pageLineEnd + 1).join("\n") };
}

function decorateTables(
  container: HTMLElement,
  pageContent: string,
  linkDefs: string,
  activate: (table: HTMLTableElement) => void,
): void {
  container.querySelectorAll<HTMLTableElement>("table[data-mdtbl]").forEach((table) => {
    if (table.dataset["teReady"] === "1") return;
    if (tableLineRange(table, pageContent, linkDefs) === null) return;
    table.dataset["teReady"] = "1";

    const wrap = document.createElement("div");
    wrap.className = "table-edit-wrap";
    table.parentNode?.insertBefore(wrap, table);
    wrap.appendChild(table);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "table-edit-button";
    button.textContent = "編集";
    button.setAttribute("aria-label", "テーブルをグリッドで編集");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      activate(table);
    });
    wrap.appendChild(button);
  });
}

export function Preview(props: PreviewProps): React.ReactElement {
  const {
    pageContent,
    headingIds,
    linkDefs,
    scrollResetKey,
    theme,
    mermaidRenderer,
    searchQuery,
    searchCurrentInPage,
    pendingAnchor,
    onAnchorHandled,
    onHeadings,
    onActiveHeading,
    onLinkActivate,
    onTableEdit,
    scrollSyncRef,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const renderedKeyRef = useRef<string | null>(null);
  const [html, setHtml] = useState<string>("");

  const pageContentRef = useRef(pageContent);
  const linkDefsRef = useRef(linkDefs);
  const tableEditRef = useRef(onTableEdit);
  pageContentRef.current = pageContent;
  linkDefsRef.current = linkDefs;
  tableEditRef.current = onTableEdit;

  const emitTableEdit = (table: HTMLTableElement, focus: { row: number; col: number } | null): void => {
    const handler = tableEditRef.current;
    if (!handler) return;
    const range = tableLineRange(table, pageContentRef.current, linkDefsRef.current);
    if (!range) return;
    handler({ ...range, focus });
  };

  const renderKey = useMemo(
    () => `${linkDefs.length}:${headingIds.length}:${headingIds.join(",")}:${linkDefs}${pageContent}`,
    [pageContent, headingIds, linkDefs],
  );

  const headingsRef = useRef(onHeadings);
  const activeHeadingRef = useRef(onActiveHeading);
  const linkRef = useRef(onLinkActivate);
  const anchorHandledRef = useRef(onAnchorHandled);
  headingsRef.current = onHeadings;
  activeHeadingRef.current = onActiveHeading;
  linkRef.current = onLinkActivate;
  anchorHandledRef.current = onAnchorHandled;

  useEffect(() => {
    let active = true;
    void renderCached(linkDefs + pageContent, headingIds).then((result) => {
      if (active) {
        renderedKeyRef.current = renderKey;
        setHtml(result);
      }
    });
    return () => {
      active = false;
    };
  }, [pageContent, headingIds, linkDefs]);

  const resetKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (resetKeyRef.current !== scrollResetKey) {
      resetKeyRef.current = scrollResetKey;
      container.scrollTop = 0;
    }
    decorateCodeBlocks(container);

    let headings = Array.from(container.querySelectorAll<HTMLElement>("h2, h3, h4, h5, h6"));
    if (headings[0] && headings[0] === container.firstElementChild) headings = headings.slice(1);
    headingsRef.current(
      headings.map((heading) => ({
        id: heading.id,
        text: (heading.textContent ?? "").replace(/#$/, "").trim(),
        level: Number(heading.tagName.slice(1)),
      })),
    );

    const handleScroll = (): void => {
      const threshold = container.getBoundingClientRect().top + 96;
      let activeId: string | null = headings[0]?.id ?? null;
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= threshold) activeId = heading.id;
        else break;
      }
      activeHeadingRef.current(activeId);
    };
    handleScroll();
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [html, scrollResetKey]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !tableEditRef.current) return;
    decorateTables(container, pageContentRef.current, linkDefsRef.current, (table) => emitTableEdit(table, null));
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container || html.length === 0) return;
    let frame = 0;
    const run = (): void => {
      void renderMermaidIn(container, theme, mermaidRenderer);
    };
    run();
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(run);
    });
    observer.observe(container, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [html, theme, mermaidRenderer]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (searchQuery.length === 0) {
      clearHighlights(container);
      return;
    }
    applyHighlights(container, searchQuery, searchCurrentInPage);
  }, [html, searchQuery, searchCurrentInPage]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || pendingAnchor === null) return;
    if (renderedKeyRef.current !== renderKey) return;
    if (scrollToId(container, pendingAnchor)) anchorHandledRef.current();
  }, [html, pendingAnchor, renderKey]);

  useEffect(() => {
    if (!scrollSyncRef) return;
    scrollSyncRef.current = (ratio: number): void => {
      const container = containerRef.current;
      if (!container) return;
      const range = container.scrollHeight - container.clientHeight;
      container.scrollTop = range > 0 ? ratio * range : 0;
    };
    return () => {
      scrollSyncRef.current = null;
    };
  }, [scrollSyncRef]);

  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (!tableEditRef.current) return;
    const cell = (event.target as HTMLElement).closest<HTMLTableCellElement>("td, th");
    const table = cell?.closest<HTMLTableElement>("table[data-mdtbl]");
    if (!cell || !table) return;
    event.preventDefault();
    emitTableEdit(table, cellFocus(cell));
  };

  const handleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    const anchor = target.closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href) return;
    event.preventDefault();
    if (href.startsWith("#")) {
      const container = containerRef.current;
      if (container && scrollToId(container, safeDecode(href.slice(1)))) return;
    }
    linkRef.current(href);
  };

  return (
    <div
      ref={containerRef}
      className="preview markdown-body"
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
