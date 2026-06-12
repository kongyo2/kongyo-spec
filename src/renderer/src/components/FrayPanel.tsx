import { useState } from "react";
import {
  ArrowRight,
  Check,
  CircleAlert,
  CircleStop,
  History,
  Info,
  KeyRound,
  LoaderCircle,
  Radar,
  RefreshCw,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import type { AuditFinding, AuditFindingKind, AuditReport } from "@shared/schemas/assist";
import type { FrayIssue, FrayKind } from "../lib/fray";

export type AuditState =
  | { status: "idle" }
  | { status: "running"; model: string }
  | { status: "done"; report: AuditReport; model: string; auditedContent: string }
  | { status: "error"; message: string };

interface FrayPanelProps {
  issues: FrayIssue[];
  audit: AuditState;
  modelLabel: string;
  apiKeySet: boolean;
  docContent: string;
  onRunAudit: () => void;
  onCancelAudit: () => void;
  onClose: () => void;
  onJumpOffset: (start: number, end: number) => void;
  onJumpExcerpt: (excerpt: string) => void;
  onApplyFix: (issues: FrayIssue[]) => void;
  onOpenSettings: () => void;
}

const KIND_LABEL: Record<FrayKind, string> = {
  syntax: "構文",
  link: "リンク",
  structure: "構造",
  term: "用語",
  vague: "曖昧",
  pending: "未決定",
};

const AUDIT_KIND_LABEL: Record<AuditFindingKind, string> = {
  value: "値の食い違い",
  behavior: "振る舞いの衝突",
  term: "用語の衝突",
};

function IssueCard({
  issue,
  onJump,
  onFix,
}: {
  issue: FrayIssue;
  onJump: () => void;
  onFix: ((issue: FrayIssue) => void) | null;
}): React.ReactElement {
  const jumpable = issue.start !== null;
  const Icon = issue.severity === "warn" ? CircleAlert : Info;
  return (
    <div className={`fray-issue kind-${issue.kind} sev-${issue.severity}`}>
      <button
        type="button"
        className="fray-issue-jump"
        disabled={!jumpable}
        title={jumpable ? "該当箇所へ移動" : undefined}
        onClick={onJump}
      >
        <span className="fray-issue-head">
          <Icon size={13} aria-hidden="true" />
          <span className="fray-issue-title">{issue.title}</span>
          <span className="fray-kind-chip">{KIND_LABEL[issue.kind]}</span>
        </span>
        <span className="fray-issue-detail">{issue.detail}</span>
      </button>
      {issue.fix !== null && onFix !== null ? (
        <button
          type="button"
          className="fray-fix"
          title={`${issue.fix.replacements.length} 箇所を書き換えます`}
          onClick={() => onFix(issue)}
        >
          <Wrench size={12} aria-hidden="true" />
          {issue.fix.label}
        </button>
      ) : null}
    </div>
  );
}

function AuditFindingCard({
  finding,
  onJump,
}: {
  finding: AuditFinding;
  onJump: (excerpt: string) => void;
}): React.ReactElement {
  return (
    <article className={`fray-audit-finding kind-${finding.kind}`}>
      <header className="fray-audit-head">
        <span className="fray-audit-badge">{AUDIT_KIND_LABEL[finding.kind]}</span>
      </header>
      <button type="button" className="fray-excerpt" title="該当箇所を表示" onClick={() => onJump(finding.excerptA)}>
        {finding.excerptA}
      </button>
      <span className="fray-vs" aria-hidden="true">
        <ArrowRight size={11} />
        衝突
      </span>
      <button type="button" className="fray-excerpt" title="該当箇所を表示" onClick={() => onJump(finding.excerptB)}>
        {finding.excerptB}
      </button>
      <p className="fray-audit-reason">{finding.reason}</p>
    </article>
  );
}

export function FrayPanel({
  issues,
  audit,
  modelLabel,
  apiKeySet,
  docContent,
  onRunAudit,
  onCancelAudit,
  onClose,
  onJumpOffset,
  onJumpExcerpt,
  onApplyFix,
  onOpenSettings,
}: FrayPanelProps): React.ReactElement {
  const [showAllPending, setShowAllPending] = useState(false);

  const warnings = issues.filter((issue) => issue.severity === "warn");
  const infos = issues.filter((issue) => issue.severity === "info");
  const visibleInfos = showAllPending ? infos : infos.slice(0, 6);
  const fixable = issues.filter((issue) => issue.fix !== null);
  const fixIssue = (issue: FrayIssue): void => onApplyFix([issue]);

  let auditBody: React.ReactElement;
  if (audit.status === "running") {
    auditBody = (
      <div className="fray-audit-state">
        <LoaderCircle className="lens-spin" size={18} aria-hidden="true" />
        <p>記述同士の衝突を探しています…</p>
        <span className="lens-model-chip">{audit.model}</span>
        <button type="button" className="loom-ghost assist-cancel" onClick={onCancelAudit}>
          <CircleStop size={13} aria-hidden="true" />
          中止
        </button>
      </div>
    );
  } else if (audit.status === "error") {
    auditBody = (
      <div className="fray-audit-state">
        <p className="lens-error-text">{audit.message}</p>
        <button type="button" className="fray-audit-run" onClick={onRunAudit}>
          <RefreshCw size={13} aria-hidden="true" />
          再試行
        </button>
      </div>
    );
  } else if (audit.status === "done") {
    const stale = docContent !== audit.auditedContent;
    auditBody = (
      <>
        {stale ? (
          <p className="lens-stale">
            <History size={13} aria-hidden="true" />
            <span>本文が検査時点から変更されています。</span>
          </p>
        ) : null}
        <p className="lens-verdict">{audit.report.verdict}</p>
        {audit.report.findings.length === 0 ? (
          <div className="lens-clear">
            <Check size={16} aria-hidden="true" />
            <p>意味的な矛盾は見つかりませんでした。</p>
          </div>
        ) : (
          <div className="fray-audit-findings">
            {audit.report.findings.map((finding, index) => (
              <AuditFindingCard key={index} finding={finding} onJump={onJumpExcerpt} />
            ))}
          </div>
        )}
        <p className="lens-meta">
          矛盾 {audit.report.findings.length} 件 · {audit.model}
        </p>
      </>
    );
  } else if (!apiKeySet) {
    auditBody = (
      <div className="fray-audit-state">
        <span className="lens-intro-mark">
          <KeyRound size={16} aria-hidden="true" />
        </span>
        <p>AI 深層検査には API キーが必要です。</p>
        <button type="button" className="fray-audit-run" onClick={onOpenSettings}>
          設定を開く
        </button>
      </div>
    );
  } else {
    auditBody = (
      <div className="fray-audit-state">
        <p>数値の食い違い・相反する要求・用語の衝突を AI が読み取ります。</p>
        <button type="button" className="fray-audit-run" onClick={onRunAudit}>
          <Sparkles size={13} aria-hidden="true" />
          深層検査を実行
        </button>
        <span className="lens-model-chip">{modelLabel}</span>
      </div>
    );
  }

  return (
    <aside className="lens-panel fray-panel" aria-label="Fray 整合性検査">
      <div className="lens-head">
        <span className="sidebar-heading">Fray</span>
        <div className="lens-head-actions">
          {audit.status === "done" ? (
            <button
              type="button"
              className="lens-head-button"
              title="深層検査をやり直す"
              aria-label="深層検査をやり直す"
              onClick={onRunAudit}
            >
              <RefreshCw size={13} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="lens-head-button"
            title="閉じる"
            aria-label="Fray を閉じる"
            onClick={onClose}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="lens-body">
        <section className="fray-section">
          <h3 className="fray-section-title">
            <Radar size={13} aria-hidden="true" />
            ローカル検査
            <span className="fray-section-count">{issues.length}</span>
            {fixable.length > 1 ? (
              <button
                type="button"
                className="fray-fix-all"
                title="表記ゆれなど、機械的に直せる指摘を一括で書き換えます"
                onClick={() => onApplyFix(fixable)}
              >
                <Wrench size={11} aria-hidden="true" />
                まとめて直す ({fixable.length})
              </button>
            ) : null}
          </h3>
          {issues.length === 0 ? (
            <div className="lens-clear">
              <Check size={16} aria-hidden="true" />
              <p>ほつれは見つかりません。リンク・構造・表記は整っています。</p>
            </div>
          ) : (
            <div className="fray-issues">
              {warnings.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  onJump={() => issue.start !== null && onJumpOffset(issue.start, issue.end ?? issue.start)}
                  onFix={fixIssue}
                />
              ))}
              {visibleInfos.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  onJump={() => issue.start !== null && onJumpOffset(issue.start, issue.end ?? issue.start)}
                  onFix={fixIssue}
                />
              ))}
              {infos.length > visibleInfos.length ? (
                <button type="button" className="fray-more" onClick={() => setShowAllPending(true)}>
                  残り {infos.length - visibleInfos.length} 件を表示
                </button>
              ) : null}
            </div>
          )}
        </section>
        <section className="fray-section">
          <h3 className="fray-section-title">
            <Sparkles size={13} aria-hidden="true" />
            AI 深層検査
          </h3>
          {auditBody}
        </section>
      </div>
    </aside>
  );
}
