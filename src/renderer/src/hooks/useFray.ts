import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { FrayKinds } from "@shared/schemas/settings";
import type { SpecDocument, SpecMeta } from "@shared/schemas/spec";
import { type AuditState } from "../components/FrayPanel";
import { ipcErrorMessage } from "../lib/errors";
import { detectFray, type FrayIssue } from "../lib/fray";
import { computePageHeadingIds } from "../lib/headings";
import { splitPages } from "../lib/pages";
import type { EditingApi } from "./useSpecWorkspace";

export interface FrayParams {
  editing: EditingApi;
  modelLabel: string;
  activeId: string | null;
  doc: SpecDocument | null;
  specs: SpecMeta[];
  frayOpen: boolean;
  frayAutoCheck: boolean;
  frayKinds: FrayKinds;
}

export interface FrayController {
  issues: FrayIssue[];
  audit: AuditState;
  runAudit: () => void;
  cancelAudit: () => void;
  applyFixes: (issues: FrayIssue[]) => void;
}

export function useFray({
  editing,
  modelLabel,
  activeId,
  doc,
  specs,
  frayOpen,
  frayAutoCheck,
  frayKinds,
}: FrayParams): FrayController {
  const { docRef, notify, writeContent } = editing;
  const [audit, setAudit] = useState<AuditState>({ status: "idle" });
  const tokenRef = useRef(0);
  const runningRef = useRef(false);

  useEffect(() => {
    tokenRef.current += 1;
    setAudit((prev) => (prev.status === "running" ? prev : { status: "idle" }));
  }, [activeId]);

  const deferredContent = useDeferredValue(doc?.content ?? "");
  const frayEnabled = (frayAutoCheck || frayOpen) && doc !== null;
  const issues = useMemo<FrayIssue[]>(() => {
    if (!frayEnabled || deferredContent.trim().length === 0) return [];
    const deferredPages = splitPages(deferredContent);
    const headingIds = computePageHeadingIds(deferredPages.map((page) => page.content)).flat();
    return detectFray(
      {
        content: deferredContent,
        specIds: specs.map((spec) => spec.id),
        headingIds,
      },
      frayKinds,
    );
  }, [deferredContent, frayEnabled, specs, frayKinds]);

  const runAudit = useCallback((): void => {
    const current = docRef.current;
    if (!current || runningRef.current) return;
    runningRef.current = true;
    const token = (tokenRef.current += 1);
    const auditedContent = current.content;
    setAudit({ status: "running", model: modelLabel });
    window.api
      .auditSpec(auditedContent)
      .then(
        ({ report, model }) => {
          if (tokenRef.current === token) setAudit({ status: "done", report, model, auditedContent });
          else setAudit((prev) => (prev.status === "running" ? { status: "idle" } : prev));
        },
        (err: unknown) => {
          if (tokenRef.current === token) setAudit({ status: "error", message: ipcErrorMessage(err) });
          else setAudit((prev) => (prev.status === "running" ? { status: "idle" } : prev));
        },
      )
      .finally(() => {
        runningRef.current = false;
      });
  }, [docRef, modelLabel]);

  const cancelAudit = useCallback((): void => {
    tokenRef.current += 1;
    setAudit({ status: "idle" });
    void window.api.cancelAssist("audit").catch(() => undefined);
  }, []);

  const applyFixes = useCallback(
    (toFix: FrayIssue[]): void => {
      const current = docRef.current;
      if (!current) return;
      const content = current.content;
      const all = toFix
        .flatMap((issue) => issue.fix?.replacements ?? [])
        .sort((a, b) => a.start - b.start)
        .filter((rep, index, sorted) => index === 0 || rep.start >= sorted[index - 1]!.end);
      if (all.length === 0) return;
      for (const rep of all) {
        if (content.slice(rep.start, rep.end) !== rep.from) {
          notify("本文が検査時点から変わっています。再検査の完了を待ってからやり直してください");
          return;
        }
      }
      let next = content;
      for (let i = all.length - 1; i >= 0; i--) {
        const rep = all[i]!;
        next = next.slice(0, rep.start) + rep.to + next.slice(rep.end);
      }
      writeContent(next);
      notify(`${all.length} 箇所を修正しました`);
    },
    [docRef, notify, writeContent],
  );

  return { issues, audit, runAudit, cancelAudit, applyFixes };
}
