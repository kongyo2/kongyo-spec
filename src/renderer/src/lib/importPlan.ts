import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import type { Node } from "unist";
import { parseFile } from "@shared/frontmatter";
import type { ImportAssetOp, ImportPlan, ImportSpecEntry } from "@shared/api";
import { deriveTitle, MAX_ASSET_OPS, RESERVED_FRONTMATTER_KEYS } from "./import";
import { srcsetUrlTokens } from "./srcset";
import { applyReplacements, type TextReplacement } from "./text";

export interface DroppedFile {
  name: string;
  path: string;
  content: string;
}

export interface BuiltPlan extends ImportPlan {
  strippedMeta: boolean;
  assetsCapped: boolean;
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

interface AssetDest {
  fileDest: string;
  urlDest: string;
}

interface AssetNaming {
  destByUrl: Map<string, AssetDest>;
  usedNames: Set<string>;
}

interface LinkMaps {
  idByName: Map<string, string>;
  idByPath: Map<string, string>;
  idByPathLower: Map<string, string>;
}

interface BuildCtx {
  maps: LinkMaps;
  assets: ImportAssetOp[];
  capped: { value: boolean };
}

const MD_EXT = /\.(?:md|markdown)$/i;
const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const parser = unified().use(remarkParse).use(remarkGfm);

function uuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

function safeFromCodePoint(code: number, fallback: string): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}

function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = isHex ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? safeFromCodePoint(code, match) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

const FRONTMATTER_BLOCK = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function isBlockScalarIndicator(value: string): boolean {
  return /^[|>][+-]?\d*$/.test(value.trim());
}

function normalizeYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  if (isBlockScalarIndicator(trimmed)) return "";
  return trimmed;
}

function extractBlockScalar(content: string, key: string): string {
  const match = FRONTMATTER_BLOCK.exec(content);
  if (!match) return "";
  const lines = (match[1] ?? "").split(/\r?\n/);
  const header = new RegExp(`^${key}\\s*:\\s*([|>])[+-]?\\d*\\s*$`);
  let index = -1;
  let folded = false;
  for (let i = 0; i < lines.length; i++) {
    const headerMatch = header.exec(lines[i] ?? "");
    if (headerMatch) {
      index = i;
      folded = headerMatch[1] === ">";
      break;
    }
  }
  if (index < 0) return "";
  const collected: string[] = [];
  for (let i = index + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      collected.push("");
      continue;
    }
    if (!/^\s/.test(line)) break;
    collected.push(line);
  }
  while (collected.length > 0 && (collected[collected.length - 1] ?? "").trim() === "") collected.pop();
  const nonBlank = collected.filter((line) => line.trim() !== "");
  if (nonBlank.length === 0) return "";
  const indent = Math.min(...nonBlank.map((line) => /^\s*/.exec(line)?.[0].length ?? 0));
  const dedented = collected.map((line) => line.slice(indent));
  return folded ? dedented.join(" ").replace(/\s+/g, " ").trim() : dedented.join("\n").trim();
}

function isExternalUrl(url: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(url) ||
    url.startsWith("//") ||
    url.startsWith("/") ||
    url.startsWith("\\") ||
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

function matchBracketClose(sub: string, from: number): number {
  let depth = 0;
  for (let k = from; k < sub.length; k++) {
    const ch = sub[k];
    if (ch === "\\") {
      k++;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]") {
      if (depth === 0) return k;
      depth--;
    }
  }
  return -1;
}

