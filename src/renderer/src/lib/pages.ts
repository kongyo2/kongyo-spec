export interface VirtualPage {
  id: string;
  title: string;
  depth: 1 | 2;
  slug: string;
  startLine: number;
  content: string;
}

interface Boundary {
  line: number;
  level: 1 | 2;
  title: string;
}

export function slugify(input: string): string {
  const base = input
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base.length > 0 ? base : "section";
}

function findBoundaries(lines: string[]): Boundary[] {
  const boundaries: Boundary[] = [];
  let inFence = false;
  let fenceChar = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const marker = (fence[1] ?? "")[0] ?? "`";
      if (!inFence) {
        inFence = true;
        fenceChar = marker;
      } else if (marker === fenceChar) {
        inFence = false;
        fenceChar = "";
      }
      continue;
    }
    if (inFence) continue;

    const atx = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
    if (atx) {
      const level = (atx[1] ?? "").length;
      if (level === 1 || level === 2) {
        boundaries.push({ line: i, level, title: (atx[2] ?? "").trim() });
      }
      continue;
    }

    const text = line.trim();
    const next = lines[i + 1] ?? "";
    const isIndented = /^\s/.test(line);
    const looksLikeBlock = /^([-*+>|#]|\d+[.)])/.test(text);
    if (text.length > 0 && !isIndented && !looksLikeBlock) {
      if (/^=+\s*$/.test(next)) {
        boundaries.push({ line: i, level: 1, title: text });
      } else if (/^-+\s*$/.test(next)) {
        boundaries.push({ line: i, level: 2, title: text });
      }
    }
  }
  return boundaries;
}

export function splitPages(markdown: string): VirtualPage[] {
  const lines = markdown.split(/\r?\n/);
  const boundaries = findBoundaries(lines);
  const pages: VirtualPage[] = [];
  const used = new Map<string, number>();

  const allocate = (title: string): { id: string; slug: string } => {
    const base = slugify(title);
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    const slug = seen === 0 ? base : `${base}-${seen + 1}`;
    return { id: slug, slug };
  };

  const firstBoundaryLine = boundaries.length > 0 ? (boundaries[0]?.line ?? lines.length) : lines.length;
  const introContent = lines.slice(0, firstBoundaryLine).join("\n");
  if (introContent.trim().length > 0) {
    const { id, slug } = allocate("Introduction");
    pages.push({ id, title: "Introduction", depth: 1, slug, startLine: 0, content: introContent });
  }

  for (let b = 0; b < boundaries.length; b++) {
    const boundary = boundaries[b];
    if (!boundary) continue;
    const endLine = boundaries[b + 1]?.line ?? lines.length;
    const content = lines.slice(boundary.line, endLine).join("\n");
    const title = boundary.title.length > 0 ? boundary.title : "Untitled";
    const { id, slug } = allocate(title);
    pages.push({ id, title, depth: boundary.level, slug, startLine: boundary.line, content });
  }

  if (pages.length === 0) {
    pages.push({
      id: "introduction",
      title: "Introduction",
      depth: 1,
      slug: "introduction",
      startLine: 0,
      content: markdown,
    });
  }
  return pages;
}
