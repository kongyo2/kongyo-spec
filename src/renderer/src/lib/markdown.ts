import { toText } from "hast-util-to-text";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeShikiFromHighlighter, { type RehypeShikiCoreOptions } from "@shikijs/rehype/core";
import GithubSlugger from "github-slugger";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { SKIP, visit } from "unist-util-visit";
import type { Element, Root } from "hast";
import { getShikiHighlighter, SHIKI_THEMES } from "./shiki";

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
          if (/^on/i.test(key)) delete props[key];
        }
        for (const attr of ["href", "src"] as const) {
          const value = props[attr];
          if (typeof value === "string" && /^\s*javascript:/i.test(value)) delete props[attr];
        }
      }
      return undefined;
    });
  };
}

function rehypeSpecAssets() {
  return (tree: Root): void => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "img") return;
      const props = node.properties;
      if (!props) return;
      const src = props["src"];
      if (typeof src !== "string" || src.length === 0) return;
      if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//") || src.startsWith("/") || src.startsWith("#")) {
        return;
      }
      try {
        props["src"] = new URL(src, "specfile://spec/").href;
      } catch {
        // Leave an unresolvable relative reference as-authored.
      }
    });
  };
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
      props["id"] = provided ?? slugger.slug(toText(node));
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
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitizeScripts)
    .use(rehypeSpecAssets)
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
