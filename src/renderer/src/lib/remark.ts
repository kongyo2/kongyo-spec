import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import type { PluggableList } from "unified";

export const remarkBase: PluggableList = [remarkParse, remarkGfm, remarkMath];

export const mdastToHast: PluggableList = [[remarkRehype, { allowDangerousHtml: true }], rehypeRaw];
