export interface GlobalMatch {
  pageIndex: number;
  indexInPage: number;
}

const EXCLUDED_FROM_SEARCH = ".mermaid-block, .copy-button, .code-lang, .heading-anchor, .katex-mathml, [hidden]";

interface Segment {
  node: Text;
  start: number;
  end: number;
}

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "caption",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

function closestBlock(node: Node): Element | null {
  let element = node.parentElement;
  while (element) {
    if (BLOCK_TAGS.has(element.tagName.toLowerCase())) return element;
    element = element.parentElement;
  }
  return null;
}

function collectText(root: Node): { text: string; segments: Segment[] } {
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        return (node as Element).matches(EXCLUDED_FROM_SEARCH) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const segments: Segment[] = [];
  let text = "";
  let previousBlock: Element | null = null;
  let first = true;
  let breakPending = false;
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if ((node as Element).tagName === "BR") breakPending = true;
      node = walker.nextNode();
      continue;
    }
    const value = node.nodeValue ?? "";
    if (value.length > 0) {
      const block = closestBlock(node);
      if (!first && (block !== previousBlock || breakPending)) text += "\n";
      first = false;
      previousBlock = block;
      breakPending = false;
      segments.push({ node: node as Text, start: text.length, end: text.length + value.length });
      text += value;
    }
    node = walker.nextNode();
  }
  return { text, segments };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findMatchRanges(text: string, query: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  if (query.length === 0) return ranges;
  const regex = new RegExp(escapeRegExp(query), "gi");
  let match = regex.exec(text);
  while (match !== null) {
    if (match[0].length === 0) {
      regex.lastIndex += 1;
    } else {
      ranges.push([match.index, match.index + match[0].length]);
      regex.lastIndex = match.index + match[0].length;
    }
    match = regex.exec(text);
  }
  return ranges;
}

export function buildGlobalMatches(pageHtmls: string[], query: string): GlobalMatch[] {
  const matches: GlobalMatch[] = [];
  if (query.length === 0) return matches;
  for (let pageIndex = 0; pageIndex < pageHtmls.length; pageIndex++) {
    const parsed = new DOMParser().parseFromString(pageHtmls[pageIndex] ?? "", "text/html");
    const { text } = collectText(parsed.body);
    const count = findMatchRanges(text, query).length;
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
  if (query.length === 0) return null;

  const { text, segments } = collectText(container);
  const ranges = findMatchRanges(text, query);
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