function urlSpan(node: UrlNode, source: string): { start: number; end: number; bracketed: boolean } | null {
  const start = offsetOf(node, "start");
  const end = offsetOf(node, "end");
  if (start === null || end === null) return null;
  const sub = source.slice(start, end);

  let markerEnd: number;
  if (node.type === "image") {
    const close = matchBracketClose(sub, 2);
    if (close < 0 || sub[close + 1] !== "(") return null;
    markerEnd = close + 2;
  } else if (node.type === "definition") {
    const markerIndex = sub.indexOf("]:");
    if (markerIndex < 0) return null;
    markerEnd = markerIndex + 2;
  } else {
    let searchFrom = 0;
    if (node.children && node.children.length > 0) {
      const childEnd = offsetOf(node.children[node.children.length - 1] as Node, "end");
      if (childEnd !== null) searchFrom = Math.max(0, childEnd - start);
    }
    const markerIndex = sub.indexOf("](", searchFrom);
    if (markerIndex < 0) return null;
    markerEnd = markerIndex + 2;
  }

  let i = markerEnd;
  while (i < sub.length && /\s/.test(sub[i] ?? "")) i++;

  let urlStart: number;
  let urlEnd: number;
  let bracketed = false;
  if (sub[i] === "<") {
    bracketed = true;
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
      if (char === "\\" && j + 1 < sub.length) {
        j += 2;
        continue;
      }
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
  return { start: start + urlStart, end: start + urlEnd, bracketed };
}

function isUrlNode(node: Node): node is UrlNode {
  return (
    (node.type === "link" || node.type === "image" || node.type === "definition") &&
    typeof (node as UrlNode).url === "string" &&
    (node as UrlNode).url.length > 0
  );
}

function encodeDestUrl(id: string, candidate: string): string {
  const encoded = encodeURIComponent(candidate).replace(/\(/g, "%28").replace(/\)/g, "%29");
  return `assets/${id}/${encoded}`;
}

function assetDestFor(prepared: Prepared, rawPath: string, naming: AssetNaming, ctx: BuildCtx): AssetDest | null {
  const existing = naming.destByUrl.get(rawPath);
  if (existing !== undefined) return existing;
  if (ctx.assets.length >= MAX_ASSET_OPS) {
    ctx.capped.value = true;
    return null;
  }
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
  ctx.assets.push({ srcFile: prepared.file.path, url: rawPath, dest: dest.fileDest });
  return dest;
}

function resolveLinkTarget(prepared: Prepared, decoded: string, maps: LinkMaps): string | undefined {
  if (prepared.file.path.length > 0) {
    const resolved = normalizePath(`${dirOf(prepared.file.path)}/${decoded}`);
    const resolvedNoExt = resolved.replace(MD_EXT, "");
    const exact = maps.idByPath.get(resolved) ?? maps.idByPath.get(resolvedNoExt);
    if (exact) return exact;
    const lower = maps.idByPathLower.get(resolved.toLowerCase()) ?? maps.idByPathLower.get(resolvedNoExt.toLowerCase());
    if (lower) return lower;
  }
  const key = decoded.replace(/^\.\//, "").toLowerCase();
  return key.includes("/") ? undefined : maps.idByName.get(key);
}

function findAttr(tag: string, name: string): { value: string; start: number; end: number } | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  if (!match) return null;
  const value = match[1] ?? match[2] ?? match[3] ?? "";
  if (value.length === 0) return null;
  const index = match[0].lastIndexOf(value);
  if (index < 0) return null;
  return { value, start: match.index + index, end: match.index + index + value.length };
}

function htmlAttrEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function mdUrlEscape(value: string): string {
  return value.replace(/[\\()]/g, "\\$&");
}

function rawAssetUrl(prepared: Prepared, rawValue: string, naming: AssetNaming, ctx: BuildCtx): string | null {
  const { path, suffix } = splitSuffix(decodeEntities(rawValue));
  const decoded = decodePath(path);
  if (isExternalUrl(path) || MD_EXT.test(decoded) || path.length === 0) return null;
  const dest = assetDestFor(prepared, path, naming, ctx);
  return dest ? htmlAttrEscape(`${dest.urlDest}${suffix}`) : null;
}

function rawSrcset(prepared: Prepared, rawValue: string, naming: AssetNaming, ctx: BuildCtx): string | null {
  const replacements: TextReplacement[] = [];
  for (const token of srcsetUrlTokens(rawValue)) {
    const value = rawAssetUrl(prepared, token.url, naming, ctx);
    if (value !== null) replacements.push({ start: token.start, end: token.end, value });
  }
  return replacements.length === 0 ? null : applyReplacements(rawValue, replacements);
}

function rawLinkUrl(prepared: Prepared, rawValue: string, maps: LinkMaps): string | null {
  const { path, suffix } = splitSuffix(decodeEntities(rawValue));
  const target = resolveLinkTarget(prepared, decodePath(path), maps);
  return target ? htmlAttrEscape(`${target}.md${suffix}`) : null;
}

function rewriteRawHtml(prepared: Prepared, node: Node, naming: AssetNaming, ctx: BuildCtx): TextReplacement[] {
  const start = offsetOf(node, "start");
  const raw = (node as { value?: unknown }).value;
  const value = typeof raw === "string" ? raw : "";
  if (start === null || value.length === 0 || prepared.file.path.length === 0) return [];
  const replacements: TextReplacement[] = [];

  for (const tag of value.matchAll(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const tagStart = start + (tag.index ?? 0);
    const src = findAttr(tag[0], "src");
    if (src) {
      const next = rawAssetUrl(prepared, src.value, naming, ctx);
      if (next !== null) replacements.push({ start: tagStart + src.start, end: tagStart + src.end, value: next });
    }
    const srcset = findAttr(tag[0], "srcset");
    if (srcset) {
      const next = rawSrcset(prepared, srcset.value, naming, ctx);
      if (next !== null) replacements.push({ start: tagStart + srcset.start, end: tagStart + srcset.end, value: next });
    }
  }

  for (const tag of value.matchAll(/<source\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const tagStart = start + (tag.index ?? 0);
    const srcset = findAttr(tag[0], "srcset");
    if (!srcset) continue;
    const next = rawSrcset(prepared, srcset.value, naming, ctx);
    if (next !== null) replacements.push({ start: tagStart + srcset.start, end: tagStart + srcset.end, value: next });
  }

  for (const tag of value.matchAll(/<a\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const tagStart = start + (tag.index ?? 0);
    const href = findAttr(tag[0], "href");
    if (!href) continue;
    const next = rawLinkUrl(prepared, href.value, ctx.maps);
    if (next !== null) replacements.push({ start: tagStart + href.start, end: tagStart + href.end, value: next });
  }

  return replacements;
}

function rewriteBody(prepared: Prepared, ctx: BuildCtx): string {
  const body = prepared.body;
  const tree = parser.parse(body);
  const imageRefIds = new Set<string>();
  visit(tree, (node: Node) => {
    if (node.type !== "imageReference") return;
    const identifier = (node as { identifier?: unknown }).identifier;
    if (typeof identifier === "string") imageRefIds.add(identifier.toLowerCase());
  });

  const replacements: TextReplacement[] = [];
  const naming: AssetNaming = { destByUrl: new Map(), usedNames: new Set() };

  visit(tree, (node: Node) => {
    if (node.type === "html") {
      replacements.push(...rewriteRawHtml(prepared, node, naming, ctx));
      return;
    }
    if (!isUrlNode(node)) return;
    const span = urlSpan(node, body);
    if (!span) return;
    const { path, suffix } = splitSuffix(node.url);
    const decoded = decodePath(path);
    const outSuffix = span.bracketed ? suffix : mdUrlEscape(suffix);

    if (node.type === "link" || node.type === "definition") {
      const target = resolveLinkTarget(prepared, decoded, ctx.maps);
      if (target) {
        replacements.push({ start: span.start, end: span.end, value: `${target}.md${outSuffix}` });
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
      const dest = assetDestFor(prepared, path, naming, ctx);
      if (dest) replacements.push({ start: span.start, end: span.end, value: `${dest.urlDest}${outSuffix}` });
    }
  });

  return applyReplacements(body, replacements);
}

export function buildImportPlan(files: DroppedFile[]): BuiltPlan {
  const prepared: Prepared[] = files.map((file) => {
    const parsed = parseFile(file.content);
    const rawTitle = parsed.data["title"];
    const frontmatterTitle =
      typeof rawTitle === "string"
        ? isBlockScalarIndicator(rawTitle)
          ? extractBlockScalar(file.content, "title")
          : normalizeYamlScalar(rawTitle)
        : "";
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
  const idByPathLower = new Map<string, string>();
  for (const item of prepared) {
    const lower = item.file.name.toLowerCase();
    if (!idByName.has(lower)) idByName.set(lower, item.id);
    const stem = lower.replace(MD_EXT, "");
    if (!idByName.has(stem)) idByName.set(stem, item.id);
    if (item.file.path.length > 0) {
      const normalized = normalizePath(item.file.path);
      const normalizedNoExt = normalized.replace(MD_EXT, "");
      idByPath.set(normalized, item.id);
      idByPath.set(normalizedNoExt, item.id);
      const lowerPath = normalized.toLowerCase();
      const lowerPathNoExt = normalizedNoExt.toLowerCase();
      if (!idByPathLower.has(lowerPath)) idByPathLower.set(lowerPath, item.id);
      if (!idByPathLower.has(lowerPathNoExt)) idByPathLower.set(lowerPathNoExt, item.id);
    }
  }

  const ctx: BuildCtx = { maps: { idByName, idByPath, idByPathLower }, assets: [], capped: { value: false } };
  let strippedMeta = false;
  const specs: ImportSpecEntry[] = prepared.map((item) => {
    if (item.extra) strippedMeta = true;
    return { id: item.id, title: item.title, content: rewriteBody(item, ctx) };
  });

  return { specs, assets: ctx.assets, strippedMeta, assetsCapped: ctx.capped.value };
}
