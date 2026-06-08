import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import type { Node } from "unist";
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
  identifier?: string;
  children?: Node[];
}

interface Prepared {
  file: DroppedFile;
  id: string;
  title: string;
  body: string;
  extra: boolean;
}

interface Replacement {
  start: number;
  end: number;
  value: string;
}

interface AssetDest {
  fileDest: string;
  urlDest: string;
}

interface AssetNaming {
  destByUrl: Map<string, AssetDest>;
  usedNames: Set<string>;
}

const MD_EXT = /\.(?:md|markdown)$/i;
const IMG_SRC_RE = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
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

function dirOf(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const isAbsolute = normalized.startsWith("/");
  const out: string[] = [];
  for (const segment of normalized.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (!isAbsolute) out.push("..");
      continue;
    }
    out.push(segment);
  }
  return (isAbsolute ? "/" : "") + out.join("/");
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

function encodeDestUrl(id: string, candidate: string): string {
  return `assets/${id}/${encodeURIComponent(candidate)}`;
}

function assetDestFor(prepared: Prepared, rawPath: string, naming: AssetNaming, assets: ImportAssetOp[]): AssetDest {
  const existing = naming.destByUrl.get(rawPath);
  if (existing !== undefined) return existing;
  const base = basename(decodePath(rawPath)) || "asset";
  const dot = base.lastIndexOf(".");
  let candidate = base;
  let counter = 1;
  while (naming.usedNames.has(candidate.toLowerCase())) {
    candidate = dot > 0 ? `${base.slice(0, dot)}-${counter}${base.slice(dot)}` : `${base}-${counter}`;
    counter++;
  }
  naming.usedNames.add(candidate.toLowerCase());
  const dest: AssetDest = {
    fileDest: `assets/${prepared.id}/${candidate}`,
    urlDest: encodeDestUrl(prepared.id, candidate),
  };
  naming.destByUrl.set(rawPath, dest);
  assets.push({ srcFile: prepared.file.path, url: rawPath, dest: dest.fileDest });
  return dest;
}

function resolveLinkTarget(
  prepared: Prepared,
  decoded: string,
  idByName: Map<string, string>,
  idByPath: Map<string, string>,
): string | undefined {
  if (prepared.file.path.length > 0) {
    const resolved = normalizePath(`${dirOf(prepared.file.path)}/${decoded}`).toLowerCase();
    const byPath = idByPath.get(resolved) ?? idByPath.get(resolved.replace(MD_EXT, ""));
    if (byPath) return byPath;
  }
  const key = decoded.replace(/^\.\//, "").toLowerCase();
  return key.includes("/") ? undefined : idByName.get(key);
}

function rewriteRawHtml(prepared: Prepared, node: Node, naming: AssetNaming, assets: ImportAssetOp[]): Replacement[] {
  const start = offsetOf(node, "start");
  const raw = (node as { value?: unknown }).value;
  const value = typeof raw === "string" ? raw : "";
  if (start === null || value.length === 0 || prepared.file.path.length === 0) return [];
  const replacements: Replacement[] = [];
  IMG_SRC_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMG_SRC_RE.exec(value)) !== null) {
    const rawUrl = match[1] ?? match[2] ?? match[3] ?? "";
    if (rawUrl.length === 0) continue;
    const { path, suffix } = splitSuffix(rawUrl);
    const decoded = decodePath(path);
    if (isExternalUrl(path) || MD_EXT.test(decoded) || path.length === 0) continue;
    const offsetInMatch = match[0].lastIndexOf(rawUrl);
    if (offsetInMatch < 0) continue;
    const urlStart = start + match.index + offsetInMatch;
    const dest = assetDestFor(prepared, path, naming, assets);
    replacements.push({ start: urlStart, end: urlStart + rawUrl.length, value: `${dest.urlDest}${suffix}` });
  }
  return replacements;
}

function collectImageRefIds(tree: Node): Set<string> {
  const ids = new Set<string>();
  visit(tree, (node: Node) => {
    if (node.type !== "imageReference") return;
    const identifier = (node as { identifier?: unknown }).identifier;
    if (typeof identifier === "string") ids.add(identifier.toLowerCase());
  });
  return ids;
}

function rewriteBody(
  prepared: Prepared,
  idByName: Map<string, string>,
  idByPath: Map<string, string>,
  assets: ImportAssetOp[],
): string {
  const body = prepared.body;
  const tree = parser.parse(body);
  const imageRefIds = collectImageRefIds(tree);
  const replacements: Replacement[] = [];
  const naming: AssetNaming = { destByUrl: new Map(), usedNames: new Set() };

  visit(tree, (node: Node) => {
    if (node.type === "html") {
      replacements.push(...rewriteRawHtml(prepared, node, naming, assets));
      return;
    }
    if (!isUrlNode(node)) return;
    const span = urlSpan(node, body);
    if (!span) return;
    const { path, suffix } = splitSuffix(node.url);
    const decoded = decodePath(path);

    if (node.type === "link" || node.type === "definition") {
      const target = resolveLinkTarget(prepared, decoded, idByName, idByPath);
      if (target) {
        replacements.push({ start: span.start, end: span.end, value: `${target}.md${suffix}` });
        return;
      }
    }

    const isImageDefinition =
      node.type === "definition" && node.identifier !== undefined && imageRefIds.has(node.identifier.toLowerCase());
    if (
      (node.type === "image" || isImageDefinition) &&
      prepared.file.path.length > 0 &&
      !isExternalUrl(path) &&
      !MD_EXT.test(decoded)
    ) {
      const dest = assetDestFor(prepared, path, naming, assets);
      replacements.push({ start: span.start, end: span.end, value: `${dest.urlDest}${suffix}` });
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
  const idByPath = new Map<string, string>();
  for (const item of prepared) {
    const lower = item.file.name.toLowerCase();
    if (!idByName.has(lower)) idByName.set(lower, item.id);
    const stem = lower.replace(MD_EXT, "");
    if (!idByName.has(stem)) idByName.set(stem, item.id);
    if (item.file.path.length > 0) {
      const normalized = normalizePath(item.file.path).toLowerCase();
      idByPath.set(normalized, item.id);
      idByPath.set(normalized.replace(MD_EXT, ""), item.id);
    }
  }

  const assets: ImportAssetOp[] = [];
  let strippedMeta = false;
  const specs: ImportSpecEntry[] = prepared.map((item) => {
    if (item.extra) strippedMeta = true;
    return { id: item.id, title: item.title, content: rewriteBody(item, idByName, idByPath, assets) };
  });

  return { specs, assets, strippedMeta };
}
