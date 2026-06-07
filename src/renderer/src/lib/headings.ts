import GithubSlugger from "github-slugger";
import { toString } from "mdast-util-to-string";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import type { Root } from "mdast";

const parser = unified().use(remarkParse);

export function computePageHeadingIds(pageContents: string[]): string[][] {
  const slugger = new GithubSlugger();
  return pageContents.map((content) => {
    const tree = parser.parse(content) as Root;
    const ids: string[] = [];
    visit(tree, "heading", (node) => {
      ids.push(slugger.slug(toString(node)));
    });
    return ids;
  });
}
