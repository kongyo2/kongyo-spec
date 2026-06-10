import { safeDecode } from "./dom";
import { codeSpans, fencedCodeSpans, findPendingDecisions, type PendingRange } from "./pending";

export type FrayKind = "term" | "structure" | "link" | "syntax" | "pending";
export type FraySeverity = "warn" | "info";

export interface FrayIssue {
  id: string;
  kind: FrayKind;
  severity: FraySeverity;
  title: string;
  detail: string;
  start: number | null;
  end: number | null;
}

export interface FrayInput {
  content: string;
  specIds: string[];
  headingIds: string[];
}

interface MaskedText {
  spans: PendingRange[];
  isMasked: (index: number) => boolean;
}

function maskCode(content: string): MaskedText {
  const spans = codeSpans(content);
  return {
    spans,
    isMasked: (index) => spans.some((span) => index >= span.start && index < span.end),
  };
}

function lineOf(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === "\n") line += 1;
  }
  return line;
}

const KATAKANA_WORD_RE = /[ァ-ヺー]{2,}/g;

function detectKatakanaVariants(content: string, masked: MaskedText): FrayIssue[] {
  const occurrences = new Map<string, { count: number; first: number }>();
  for (const match of content.matchAll(KATAKANA_WORD_RE)) {
    if (masked.isMasked(match.index)) continue;
    const word = match[0];
    const entry = occurrences.get(word);
    if (entry) entry.count += 1;
    else occurrences.set(word, { count: 1, first: match.index });
  }
  const issues: FrayIssue[] = [];
  for (const [word, entry] of occurrences) {
    if (word.endsWith("ー")) continue;
    if (word.length < 2) continue;
    const longer = occurrences.get(`${word}ー`);
    if (!longer) continue;
    const minority = entry.count <= longer.count ? { word, ...entry } : { word: `${word}ー`, ...longer };
    const majority = entry.count <= longer.count ? { word: `${word}ー`, ...longer } : { word, ...entry };
    issues.push({
      id: `term:katakana:${word}`,
      kind: "term",
      severity: "warn",
      title: `表記ゆれ: 「${word}」と「${word}ー」`,
      detail: `「${majority.word}」${majority.count} 回 / 「${minority.word}」${minority.count} 回。どちらかに統一すると読み手の混乱を防げます。`,
      start: minority.first,
      end: minority.first + minority.word.length,
    });
  }
  return issues;
}

const FULLWIDTH_WORD_RE = /[Ａ-Ｚａ-ｚ０-９]{2,}/g;
const HALFWIDTH_WORD_RE = /[A-Za-z0-9]{2,}/g;

