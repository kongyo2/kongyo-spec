import { createHighlighter, createJavaScriptRegexEngine, type Highlighter } from "shiki";

export const SHIKI_THEMES = { light: "github-light", dark: "github-dark" } as const;

const INITIAL_LANGS = [
  "markdown",
  "javascript",
  "typescript",
  "tsx",
  "jsx",
  "json",
  "bash",
  "shell",
  "python",
  "go",
  "rust",
  "html",
  "css",
  "yaml",
  "sql",
  "diff",
];

let highlighterPromise: Promise<Highlighter> | null = null;

export function getShikiHighlighter(): Promise<Highlighter> {
  if (highlighterPromise === null) {
    highlighterPromise = createHighlighter({
      themes: [SHIKI_THEMES.light, SHIKI_THEMES.dark],
      langs: INITIAL_LANGS,
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  }
  return highlighterPromise;
}
