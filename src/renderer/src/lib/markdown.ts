import { toText } from "hast-util-to-text";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeShikiFromHighlighter, { type RehypeShikiCoreOptions } from "@shikijs/rehype/core";
import rehypeSlug from "rehype-slug";
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

const DANGEROUS_TAGS = new Set(["script", "iframe", "object", "embed", "base"]);

function rehypeSanitizeScripts() {
  return (tree: Root): void => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (DANGEROUS_TAGS.has(node.tagName) && parent !== undefined && typeof index === "number") {
        parent.children.splice(index, 1);
        return [SKIP, index];
      }
      const props = node.properties;
      if (props) {
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

export async function renderMarkdownToHtml(markdown: string): Promise<string> {
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
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, {
      behavior: "append",
      properties: { className: ["heading-anchor"], ariaHidden: true, tabIndex: -1 },
      content: { type: "text", value: "#" },
    })
    .use(rehypeKatex)
    .use(rehypeMermaid)
    .use(rehypeSanitizeScripts)
    .use(rehypeShikiFromHighlighter, highlighter, shikiOptions)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(markdown);
  return String(file);
}

const htmlCache = new Map<string, string>();
const MAX_CACHE = 200;

export async function renderCached(content: string): Promise<string> {
  const cached = htmlCache.get(content);
  if (cached !== undefined) return cached;
  const html = await renderMarkdownToHtml(content);
  htmlCache.set(content, html);
  if (htmlCache.size > MAX_CACHE) {
    const oldest = htmlCache.keys().next().value;
    if (oldest !== undefined) htmlCache.delete(oldest);
  }
  return html;
}
