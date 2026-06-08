export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const MARKDOWN_RE = /\.(?:md|markdown)$/i;

export function isMarkdownFile(file: File): boolean {
  return MARKDOWN_RE.test(file.name);
}

export function deriveTitle(fileName: string): string {
  const stem = fileName.replace(MARKDOWN_RE, "").trim();
  const title = stem.length > 0 ? stem : "無題";
  return title.length > 200 ? title.slice(0, 200) : title;
}
