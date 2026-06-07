import GithubSlugger from "github-slugger";
import { toText } from "hast-util-to-text";
import rehypeRaw from "rehype-raw";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import type { Element, Root } from "hast";

const processor = unified().use(remarkParse).use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw);

export function computePageHeadingIds(pageContents: string[]): string[][] {
  const slugger = new GithubSlugger();
  return pageContents.map((content) => {
    const tree = processor.runSync(processor.parse(content)) as Root;
    const ids: string[] = [];
    visit(tree, "element", (node: Element) => {
      if (/^h[1-6]$/.test(node.tagName)) ids.push(slugger.slug(toText(node)));
    });
    return ids;
  });
}
