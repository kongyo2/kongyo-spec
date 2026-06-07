const BOM = "﻿";
const FRONTMATTER_RE = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

export interface ParsedFile {
  data: Record<string, unknown>;
  content: string;
}

function decodeScalar(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.startsWith('"')) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

export function parseFile(raw: string): ParsedFile {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    return { data: {}, content: raw.startsWith(BOM) ? raw.slice(BOM.length) : raw };
  }
  const block = match[1] ?? "";
  const content = raw.slice(match[0].length);
  const data: Record<string, unknown> = {};
  for (const line of block.split(/\r?\n/)) {
    const lineMatch = /^([A-Za-z0-9_]+):[ \t]?(.*)$/.exec(line);
    if (!lineMatch) continue;
    const key = lineMatch[1];
    if (key === undefined) continue;
    data[key] = decodeScalar(lineMatch[2] ?? "");
  }
  return { data, content };
}

export function stringifyFile(data: Record<string, string>, content: string): string {
  const header = Object.entries(data)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n");
  const body = content.replace(/^\r?\n+/, "");
  return `---\n${header}\n---\n\n${body}`;
}
