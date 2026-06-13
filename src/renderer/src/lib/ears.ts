import { findVagueTerms } from "./vague";

export type EarsFindingKind = "missing-shall" | "missing-then" | "dangling-then" | "multi-shall" | "vague";

export interface EarsFinding {
  line: number;
  excerpt: string;
  kind: EarsFindingKind;
  message: string;
}

export interface EarsLintReport {
  criteria: number;
  findings: EarsFinding[];
}

const CRITERION_LINE_RE = /^ {0,5}\d{1,3}[.)]\s+(.+)$/;
const TRIGGER_RE = /\b(?:WHEN|IF|WHILE|WHERE)\b/;
const THEN_RE = /\bTHEN\b/;
const SHALL_RE = /\bSHALL\b/g;
const EXCERPT_CHARS = 64;

export function lintEars(output: string): EarsLintReport {
  const findings: EarsFinding[] = [];
  let criteria = 0;
  const lines = output.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(CRITERION_LINE_RE);
    if (!match) continue;
    const text = match[1]!.trim();
    criteria += 1;
    if (text.includes("【未決定")) continue;
    const line = i + 1;
    const excerpt = text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS)}…` : text;
    const shallCount = (text.match(SHALL_RE) ?? []).length;
    const hasTrigger = TRIGGER_RE.test(text);
    const hasThen = THEN_RE.test(text);
    if (shallCount === 0) {
      findings.push({
        line,
        excerpt,
        kind: "missing-shall",
        message: "SHALL がありません。検証可能な要求の文になっていません。",
      });
    } else if (shallCount > 1) {
      findings.push({
        line,
        excerpt,
        kind: "multi-shall",
        message: `SHALL が ${shallCount} 回あります。一文一要求に分けると個別に検証できます。`,
      });
    }
    if (hasTrigger && !hasThen) {
      findings.push({
        line,
        excerpt,
        kind: "missing-then",
        message: "WHEN / IF / WHILE / WHERE に対応する THEN がありません。",
      });
    } else if (!hasTrigger && hasThen) {
      findings.push({
        line,
        excerpt,
        kind: "dangling-then",
        message: "THEN の前に WHEN / IF / WHILE / WHERE の条件がありません。",
      });
    }
    const vague = findVagueTerms(text)[0];
    if (vague !== undefined) {
      findings.push({
        line,
        excerpt,
        kind: "vague",
        message: `「${vague.term}」は検証できない形容です。測定できる値・条件に置き換えてください。`,
      });
    }
  }
  return { criteria, findings };
}
