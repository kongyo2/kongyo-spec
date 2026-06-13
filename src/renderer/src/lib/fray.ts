import { DEFAULT_FRAY_KINDS, type FrayKinds } from "@shared/schemas/settings";
import { safeDecode } from "./dom";
import { codeSpans, fencedCodeSpans, findPendingDecisions, type PendingRange, spanContains } from "./pending";
import { findVagueTerms } from "./vague";

export type FrayKind = "term" | "structure" | "link" | "syntax" | "vague" | "pending";
export type FraySeverity = "warn" | "info";

export interface FrayReplacement {
  start: number;
  end: number;
  /** 置換前の文字列。適用時に本文がずれていないかの照合に使う */
  from: string;
  to: string;
}

export interface FrayFix {
  /** 修正ボタンの文言(例: 「サーバ」→「サーバー」に統一) */
  label: string;
  replacements: FrayReplacement[];
}

export interface FrayIssue {
  id: string;
  kind: FrayKind;
  severity: FraySeverity;
  title: string;
  detail: string;
  start: number | null;
  end: number | null;
  /** ワンクリックで機械的に直せる場合の置換群。判断が要るものは null */
  fix: FrayFix | null;
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
    isMasked: (index) => spans.some((span) => spanContains(span, index)),
  };
}

function lineOf(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === "\n") line += 1;
  }
  return line;
}

// 同じキーに値を積む(無ければ配列を作る)。出現位置や同名見出しの集計に使う
function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

const KATAKANA_WORD_RE = /[ァ-ヺー]{2,}/g;

function replaceAllAt(positions: number[], from: string, to: string): FrayReplacement[] {
  return positions.map((start) => ({ start, end: start + from.length, from, to }));
}

function detectKatakanaVariants(content: string, masked: MaskedText): FrayIssue[] {
  const occurrences = new Map<string, number[]>();
  for (const match of content.matchAll(KATAKANA_WORD_RE)) {
    if (masked.isMasked(match.index)) continue;
    pushInto(occurrences, match[0], match.index);
  }
  const issues: FrayIssue[] = [];
  for (const [word, positions] of occurrences) {
    if (word.endsWith("ー")) continue;
    if (word.length < 2) continue;
    const longer = occurrences.get(`${word}ー`);
    if (!longer) continue;
    const shorterIsMinority = positions.length <= longer.length;
    const minority = shorterIsMinority ? { word, positions } : { word: `${word}ー`, positions: longer };
    const majority = shorterIsMinority ? { word: `${word}ー`, positions: longer } : { word, positions };
    issues.push({
      id: `term:katakana:${word}`,
      kind: "term",
      severity: "warn",
      title: `表記ゆれ: 「${word}」と「${word}ー」`,
      detail: `「${majority.word}」${majority.positions.length} 回 / 「${minority.word}」${minority.positions.length} 回。どちらかに統一すると読み手の混乱を防げます。`,
      start: minority.positions[0]!,
      end: minority.positions[0]! + minority.word.length,
      fix: {
        label: `「${minority.word}」を「${majority.word}」に統一`,
        replacements: replaceAllAt(minority.positions, minority.word, majority.word),
      },
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
  // 全角語ごとに全出現を集め、一括置換できる修正を組み立てる
  const fullPositions = new Map<string, number[]>();
  for (const match of content.matchAll(FULLWIDTH_WORD_RE)) {
    if (masked.isMasked(match.index)) continue;
    pushInto(fullPositions, match[0], match.index);
  }
  const issues: FrayIssue[] = [];
  const reported = new Set<string>();
  for (const [word, positions] of fullPositions) {
    const normalized = word.normalize("NFKC");
    if (!halfWords.has(normalized) || reported.has(normalized)) continue;
    reported.add(normalized);
    issues.push({
      id: `term:width:${normalized}`,
      kind: "term",
      severity: "info",
      title: `全角/半角ゆれ: 「${word}」と「${normalized}」`,
      detail: "同じ語が全角と半角で混在しています。検索性のため半角への統一を推奨します。",
      start: positions[0]!,
      end: positions[0]! + word.length,
      fix: {
        label: `「${word}」を「${normalized}」に統一`,
        replacements: replaceAllAt(positions, word, normalized),
      },
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
    const inFence = fenced.some((span) => spanContains(span, offset));
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
        fix: null,
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
    pushInto(byText, heading.text, heading);
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
      fix: null,
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
        fix: null,
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
          fix: null,
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
        fix: null,
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
      fix: null,
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
    fix: null,
  }));
}

// 箇条書き・番号付きリストの行を「要求文」とみなす。地の文(意図・背景の散文)の
// 形容まで咎めるとノイズになるため、要求として列挙された行だけを対象にする
const REQUIREMENT_LINE_RE = /^ {0,5}(?:[-*+]|\d{1,9}[.)])\s/;

function detectVagueRequirements(content: string, masked: MaskedText): FrayIssue[] {
  const issues: FrayIssue[] = [];
  const reported = new Set<string>();
  let offset = 0;
  for (const line of content.split("\n")) {
    if (REQUIREMENT_LINE_RE.test(line) || line.includes("SHALL")) {
      for (const hit of findVagueTerms(line)) {
        const start = offset + hit.index;
        if (masked.isMasked(start)) continue;
        if (reported.has(hit.term)) continue;
        reported.add(hit.term);
        issues.push({
          id: `vague:${hit.term}`,
          kind: "vague",
          severity: "info",
          title: `曖昧な表現: 「${hit.term}」`,
          detail: `要求文の「${hit.term}」は実装後に検証できません。数値・条件で測れる基準(応答時間、件数、操作手順など)への置き換えを検討してください。`,
          start,
          end: start + hit.term.length,
          fix: null,
        });
      }
    }
    offset += line.length + 1;
  }
  return issues;
}

const KIND_ORDER: Record<FrayKind, number> = { syntax: 0, link: 1, structure: 2, term: 3, vague: 4, pending: 5 };

export function detectFray(input: FrayInput, kinds: FrayKinds = DEFAULT_FRAY_KINDS): FrayIssue[] {
  const { content, specIds, headingIds } = input;
  if (content.trim().length === 0) return [];
  const masked = maskCode(content);
  const fenced = fencedCodeSpans(content);
  const headings = scanHeadings(content, fenced);
  const issues = [
    ...(kinds.syntax ? detectUnclosedFences(content) : []),
    ...(kinds.link ? detectBrokenLinks(content, masked, specIds, headingIds) : []),
    ...(kinds.structure
      ? [
          ...detectHeadingSkips(content, headings),
          ...detectDuplicateHeadings(headings),
          ...detectEmptySections(content, headings),
        ]
      : []),
    ...(kinds.term ? [...detectKatakanaVariants(content, masked), ...detectWidthVariants(content, masked)] : []),
    ...(kinds.vague ? detectVagueRequirements(content, masked) : []),
    ...(kinds.pending ? detectPendingMarkers(content) : []),
  ];
  return issues.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "warn" ? -1 : 1;
    if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return (a.start ?? 0) - (b.start ?? 0);
  });
}
