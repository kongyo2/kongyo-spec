import mermaid from "mermaid";
import { renderMermaid as renderBeautifulMermaid } from "@vercel/beautiful-mermaid";
import type { MermaidRenderer } from "@shared/schemas/settings";
import { errorMessage } from "./errors";
import type { ResolvedTheme } from "./theme";

let initializedTheme: ResolvedTheme | null = null;
let activeRenderer: MermaidRenderer = "classic";
let counter = 0;
let generation = 0;
const svgCache = new Map<string, string>();

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function ensureInit(theme: ResolvedTheme): void {
  if (initializedTheme === theme) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    fontFamily: "inherit",
    flowchart: { curve: "basis" },
    themeVariables: {
      darkMode: theme === "dark",
      background: "transparent",
      primaryColor: cssVar("--surface-2"),
      primaryBorderColor: cssVar("--accent"),
      primaryTextColor: cssVar("--fg"),
      secondaryColor: cssVar("--surface-3"),
      tertiaryColor: cssVar("--code-bg"),
      lineColor: cssVar("--muted-2"),
      arrowheadColor: cssVar("--muted-2"),
      textColor: cssVar("--fg"),
      mainBkg: cssVar("--surface-2"),
      nodeBorder: cssVar("--accent"),
      nodeTextColor: cssVar("--fg"),
      clusterBkg: cssVar("--surface-1"),
      clusterBorder: cssVar("--border-strong"),
      titleColor: cssVar("--fg"),
      edgeLabelBackground: cssVar("--bg"),
      actorBkg: cssVar("--surface-2"),
      actorBorder: cssVar("--accent"),
      actorTextColor: cssVar("--fg"),
      signalColor: cssVar("--muted-2"),
      signalTextColor: cssVar("--fg"),
      noteBkgColor: cssVar("--code-bg"),
      noteTextColor: cssVar("--fg"),
      noteBorderColor: cssVar("--border-strong"),
    },
  });
  initializedTheme = theme;
}

function appFontFamily(): string {
  const family = getComputedStyle(document.body).fontFamily;
  return (
    family
      .split(",")[0]
      ?.trim()
      .replace(/^["']|["']$/g, "") ?? "Geist"
  );
}

async function renderBeautiful(source: string): Promise<string> {
  return renderBeautifulMermaid(source, {
    bg: cssVar("--bg"),
    fg: cssVar("--fg"),
    line: cssVar("--muted-2"),
    accent: cssVar("--accent"),
    muted: cssVar("--muted-2"),
    surface: cssVar("--surface-2"),
    border: cssVar("--border-strong"),
    font: appFontFamily(),
    transparent: true,
    cornerRadius: 6,
    edgeBendRadius: 8,
  });
}

function sourceOf(block: HTMLElement): string {
  return (block.getAttribute("data-source") ?? block.textContent ?? "").trim();
}

function findLiveBlock(container: HTMLElement, source: string): HTMLElement | null {
  return (
    Array.from(container.querySelectorAll<HTMLElement>("pre.mermaid-block")).find(
      (block) =>
        !block.querySelector("svg") && !block.classList.contains("mermaid-error") && sourceOf(block) === source,
    ) ?? null
  );
}

function syncConfig(theme: ResolvedTheme, renderer: MermaidRenderer): boolean {
  const configChanged = initializedTheme !== null && (initializedTheme !== theme || activeRenderer !== renderer);
  ensureInit(theme);
  activeRenderer = renderer;
  if (configChanged) {
    svgCache.clear();
    generation += 1;
  }
  return configChanged;
}

export async function renderMermaidSvg(
  source: string,
  theme: ResolvedTheme,
  renderer: MermaidRenderer,
): Promise<string> {
  if (document.fonts?.ready) await document.fonts.ready;
  syncConfig(theme, renderer);
  if (renderer === "beautiful") {
    try {
      return (await renderBeautiful(source)).trim();
    } catch {
      // beautiful-mermaid が対応しない図(gantt, pie など)は標準レンダラへ退避する
    }
  }
  counter += 1;
  const id = `mermaid-live-${Date.now().toString(36)}-${counter}`;
  return (await mermaid.render(id, source)).svg;
}

export async function renderMermaidIn(
  container: HTMLElement,
  theme: ResolvedTheme,
  renderer: MermaidRenderer,
): Promise<void> {
  if (document.fonts?.ready) await document.fonts.ready;
  const configChanged = syncConfig(theme, renderer);
  const gen = generation;
  if (configChanged) {
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
      let svg: string;
      if (renderer === "beautiful") {
        try {
          // eslint-disable-next-line no-await-in-loop -- diagrams render sequentially to keep DOM updates ordered
          svg = (await renderBeautiful(source)).trim();
        } catch {
          // beautiful-mermaid が対応しない図(gantt, pie など)は標準レンダラへ退避する
          // eslint-disable-next-line no-await-in-loop -- mermaid.render is not concurrency-safe
          svg = (await mermaid.render(id, source)).svg;
        }
      } else {
        // eslint-disable-next-line no-await-in-loop -- mermaid.render is not concurrency-safe
        svg = (await mermaid.render(id, source)).svg;
      }
      if (gen !== generation) return;
      svgCache.set(source, svg);
      const target = findLiveBlock(container, source) ?? block;
      target.innerHTML = svg;
      target.classList.add("mermaid-rendered");
      target.classList.remove("mermaid-error");
    } catch (err) {
      if (gen !== generation) return;
      const message = errorMessage(err);
      const target = findLiveBlock(container, source) ?? block;
      target.classList.add("mermaid-error");
      target.classList.remove("mermaid-rendered");
      target.textContent = `Mermaid render error: ${message}\n\n${source}`;
    }
  }
}
