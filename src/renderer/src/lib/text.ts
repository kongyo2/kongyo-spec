export function lineStartOffset(content: string, line: number): number {
  let offset = 0;
  for (let current = 0; current < line; current++) {
    const newline = content.indexOf("\n", offset);
    if (newline === -1) return content.length;
    offset = newline + 1;
  }
  return offset;
}

export interface Line {
  text: string;
  start: number;
  end: number;
}

export function* eachLine(content: string): Generator<Line> {
  let start = 0;
  for (const text of content.split("\n")) {
    yield { text, start, end: start + text.length };
    start += text.length + 1;
  }
}

export interface TextReplacement {
  start: number;
  end: number;
  value: string;
}

export function applyReplacements(source: string, replacements: readonly TextReplacement[]): string {
  if (replacements.length === 0) return source;
  let out = source;
  for (const { start, end, value } of [...replacements].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, start) + value + out.slice(end);
  }
  return out;
}
