import type { TailorPlan, TailorTask } from "@shared/schemas/assist";
import { splitPages } from "./pages";
import { findPendingDecisions } from "./pending";

export const PLAN_HEADING = "実装計画";

const SIZE_LABEL: Record<TailorTask["size"], string> = { S: "S", M: "M", L: "L" };

function taskLines(task: TailorTask, index: number): string[] {
  const deps = task.dependsOn.length > 0 ? ` ／ 依存: ${task.dependsOn.map((num) => `#${num}`).join(", ")}` : "";
  const lines = [`${index + 1}. [ ] **${task.title}**(規模 ${SIZE_LABEL[task.size]}${deps})`];
  if (task.summary.length > 0) lines.push(`   ${task.summary.replace(/\s*\n\s*/g, " ")}`);
  for (const excerpt of task.acceptance) {
    lines.push(`   - 受け入れ: ${excerpt.replace(/\s*\n\s*/g, " ")}`);
  }
  if (task.verification.length > 0) {
    lines.push(`   - 確認: ${task.verification.replace(/\s*\n\s*/g, " ")}`);
  }
  return lines;
}

/** 計画を `## 実装計画` セクション(見出し込みの Markdown)へ整形する */
export function tailorPlanToMarkdown(plan: TailorPlan, model: string): string {
  const parts: string[] = [`## ${PLAN_HEADING}`];
  if (plan.approach.length > 0) parts.push(`**方針**: ${plan.approach}`);
  if (plan.tasks.length > 0) {
    parts.push(`### タスク\n\n${plan.tasks.map((task, index) => taskLines(task, index).join("\n")).join("\n")}`);
  }
  if (plan.blockers.length > 0) {
    parts.push(
      `### 着手前に人間が決めること\n\n${plan.blockers.map((blocker) => `- 【未決定: ${blocker.replace(/^【未決定:\s*/, "").replace(/】$/, "")}】`).join("\n")}`,
    );
  }
  if (plan.notes.length > 0) {
    parts.push(`### 補足\n\n${plan.notes.map((note) => `- ${note}`).join("\n")}`);
  }
  parts.push(`<!-- Tailor (${model}) が仕様書の記述のみから裁断 -->`);
  return parts.join("\n\n");
}

function lineStart(content: string, line: number): number {
  let offset = 0;
  for (let current = 0; current < line; current++) {
    const newline = content.indexOf("\n", offset);
    if (newline === -1) return content.length;
    offset = newline + 1;
  }
  return offset;
}

/**
 * `## 実装計画` セクションを本文へ統合する。既存のセクションがあれば置き換え、
 * 無ければ末尾に追記する。挿入位置を返す(エディタジャンプ用)。
 */
export function mergePlanIntoContent(
  content: string,
  section: string,
): { next: string; start: number; end: number; replaced: boolean } {
  const pages = splitPages(content);
  const index = pages.findIndex((page) => page.depth === 2 && page.title === PLAN_HEADING);
  if (index !== -1) {
    const page = pages[index]!;
    const start = lineStart(content, page.startLine);
    const nextPage = pages[index + 1];
    const end = nextPage ? lineStart(content, nextPage.startLine) : content.length;
    const replacement = nextPage ? `${section}\n\n` : `${section}\n`;
    return {
      next: content.slice(0, start) + replacement + content.slice(end),
      start,
      end: start + section.length,
      replaced: true,
    };
  }
  const body = content.replace(/\s+$/, "");
  const lead = body.length === 0 ? "" : "\n\n";
  const next = `${body}${lead}${section}\n`;
  const start = body.length + lead.length;
  return { next, start, end: start + section.length, replaced: false };
}

export interface HandoffInput {
  title: string;
  content: string;
  /** 本文に統合されていない計画セクション(あれば同梱する) */
  planSection: string | null;
}

/** 仕様書(+計画)を実装 AI へそのまま渡せる単一プロンプトに組み立てる */
export function buildHandoffPrompt(input: HandoffInput): string {
  const pending = findPendingDecisions(input.content).map((range) =>
    input.content.slice(range.start, range.end).replace(/\s*\n\s*/g, " "),
  );
  const hasPlanInContent = splitPages(input.content).some((page) => page.depth === 2 && page.title === PLAN_HEADING);
  const plan = !hasPlanInContent && input.planSection !== null ? input.planSection : null;

  const parts: string[] = [
    "あなたはソフトウェア実装エージェントである。以下の仕様書を実装する。",
    [
      "## 実装の規律",
      "",
      "- 仕様書が定めるのは意図と振る舞いである。仕様書に書かれていない実装詳細(言語・ライブラリ・内部設計)は、プロジェクトの慣習に従ってあなたが選び、選択した理由を記録する。",
      "- 本文中の 【未決定: …】 は人間がまだ決めていない箇所である。該当箇所を勝手に決めて実装してはならない。最小限のスタブに留め、TODO コメントに当該の問いを引用する。",
      "- 受け入れ条件・受け入れ基準(EARS の WHEN / THEN / SHALL を含む)は一つずつ検証可能な形で満たす。可能なら自動テストとして固定する。",
      "- 実装計画がある場合はタスクの順に進め、各タスクの「確認」を満たしてから次へ進む。完了したタスクはチェックを付ける。",
      "- 実装が仕様書と食い違ったら、実装を仕様書に合わせる。仕様書自体の矛盾を見つけたら、その箇所を引用して人間に報告し、判断を仰ぐ。",
    ].join("\n"),
  ];

  if (pending.length > 0) {
    parts.push(
      [
        `## 未決定事項(${pending.length} 件)`,
        "",
        "以下は人間の決定待ちである。これらに依存する実装はスタブに留めること。",
        "",
        ...pending.map((text) => `- ${text}`),
      ].join("\n"),
    );
  }

  parts.push(
    "---",
    `# 仕様書: ${input.title.trim().length > 0 ? input.title.trim() : "Untitled"}`,
    input.content.replace(/\s+$/, ""),
  );

  if (plan !== null) parts.push("---", plan);

  return `${parts.join("\n\n")}\n`;
}
