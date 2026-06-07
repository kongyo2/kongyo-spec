export interface GlobalMatch {
  pageIndex: number;
  indexInPage: number;
}

function eachTextNode(root: Node, visit: (node: Text) => void): void {
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeValue && node.nodeValue.length > 0) visit(node as Text);
    node = walker.nextNode();
  }
}

function countMatchesInNode(value: string, lowerQuery: string): number {
  if (lowerQuery.length === 0) return 0;
  const haystack = value.toLowerCase();
  let count = 0;
  let index = haystack.indexOf(lowerQuery);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(lowerQuery, index + lowerQuery.length);
  }
  return count;
}

export function buildGlobalMatches(pageHtmls: string[], query: string): GlobalMatch[] {
  const lowerQuery = query.toLowerCase();
  const matches: GlobalMatch[] = [];
  if (lowerQuery.length === 0) return matches;
  for (let pageIndex = 0; pageIndex < pageHtmls.length; pageIndex++) {
    const parsed = new DOMParser().parseFromString(pageHtmls[pageIndex] ?? "", "text/html");
    let inPage = 0;
    eachTextNode(parsed.body, (node) => {
      const count = countMatchesInNode(node.nodeValue ?? "", lowerQuery);
      for (let i = 0; i < count; i++) {
        matches.push({ pageIndex, indexInPage: inPage });
        inPage += 1;
      }
    });
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

export function applyHighlights(container: HTMLElement, query: string, currentIndexInPage: number): HTMLElement | null {
  clearHighlights(container);
  const lowerQuery = query.toLowerCase();
  if (lowerQuery.length === 0) return null;

  const textNodes: Text[] = [];
  eachTextNode(container, (node) => textNodes.push(node));

  let running = 0;
  let current: HTMLElement | null = null;

  for (const textNode of textNodes) {
    const value = textNode.nodeValue ?? "";
    const lower = value.toLowerCase();
    if (!lower.includes(lowerQuery)) continue;

    const fragment = document.createDocumentFragment();
    let cursor = 0;
    let index = lower.indexOf(lowerQuery);
    while (index !== -1) {
      if (index > cursor) fragment.appendChild(document.createTextNode(value.slice(cursor, index)));
      const mark = document.createElement("mark");
      mark.className = "search-hit";
      mark.textContent = value.slice(index, index + lowerQuery.length);
      if (running === currentIndexInPage) {
        mark.classList.add("search-hit-current");
        current = mark;
      }
      fragment.appendChild(mark);
      running += 1;
      cursor = index + lowerQuery.length;
      index = lower.indexOf(lowerQuery, cursor);
    }
    if (cursor < value.length) fragment.appendChild(document.createTextNode(value.slice(cursor)));
    textNode.parentNode?.replaceChild(fragment, textNode);
  }

  if (current) current.scrollIntoView({ block: "center", behavior: "smooth" });
  return current;
}
