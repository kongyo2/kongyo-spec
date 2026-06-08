import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import type { Node, Parent } from "unist";
import { parseFile } from "@shared/frontmatter";
import type { ImportAssetOp, ImportPlan, ImportSpecEntry } from "@shared/api";
import { deriveTitle, RESERVED_FRONTMATTER_KEYS } from "./import";

export interface DroppedFile {
  name: string;
  path: string;
  content: string;
}

export interface BuiltPlan extends ImportPlan {
  strippedMeta: boolean;
}

interface UrlNode extends Node {
  type: "link" | "image" | "definition";
  url: string;
  children?: Node[];
}

interface Prepared {
  file: DroppedFile;
  id: string;
  title: string;
  body: string;
  extra: boolean;
}

const MD_EXT = /\.(?:md|markdown)$/i;
const parser = unified().use(remarkParse).use(remarkGfm);

function uuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

function isExternalUrl(url: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(url) ||
    url.startsWith("//") ||
    url.startsWith("/") ||
    url.startsWith("#") ||
    url.startsWith("?")
  );
}

function splitSuffix(url: string): { path: string; suffix: string } {
  const match = /[?#]/.exec(url);
  return match ? { path: url.slice(0, match.index), suffix: url.slice(match.index) } : { path: url, suffix: "" };
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? "";
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function offsetOf(node: Node, which: "start" | "end"): number | null {
  const point = node.position?.[which];
  return typeof point?.offset === "number" ? point.offset : null;
}

function urlSpan(node: UrlNode, source: string): { start: number; end: number } | null {
  const start = offsetOf(node, "start");
  const end = offsetOf(node, "end");
  if (start === null || end === null) return null;
  const sub = source.slice(start, end);

  let searchFrom = 0;
  if (node.type === "link" && node.children && node.children.length > 0) {
    const childEnd = offsetOf(node.children[node.children.length - 1] as Node, "end");
    if (childEnd !== null) searchFrom = Math.max(0, childEnd - start);
  }

  const marker = node.type === "definition" ? "]:" : "](";
  const markerIndex = sub.indexOf(marker, searchFrom);
  if (markerIndex < 0) return null;

  let i = markerIndex + marker.length;
  while (i < sub.length && /\s/.test(sub[i] ?? "")) i++;

  let urlStart: number;
  let urlEnd: number;
  if (sub[i] === "<") {
    urlStart = i + 1;
    const close = sub.indexOf(">", urlStart);
    if (close < 0) return null;
    urlEnd = close;
  } else {
    urlStart = i;
    let depth = 0;
    let j = i;
    while (j < sub.length) {
      const char = sub[j] ?? "";
      if (node.type === "definition") {
        if (/\s/.test(char)) break;
      } else if (char === "(") {
        depth++;
      } else if (char === ")") {
        if (depth === 0) break;
        depth--;
      } else if (/\s/.test(char)) {
        break;
      }
      j++;
    }
    urlEnd = j;
  }

  if (urlEnd <= urlStart) return null;
  return { start: start + urlStart, end: start + urlEnd };
}

function isUrlNode(node: Node): node is UrlNode {
  return (
    (node.type === "link" || node.type === "image" || node.type === "definition") &&
    typeof (node as UrlNode).url === "string" &&
    (node as UrlNode).url.length > 0
  );
}

function rewriteBody(prepared: Prepared, idByName: Map<string, string>, assets: ImportAssetOp[]): string {
  const body = prepared.body;
  const tree = parser.parse(body);
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const destByUrl = new Map<string, string>();
  const usedNames = new Set<string>();

  visit(tree as unknown as Parent, (node: Node) => {
    if (!isUrlNode(node)) return;
    const span = urlSpan(node, body);
    if (!span) return;
    const { path, suffix } = splitSuffix(node.url);
    const decoded = decodePath(path);

    if (node.type !== "image") {
      const key = decoded.replace(/^\.\//, "").toLowerCase();
      const target = idByName.get(key);
      if (target && (MD_EXT.test(key) || !key.includes("/"))) {
        replacements.push({ start: span.start, end: span.end, value: `${target}.md${suffix}` });
        return;
      }
    }

    if (prepared.file.path.length > 0 && !isExternalUrl(path) && !MD_EXT.test(decoded)) {
      const looksLikeFile = node.type === "image" || /\.[a-z0-9]+$/i.test(decoded);
      if (!looksLikeFile) return;
      let dest = destByUrl.get(path);
      if (dest === undefined) {
        const base = basename(decoded) || "asset";
        const dot = base.lastIndexOf(".");
        let candidate = base;
        let counter = 1;
        while (usedNames.has(candidate.toLowerCase())) {
          candidate = dot > 0 ? `${base.slice(0, dot)}-${counter}${base.slice(dot)}` : `${base}-${counter}`;
          counter++;
        }
        usedNames.add(candidate.toLowerCase());
        dest = `assets/${prepared.id}/${candidate}`;
        destByUrl.set(path, dest);
        assets.push({ srcFile: prepared.file.path, url: path, dest });
      }
      replacements.push({ start: span.start, end: span.end, value: `${dest}${suffix}` });
    }
  });

  replacements.sort((a, b) => b.start - a.start);
  let out = body;
  for (const replacement of replacements) {
    out = out.slice(0, replacement.start) + replacement.value + out.slice(replacement.end);
  }
  return out;
}

export function buildImportPlan(files: DroppedFile[]): BuiltPlan {
  const prepared: Prepared[] = files.map((file) => {
    const parsed = parseFile(file.content);
    const frontmatterTitle = typeof parsed.data["title"] === "string" ? parsed.data["title"].trim() : "";
    const chosen = frontmatterTitle.length > 0 ? frontmatterTitle : deriveTitle(file.name);
    const extra = Object.keys(parsed.data).some((key) => !RESERVED_FRONTMATTER_KEYS.has(key));
    return {
      file,
      id: uuid(),
      title: chosen.length > 200 ? chosen.slice(0, 200) : chosen,
      body: parsed.content,
      extra,
    };
  });

  const idByName = new Map<string, string>();
  for (const item of prepared) {
    const lower = item.file.name.toLowerCase();
    idByName.set(lower, item.id);
    idByName.set(lower.replace(MD_EXT, ""), item.id);
  }

  const assets: ImportAssetOp[] = [];
  let strippedMeta = false;
  const specs: ImportSpecEntry[] = prepared.map((item) => {
    if (item.extra) strippedMeta = true;
    return { id: item.id, title: item.title, content: rewriteBody(item, idByName, assets) };
  });

  return { specs, assets, strippedMeta };
}
