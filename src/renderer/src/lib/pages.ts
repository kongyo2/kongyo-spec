import { toString } from "mdast-util-to-string";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import type { Root as MdastRoot } from "mdast";

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

const parser = unified().use(remarkParse);

function findBoundaries(markdown: string): Boundary[] {
  const tree = parser.parse(markdown) as MdastRoot;
  const boundaries: Boundary[] = [];
  for (const node of tree.children) {
    if (node.type !== "heading") continue;
    if (node.depth !== 1 && node.depth !== 2) continue;
    const line = node.position?.start.line;
    if (line === undefined) continue;
    boundaries.push({ line: line - 1, level: node.depth, title: toString(node).trim() });
  }
  return boundaries;
}

export function splitPages(markdown: string): VirtualPage[] {
  const lines = markdown.split(/\r?\n/);
  const boundaries = findBoundaries(markdown);
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

function serializeUrl(url: string): string {
  return /[\s()<>]/.test(url) ? `<${url.replace(/([<>\\])/g, "\\$1")}>` : url;
}

export function collectLinkDefinitions(markdown: string): string {
  const tree = parser.parse(markdown) as MdastRoot;
  const lines: string[] = [];
  visit(tree, "definition", (node) => {
    const title = node.title ? ` "${node.title.replace(/"/g, '\\"')}"` : "";
    lines.push(`[${node.identifier}]: ${serializeUrl(node.url)}${title}`);
  });
  return lines.length > 0 ? `\n\n${lines.join("\n")}\n` : "";
}
