/** content 内で line 行目(0 始まり)が始まる文字オフセット。範囲外なら末尾を返す */
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

/** content を行に分け、各行の本文と \n を含まない半開区間 [start, end) を順に返す */
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

/** 半開区間 [start, end) の置換群を後ろから当てて、先行する置換の位置をずらさずに適用する */
export function applyReplacements(source: string, replacements: readonly TextReplacement[]): string {
  if (replacements.length === 0) return source;
  let out = source;
  for (const { start, end, value } of [...replacements].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, start) + value + out.slice(end);
  }
  return out;
}
