import { useEffect, useRef, useState } from "react";
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
  theme: ResolvedTheme;
  searchQuery: string;
  searchCurrentInPage: number;
  pendingAnchor: string | null;
  onAnchorHandled: () => void;
  onHeadings: (headings: HeadingInfo[]) => void;
  onActiveHeading: (id: string | null) => void;
  onLinkActivate: (href: string) => void;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    document.body.removeChild(area);
    return ok;
  }
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
    theme,
    searchQuery,
    searchCurrentInPage,
    pendingAnchor,
    onAnchorHandled,
    onHeadings,
    onActiveHeading,
    onLinkActivate,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState<string>("");

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
    void renderCached(pageContent, headingIds).then((result) => {
      if (active) setHtml(result);
    });
    return () => {
      active = false;
    };
  }, [pageContent, headingIds]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.scrollTop = 0;
    decorateCodeBlocks(container);

    const headings = Array.from(container.querySelectorAll<HTMLElement>("h3, h4, h5, h6"));
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
  }, [html]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || html.length === 0) return;
    let frame = 0;
    const run = (): void => {
      void renderMermaidIn(container, theme);
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
  }, [html, theme]);

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
    const target = container.querySelector(`[id="${CSS.escape(pendingAnchor)}"]`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      anchorHandledRef.current();
    }
  }, [html, pendingAnchor]);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    const anchor = target.closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href) return;
    event.preventDefault();
    if (href.startsWith("#")) {
      const id = safeDecode(href.slice(1));
      const container = containerRef.current;
      const element = container?.querySelector(`[id="${CSS.escape(id)}"]`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
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