function detectWidthVariants(content: string, masked: MaskedText): FrayIssue[] {
  const halfWords = new Set<string>();
  for (const match of content.matchAll(HALFWIDTH_WORD_RE)) {
    if (!masked.isMasked(match.index)) halfWords.add(match[0]);
  }
  const issues: FrayIssue[] = [];
  const reported = new Set<string>();
  for (const match of content.matchAll(FULLWIDTH_WORD_RE)) {
    if (masked.isMasked(match.index)) continue;
    const normalized = match[0].normalize("NFKC");
    if (!halfWords.has(normalized) || reported.has(normalized)) continue;
    reported.add(normalized);
    issues.push({
      id: `term:width:${normalized}`,
      kind: "term",
      severity: "info",
      title: `全角/半角ゆれ: 「${match[0]}」と「${normalized}」`,
      detail: "同じ語が全角と半角で混在しています。検索性のため半角への統一を推奨します。",
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return issues;
}

const ATX_HEADING_RE = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;

interface HeadingLine {
  level: number;
  text: string;
  start: number;
  end: number;
}

function scanHeadings(content: string, fenced: PendingRange[]): HeadingLine[] {
  const headings: HeadingLine[] = [];
  let offset = 0;
  for (const line of content.split("\n")) {
    const inFence = fenced.some((span) => offset >= span.start && offset < span.end);
    if (!inFence) {
      const match = line.match(ATX_HEADING_RE);
      if (match) {
        headings.push({
          level: match[1]!.length,
          text: match[2]!.trim(),
          start: offset,
          end: offset + line.length,
        });
      }
    }
    offset += line.length + 1;
  }
  return headings;
}

function detectHeadingSkips(content: string, headings: HeadingLine[]): FrayIssue[] {
  const issues: FrayIssue[] = [];
  let previous: HeadingLine | null = null;
  for (const heading of headings) {
    if (previous !== null && heading.level > previous.level + 1) {
      issues.push({
        id: `structure:skip:${heading.start}`,
        kind: "structure",
        severity: "warn",
        title: `見出しレベルの飛び: h${previous.level} → h${heading.level}`,
        detail: `${lineOf(content, heading.start)} 行目「${heading.text}」が h${previous.level + 1} を飛ばしています。アウトラインが崩れる原因になります。`,
        start: heading.start,
        end: heading.end,
      });
    }
    previous = heading;
  }
  return issues;
}

function detectDuplicateHeadings(headings: HeadingLine[]): FrayIssue[] {
  const byText = new Map<string, HeadingLine[]>();
  for (const heading of headings) {
    if (heading.text.length === 0) continue;
    const list = byText.get(heading.text);
    if (list) list.push(heading);
    else byText.set(heading.text, [heading]);
  }
  const issues: FrayIssue[] = [];
  for (const [text, list] of byText) {
    if (list.length < 2) continue;
    const second = list[1]!;
    issues.push({
      id: `structure:dup:${text}`,
      kind: "structure",
      severity: "info",
      title: `見出しの重複: 「${text}」が ${list.length} 箇所`,
      detail: "同名見出しはアンカーが自動で別名(-1 など)になり、リンクが意図しない場所へ飛ぶことがあります。",
      start: second.start,
      end: second.end,
    });
  }
  return issues;
}

function detectEmptySections(content: string, headings: HeadingLine[]): FrayIssue[] {
  const issues: FrayIssue[] = [];
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]!;
    const nextStart = headings[i + 1]?.start ?? content.length;
    const body = content.slice(heading.end, nextStart);
    const next = headings[i + 1];
    if (next && next.level <= heading.level && body.trim().length === 0) {
      issues.push({
        id: `structure:empty:${heading.start}`,
        kind: "structure",
        severity: "info",
        title: `空のセクション: 「${heading.text}」`,
        detail: "見出しだけで本文がありません。書きかけか、不要な見出しの可能性があります。",
        start: heading.start,
        end: heading.end,
      });
    }
  }
  return issues;
}

const INLINE_LINK_RE = /(!?)\[(?:[^\]\\]|\\.)*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;

function normalizeLinkTarget(raw: string): string {
  const inner = raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw;
  return inner.trim();
}

function detectBrokenLinks(content: string, masked: MaskedText, specIds: string[], headingIds: string[]): FrayIssue[] {
  const issues: FrayIssue[] = [];
  const anchors = new Set(headingIds);
  const specs = new Set(specIds);
  for (const match of content.matchAll(INLINE_LINK_RE)) {
    if (match[1] === "!") continue;
    if (masked.isMasked(match.index)) continue;
    const href = normalizeLinkTarget(match[2]!);
    if (href.length === 0 || /^(?:https?:)?\/\//i.test(href) || /^(?:mailto|data|file):/i.test(href)) continue;
    const start = match.index;
    const end = match.index + match[0].length;
    if (href.startsWith("#")) {
      const anchor = safeDecode(href.slice(1));
      if (anchor.length > 0 && !anchors.has(anchor)) {
        issues.push({
          id: `link:anchor:${start}`,
          kind: "link",
          severity: "warn",
          title: `リンク切れ: ${href}`,
          detail: "この見出しアンカーは本文に存在しません。見出しの変更後にリンクが残った可能性があります。",
          start,
          end,
        });
      }
      continue;
    }
    const hashIndex = href.indexOf("#");
    const beforeHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
    const queryIndex = beforeHash.indexOf("?");
    const pathname = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
    if (!/\.md$/i.test(pathname)) continue;
    const fileName = safeDecode(pathname).replace(/^\.\//, "").replace(/\/+$/, "");
    const targetId = fileName.replace(/\.md$/i, "");
    if (!specs.has(targetId)) {
      issues.push({
        id: `link:spec:${start}`,
        kind: "link",
        severity: "warn",
        title: `リンク切れ: ${pathname}`,
        detail: "リンク先の仕様書が見つかりません。削除または改名された可能性があります。",
        start,
        end,
      });
    }
  }
  return issues;
}

function detectUnclosedFences(content: string): FrayIssue[] {
  return fencedCodeSpans(content)
    .filter((span) => !span.closed)
    .map((span) => ({
      id: `syntax:fence:${span.start}`,
      kind: "syntax" as const,
      severity: "warn" as const,
      title: "閉じられていないコードフェンス",
      detail: `${lineOf(content, span.start)} 行目のコードフェンスが閉じられていません。以降の本文がすべてコードとして表示されます。`,
      start: span.start,
      end: Math.min(span.start + 80, span.end),
    }));
}

function detectPendingMarkers(content: string): FrayIssue[] {
  return findPendingDecisions(content).map((range) => ({
    id: `pending:${range.start}`,
    kind: "pending" as const,
    severity: "info" as const,
    title: "未決定マーカー",
    detail: content.slice(range.start, range.end),
    start: range.start,
    end: range.end,
  }));
}

const KIND_ORDER: Record<FrayKind, number> = { syntax: 0, link: 1, structure: 2, term: 3, pending: 4 };

export function detectFray(input: FrayInput): FrayIssue[] {
  const { content, specIds, headingIds } = input;
  if (content.trim().length === 0) return [];
  const masked = maskCode(content);
  const fenced = fencedCodeSpans(content);
  const headings = scanHeadings(content, fenced);
  const issues = [
    ...detectUnclosedFences(content),
    ...detectBrokenLinks(content, masked, specIds, headingIds),
    ...detectHeadingSkips(content, headings),
    ...detectDuplicateHeadings(headings),
    ...detectEmptySections(content, headings),
    ...detectKatakanaVariants(content, masked),
    ...detectWidthVariants(content, masked),
    ...detectPendingMarkers(content),
  ];
  return issues.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "warn" ? -1 : 1;
    if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return (a.start ?? 0) - (b.start ?? 0);
  });
}
