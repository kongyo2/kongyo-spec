import mermaid from "mermaid";
import type { ResolvedTheme } from "./theme";

let initializedTheme: ResolvedTheme | null = null;
let counter = 0;
let generation = 0;
const svgCache = new Map<string, string>();

function ensureInit(theme: ResolvedTheme): void {
  if (initializedTheme === theme) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: theme === "dark" ? "dark" : "default",
    fontFamily: "inherit",
  });
  if (initializedTheme !== null) {
    svgCache.clear();
    generation += 1;
  }
  initializedTheme = theme;
}

function sourceOf(block: HTMLElement): string {
  return (block.getAttribute("data-source") ?? block.textContent ?? "").trim();
}

function findLiveBlock(container: HTMLElement, source: string): HTMLElement | null {
  return (
    Array.from(container.querySelectorAll<HTMLElement>("pre.mermaid-block")).find(
      (block) => !block.querySelector("svg") && sourceOf(block) === source,
    ) ?? null
  );
}

export async function renderMermaidIn(container: HTMLElement, theme: ResolvedTheme): Promise<void> {
  const themeChanged = initializedTheme !== null && initializedTheme !== theme;
  ensureInit(theme);
  const gen = generation;
  if (themeChanged) {
    container.querySelectorAll<HTMLElement>("pre.mermaid-block.mermaid-rendered").forEach((block) => {
      const source = block.getAttribute("data-source");
      if (source !== null) {
        block.classList.remove("mermaid-rendered");
        block.textContent = source;
      }
    });
  }
  const pending = Array.from(container.querySelectorAll<HTMLElement>("pre.mermaid-block")).filter(
    (block) => !block.querySelector("svg") && !block.classList.contains("mermaid-error"),
  );

  for (const block of pending) {
    const source = sourceOf(block);
    if (source.length === 0) continue;
    block.setAttribute("data-source", source);

    const cached = svgCache.get(source);
    if (cached !== undefined) {
      block.innerHTML = cached;
      block.classList.add("mermaid-rendered");
      continue;
    }

    counter += 1;
    const id = `mermaid-render-${Date.now().toString(36)}-${counter}`;
    try {
      const { svg } = await mermaid.render(id, source);
      if (gen !== generation) return;
      svgCache.set(source, svg);
      const target = findLiveBlock(container, source) ?? block;
      target.innerHTML = svg;
      target.classList.add("mermaid-rendered");
      target.classList.remove("mermaid-error");
    } catch (err) {
      if (gen !== generation) return;
      const message = err instanceof Error ? err.message : String(err);
      const target = findLiveBlock(container, source) ?? block;
      target.classList.add("mermaid-error");
      target.classList.remove("mermaid-rendered");
      target.textContent = `Mermaid render error: ${message}\n\n${source}`;
    }
  }
}
