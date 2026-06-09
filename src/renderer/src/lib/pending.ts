export const PENDING_DECISION_RE = /【未決定[^】]*】/g;

export interface PendingRange {
  start: number;
  end: number;
}

const FENCE_LINE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

function fencedCodeSpans(content: string): PendingRange[] {
  const spans: PendingRange[] = [];
  let fence: { char: string; length: number; start: number } | null = null;
  let offset = 0;
  for (const line of content.split("\n")) {
    const match = line.match(FENCE_LINE_RE);
    if (match) {
      const marker = match[1]!;
      if (fence === null) {
        fence = { char: marker[0]!, length: marker.length, start: offset };
      } else if (marker[0] === fence.char && marker.length >= fence.length && match[2]!.trim().length === 0) {
        spans.push({ start: fence.start, end: offset + line.length });
        fence = null;
      }
    }
    offset += line.length + 1;
  }
  if (fence !== null) spans.push({ start: fence.start, end: content.length });
  return spans;
}

function inlineCodeSpans(content: string, blocked: PendingRange[]): PendingRange[] {
  const runs: { start: number; length: number }[] = [];
  for (const match of content.matchAll(/`+/g)) {
    if (blocked.some((span) => match.index >= span.start && match.index < span.end)) continue;
    runs.push({ start: match.index, length: match[0].length });
  }
  const spans: PendingRange[] = [];
  for (let i = 0; i < runs.length; i++) {
    const open = runs[i]!;
    for (let j = i + 1; j < runs.length; j++) {
      if (runs[j]!.length !== open.length) continue;
      spans.push({ start: open.start, end: runs[j]!.start + runs[j]!.length });
      i = j;
      break;
    }
  }
  return spans;
}

function codeSpans(content: string): PendingRange[] {
  const fenced = fencedCodeSpans(content);
  return [...fenced, ...inlineCodeSpans(content, fenced)];
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
