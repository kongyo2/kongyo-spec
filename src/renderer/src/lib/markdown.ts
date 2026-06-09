import { toText } from "hast-util-to-text";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeKatex from "rehype-katex";
import rehypeShikiFromHighlighter, { type RehypeShikiCoreOptions } from "@shikijs/rehype/core";
import GithubSlugger from "github-slugger";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";
import { SKIP, visit } from "unist-util-visit";
import type { Element, ElementContent, Root } from "hast";
import { mdastToHast, remarkBase } from "./remark";
import { PENDING_DECISION_RE } from "./pending";
import { getShikiHighlighter, SHIKI_THEMES } from "./shiki";
import { srcsetUrlTokens } from "./srcset";

function rehypeMermaid() {
  return (tree: Root): void => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName !== "pre" || parent === undefined || typeof index !== "number") return;
      const code = node.children.find(
        (child): child is Element => child.type === "element" && child.tagName === "code",
      );
      if (!code) return;
      const className = code.properties?.["className"];
      const classes = Array.isArray(className) ? className.map((value) => String(value)) : [];
      if (!classes.includes("language-mermaid")) return;
      const source = toText(code, { whitespace: "pre" });
      const replacement: Element = {
        type: "element",
        tagName: "pre",
        properties: { className: ["mermaid-block"] },
        children: [{ type: "text", value: source }],
      };
      parent.children[index] = replacement;
    });
  };
}

const DANGEROUS_TAGS = new Set(["script", "style", "link", "meta", "form", "iframe", "object", "embed", "base"]);

function rehypeSanitizeScripts() {
  return (tree: Root): void => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (DANGEROUS_TAGS.has(node.tagName) && parent !== undefined && typeof index === "number") {
        parent.children.splice(index, 1);
        return [SKIP, index];
      }
      const props = node.properties;
      if (props) {
        delete props["style"];
        for (const key of Object.keys(props)) {
          if (/^on/i.test(key)) {
            delete props[key];
            continue;
          }
          const value = props[key];
          if (typeof value === "string" && /^\s*(?:javascript|vbscript):/i.test(value)) {
            delete props[key];
          }
        }
      }
      return undefined;
    });
  };
}

function toSpecAssetUrl(value: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//") || value.startsWith("/") || value.startsWith("#")) {
    return null;
  }
  try {
    return new URL(value, "specfile://spec/").href;
  } catch {
    return null;
  }
}

function rewriteSrcsetAssets(value: string): string {
  const replacements: { start: number; end: number; value: string }[] = [];
  for (const token of srcsetUrlTokens(value)) {
    const resolved = toSpecAssetUrl(token.url);
    if (resolved) replacements.push({ start: token.start, end: token.end, value: resolved });
  }
  if (replacements.length === 0) return value;
  replacements.sort((a, b) => b.start - a.start);
  let out = value;
  for (const replacement of replacements) {
    out = out.slice(0, replacement.start) + replacement.value + out.slice(replacement.end);
  }
  return out;
}

function rehypeSpecAssets() {
  return (tree: Root): void => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "img" && node.tagName !== "source") return;
      const props = node.properties;
      if (!props) return;
      if (node.tagName === "img") {
        const src = props["src"];
        if (typeof src === "string" && src.length > 0) {
          const resolved = toSpecAssetUrl(src);
          if (resolved) props["src"] = resolved;
        }
      }
      const srcset = props["srcset"];
      if (typeof srcset === "string" && srcset.length > 0) {
        props["srcset"] = rewriteSrcsetAssets(srcset);
      }
    });
  };
}

const PENDING_SKIP_TAGS = new Set(["code", "pre", "script", "style", "textarea", "mark"]);

function splitPendingText(value: string): ElementContent[] | null {
  PENDING_DECISION_RE.lastIndex = 0;
  if (!PENDING_DECISION_RE.test(value)) return null;
  PENDING_DECISION_RE.lastIndex = 0;
  const out: ElementContent[] = [];
  let cursor = 0;
  for (const match of value.matchAll(PENDING_DECISION_RE)) {
    if (match.index > cursor) out.push({ type: "text", value: value.slice(cursor, match.index) });
    out.push({
      type: "element",
      tagName: "mark",
      properties: { className: ["pending-decision"], title: "人間が決めるまで実装してはいけない箇所" },
      children: [{ type: "text", value: match[0].slice(1, -1) }],
    });
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) out.push({ type: "text", value: value.slice(cursor) });
  return out;
}

function rehypePendingDecisions() {
  const walk = (node: Root | Element): void => {
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i];
      if (child === undefined) continue;
      if (child.type === "element") {
        if (!PENDING_SKIP_TAGS.has(child.tagName)) walk(child);
        continue;
      }
      if (child.type !== "text") continue;
      const replaced = splitPendingText(child.value);
      if (replaced) node.children.splice(i, 1, ...replaced);
    }
  };
  return (tree: Root): void => walk(tree);
}

function rehypeAssignIds(ids: string[]) {
  return (tree: Root): void => {
    const slugger = new GithubSlugger();
    for (const id of ids) slugger.slug(id);
    let index = 0;
    visit(tree, "element", (node: Element) => {
      if (!/^h[1-6]$/.test(node.tagName)) return;
      const provided = ids[index];
      index += 1;
      const props = node.properties ?? {};
      node.properties = props;
      const existing = props["id"];
      if (typeof existing !== "string" || existing.length === 0) {
        props["id"] = provided ?? slugger.slug(toText(node));
      }
    });
  };
}

export async function renderMarkdownToHtml(markdown: string, headingIds: string[]): Promise<string> {
  const highlighter = await getShikiHighlighter();
  const shikiOptions: RehypeShikiCoreOptions = {
    themes: SHIKI_THEMES,
    fallbackLanguage: "text",
    lazy: true,
    addLanguageClass: true,
    onError: (err: unknown) => console.warn("[shiki]", err),
  };
  const file = await unified()
    .use(remarkBase)
    .use(mdastToHast)
    .use(rehypeSanitizeScripts)
    .use(rehypeSpecAssets)
    .use(rehypePendingDecisions)
    .use(rehypeAssignIds, headingIds)
    .use(rehypeAutolinkHeadings, {
      behavior: "append",
      properties: { className: ["heading-anchor"], ariaHidden: true, tabIndex: -1 },
      content: { type: "text", value: "#" },
    })
    .use(rehypeKatex)
    .use(rehypeMermaid)
    .use(rehypeShikiFromHighlighter, highlighter, shikiOptions)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(markdown);
  return String(file);
}

const htmlCache = new Map<string, string>();
const MAX_CACHE = 200;

export async function renderCached(content: string, headingIds: string[]): Promise<string> {
  const key = `${headingIds.length}:${headingIds.join(",")}:${content}`;
  const cached = htmlCache.get(key);
  if (cached !== undefined) return cached;
  const html = await renderMarkdownToHtml(content, headingIds);
  htmlCache.set(key, html);
  if (htmlCache.size > MAX_CACHE) {
    const oldest = htmlCache.keys().next().value;
    if (oldest !== undefined) htmlCache.delete(oldest);
  }
  return html;
}
