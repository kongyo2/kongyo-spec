export const PENDING_DECISION_RE = /【未決定[^】]*】/g;

export interface PendingRange {
  start: number;
  end: number;
}

const FENCE_LINE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

export interface FenceSpan extends PendingRange {
  closed: boolean;
}

export function fencedCodeSpans(content: string): FenceSpan[] {
  const spans: FenceSpan[] = [];
  let fence: { char: string; length: number; start: number } | null = null;
  let offset = 0;
  for (const line of content.split("\n")) {
    const match = line.match(FENCE_LINE_RE);
    if (match) {
      const marker = match[1]!;
      if (fence === null) {
        // CommonMark: バッククォートフェンスの info 文字列にバッククォートは置けない
        if (marker[0] !== "`" || !match[2]!.includes("`")) {
          fence = { char: marker[0]!, length: marker.length, start: offset };
        }
      } else if (marker[0] === fence.char && marker.length >= fence.length && match[2]!.trim().length === 0) {
        spans.push({ start: fence.start, end: offset + line.length, closed: true });
        fence = null;
      }
    }
    offset += line.length + 1;
  }
  if (fence !== null) spans.push({ start: fence.start, end: content.length, closed: false });
  return spans;
}

function escapedByBackslash(content: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && content[i] === "\\"; i--) backslashes += 1;
  return backslashes % 2 === 1;
}

function inlineCodeSpans(content: string, blocked: PendingRange[]): PendingRange[] {
  const runs: { start: number; length: number }[] = [];
  for (const match of content.matchAll(/`+/g)) {
    if (blocked.some((span) => match.index >= span.start && match.index < span.end)) continue;
    runs.push({ start: match.index, length: match[0].length });
  }
  const spans: PendingRange[] = [];
  let index = 0;
  while (index < runs.length) {
    const run = runs[index]!;
    let start = run.start;
    let length = run.length;
    // 開き候補のみエスケープが効く(スパン内部ではバックスラッシュは文字どおり)
    if (escapedByBackslash(content, start)) {
      start += 1;
      length -= 1;
    }
    if (length === 0) {
      index += 1;
      continue;
    }
    let closer = -1;
    for (let j = index + 1; j < runs.length; j++) {
      if (runs[j]!.length === length) {
        closer = j;
        break;
      }
    }
    if (closer === -1) {
      index += 1;
      continue;
    }
    spans.push({ start, end: runs[closer]!.start + runs[closer]!.length });
    index = closer + 1;
  }
  return spans;
}

const INDENTED_CODE_LINE_RE = /^(?: {4}|\t)/;
const LIST_ITEM_LINE_RE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;

function indentedCodeSpans(content: string, blocked: PendingRange[]): PendingRange[] {
  const spans: PendingRange[] = [];
  let offset = 0;
  let previousBlank = true;
  // リスト項目直後の 4 スペースはリストの継続であってコードではない
  let previousNonBlankIsListItem = false;
  let run: PendingRange | null = null;
  for (const line of content.split("\n")) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    const inFence = blocked.some((span) => lineStart >= span.start && lineStart < span.end);
    const blank = line.trim().length === 0;
    if (!blank) {
      const codeLine =
        !inFence &&
        INDENTED_CODE_LINE_RE.test(line) &&
        (run !== null || (previousBlank && !previousNonBlankIsListItem));
      if (codeLine) {
        if (run === null) run = { start: lineStart, end: lineEnd };
        else run.end = lineEnd;
      } else {
        if (run !== null) {
          spans.push(run);
          run = null;
        }
        previousNonBlankIsListItem = !inFence && LIST_ITEM_LINE_RE.test(line);
      }
    }
    previousBlank = blank;
    offset = lineEnd + 1;
  }
  if (run !== null) spans.push(run);
  return spans;
}

export function codeSpans(content: string): PendingRange[] {
  const fenced = fencedCodeSpans(content);
  const blocks = [...fenced, ...indentedCodeSpans(content, fenced)];
  return [...blocks, ...inlineCodeSpans(content, blocks)];
}

export function findPendingDecisions(content: string): PendingRange[] {
  const masked = codeSpans(content);
  const ranges: PendingRange[] = [];
  for (const match of content.matchAll(PENDING_DECISION_RE)) {
    if (masked.some((span) => match.index >= span.start && match.index < span.end)) continue;
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

export function nextPendingDecision(ranges: PendingRange[], fromOffset: number): PendingRange | null {
  if (ranges.length === 0) return null;
  return ranges.find((range) => range.start >= fromOffset) ?? ranges[0] ?? null;
}
