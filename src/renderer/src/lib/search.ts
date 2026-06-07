export interface GlobalMatch {
  pageIndex: number;
  indexInPage: number;
}

const EXCLUDED_FROM_SEARCH = ".mermaid-block, .copy-button, .code-lang";

function eachTextNode(root: Node, visit: (node: Text) => void): void {
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (parent && parent.closest(EXCLUDED_FROM_SEARCH)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node = walker.nextNode();
  while (node) {
    if (node.nodeValue && node.nodeValue.length > 0) visit(node as Text);
    node = walker.nextNode();
  }
}

interface Segment {
  node: Text;
  start: number;
  end: number;
}

function collectText(root: Node): { text: string; segments: Segment[] } {
  const segments: Segment[] = [];
  let text = "";
  eachTextNode(root, (node) => {
    const value = node.nodeValue ?? "";
    segments.push({ node, start: text.length, end: text.length + value.length });
    text += value;
  });
  return { text, segments };
}

function findMatchRanges(text: string, lowerQuery: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  if (lowerQuery.length === 0) return ranges;
  const haystack = text.toLowerCase();
  let index = haystack.indexOf(lowerQuery);
  while (index !== -1) {
    ranges.push([index, index + lowerQuery.length]);
    index = haystack.indexOf(lowerQuery, index + lowerQuery.length);
  }
  return ranges;
}

export function buildGlobalMatches(pageHtmls: string[], query: string): GlobalMatch[] {
  const lowerQuery = query.toLowerCase();
  const matches: GlobalMatch[] = [];
  if (lowerQuery.length === 0) return matches;
  for (let pageIndex = 0; pageIndex < pageHtmls.length; pageIndex++) {
    const parsed = new DOMParser().parseFromString(pageHtmls[pageIndex] ?? "", "text/html");
    const { text } = collectText(parsed.body);
    const count = findMatchRanges(text, lowerQuery).length;
    for (let i = 0; i < count; i++) matches.push({ pageIndex, indexInPage: i });
  }
  return matches;
}

export function clearHighlights(container: HTMLElement): void {
  const marks = container.querySelectorAll("mark.search-hit");
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
    parent.normalize();
  });
}

interface Piece {
  start: number;
  end: number;
  matchIndex: number;
}

export function applyHighlights(container: HTMLElement, query: string, currentIndexInPage: number): HTMLElement | null {
  clearHighlights(container);
  const lowerQuery = query.toLowerCase();
  if (lowerQuery.length === 0) return null;

  const { text, segments } = collectText(container);
  const ranges = findMatchRanges(text, lowerQuery);
  if (ranges.length === 0) return null;

  const pieces = new Map<Text, Piece[]>();
  ranges.forEach(([matchStart, matchEnd], matchIndex) => {
    for (const segment of segments) {
      if (segment.end <= matchStart || segment.start >= matchEnd) continue;
      const start = Math.max(matchStart, segment.start) - segment.start;
      const end = Math.min(matchEnd, segment.end) - segment.start;
      if (end <= start) continue;
      const list = pieces.get(segment.node) ?? [];
      list.push({ start, end, matchIndex });
      pieces.set(segment.node, list);
    }
  });

  let current: HTMLElement | null = null;
  for (const [node, list] of pieces) {
    list.sort((a, b) => a.start - b.start);
    const value = node.nodeValue ?? "";
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const piece of list) {
      if (piece.start > cursor) fragment.appendChild(document.createTextNode(value.slice(cursor, piece.start)));
      const mark = document.createElement("mark");
      mark.className = "search-hit";
      mark.textContent = value.slice(piece.start, piece.end);
      if (piece.matchIndex === currentIndexInPage) {
        mark.classList.add("search-hit-current");
        if (!current) current = mark;
      }
      fragment.appendChild(mark);
      cursor = piece.end;
    }
    if (cursor < value.length) fragment.appendChild(document.createTextNode(value.slice(cursor)));
    node.parentNode?.replaceChild(fragment, node);
  }

  if (current) current.scrollIntoView({ block: "center", behavior: "smooth" });
  return current;
}
