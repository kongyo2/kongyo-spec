export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_IMPORT_BYTES = 64 * 1024 * 1024;
export const MAX_IMPORT_FILES = 200;
export const MAX_ASSET_OPS = 5000;

export const RESERVED_FRONTMATTER_KEYS = new Set(["id", "title", "createdAt", "updatedAt"]);

const MARKDOWN_RE = /\.(?:md|markdown)$/i;

export function isMarkdownFile(file: File): boolean {
  return MARKDOWN_RE.test(file.name);
}

export function deriveTitle(fileName: string): string {
  const stem = fileName.replace(MARKDOWN_RE, "").trim();
  const title = stem.length > 0 ? stem : "無題";
  return title.length > 200 ? title.slice(0, 200) : title;
}
