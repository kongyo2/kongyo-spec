import GithubSlugger from "github-slugger";
import { toText } from "hast-util-to-text";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import type { Element, Root } from "hast";
import { mdastToHast, remarkBase } from "./remark";

const processor = unified().use(remarkBase).use(mdastToHast);

export interface HeadingEntry {
  depth: number;
  text: string;
  slug: string;
}

export function extractHeadings(content: string): HeadingEntry[] {
  const slugger = new GithubSlugger();
  const tree = processor.runSync(processor.parse(content)) as Root;
  const entries: HeadingEntry[] = [];
  visit(tree, "element", (node: Element) => {
    if (!/^h[1-6]$/.test(node.tagName)) return;
    const depth = Number(node.tagName.slice(1));
    const text = toText(node).trim();
    const explicit = node.properties?.["id"];
    let slug: string;
    if (typeof explicit === "string" && explicit.length > 0) {
      slugger.slug(explicit);
      slug = explicit;
    } else {
      slug = slugger.slug(text);
    }
    entries.push({ depth, text, slug });
  });
  return entries;
}

export function buildToc(content: string): string {
  const headings = extractHeadings(content);
  if (headings.length === 0) return "";
  const minDepth = Math.min(...headings.map((heading) => heading.depth));
  return headings
    .map((heading) => {
      const indent = "  ".repeat(heading.depth - minDepth);
      const label = heading.text.length > 0 ? heading.text : "(無題)";
      return `${indent}- [${label}](#${heading.slug})`;
    })
    .join("\n");
}
