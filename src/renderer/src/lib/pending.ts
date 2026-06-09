export const PENDING_DECISION_RE = /【未決定[^】]*】/g;

export interface PendingRange {
  start: number;
  end: number;
}

export function findPendingDecisions(content: string): PendingRange[] {
  const ranges: PendingRange[] = [];
  for (const match of content.matchAll(PENDING_DECISION_RE)) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

export function nextPendingDecision(ranges: PendingRange[], fromOffset: number): PendingRange | null {
  if (ranges.length === 0) return null;
  return ranges.find((range) => range.start >= fromOffset) ?? ranges[0] ?? null;
}
