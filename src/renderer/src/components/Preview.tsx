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

interface PreviewProps {
  pageContent: string;
  headingIds: string[];
  linkDefs: string;
  /** この値が変わったときだけスクロール位置を先頭へ戻す(ページ移動など)。編集中の再レンダリングでは保持する */
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
    scrollSyncRef,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const renderedKeyRef = useRef<string | null>(null);
  const [html, setHtml] = useState<string>("");

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

    // ページ移動・ドキュメント切替のときだけ先頭へ。タイピング由来の再レンダリングでは
    // スクロール位置を保つ(毎回先頭へ戻ると Split 編集が成立しない)
    if (resetKeyRef.current !== scrollResetKey) {
      resetKeyRef.current = scrollResetKey;
      container.scrollTop = 0;
    }
    decorateCodeBlocks(container);

    let headings = Array.from(container.querySelectorAll<HTMLElement>("h2, h3, h4, h5, h6"));
    // ページ先頭がそのページ自身の見出しで始まる場合、目次に同じ題を重ねない
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
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
