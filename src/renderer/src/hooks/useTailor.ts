import { useCallback, useEffect, useRef, useState } from "react";
import { type TailorState } from "../components/TailorPanel";
import { copyText } from "../lib/clipboard";
import { ipcErrorMessage } from "../lib/errors";
import { buildHandoffPrompt, mergePlanIntoContent, tailorPlanToMarkdown } from "../lib/tailor";
import type { EditingApi } from "./useSpecWorkspace";

export interface TailorController {
  state: TailorState;
  run: () => void;
  cancel: () => void;
  insertPlan: () => void;
  copyPlan: () => void;
  copyHandoff: () => void;
}

export function useTailor(editing: EditingApi, modelLabel: string, activeId: string | null): TailorController {
  const { docRef, notify, writeContent, ensureEditable, setJump, guard } = editing;
  const [state, setState] = useState<TailorState>({ status: "idle" });
  const stateRef = useRef(state);
  stateRef.current = state;
  const tokenRef = useRef(0);
  const runningRef = useRef(false);

  useEffect(() => {
    tokenRef.current += 1;
    setState((prev) => (prev.status === "running" ? prev : { status: "idle" }));
  }, [activeId]);

  const run = useCallback((): void => {
    const current = docRef.current;
    if (!current || runningRef.current) return;
    runningRef.current = true;
    const token = (tokenRef.current += 1);
    const tailoredContent = current.content;
    setState({ status: "running", model: modelLabel });
    window.api
      .tailorSpec(tailoredContent)
      .then(
        ({ plan, model }) => {
          if (tokenRef.current === token) setState({ status: "done", plan, model, tailoredContent });
          else setState((prev) => (prev.status === "running" ? { status: "idle" } : prev));
        },
        (err: unknown) => {
          if (tokenRef.current === token) setState({ status: "error", message: ipcErrorMessage(err) });
          else setState((prev) => (prev.status === "running" ? { status: "idle" } : prev));
        },
      )
      .finally(() => {
        runningRef.current = false;
      });
  }, [docRef, modelLabel]);

  const cancel = useCallback((): void => {
    tokenRef.current += 1;
    setState({ status: "idle" });
    void window.api.cancelAssist("tailor").catch(() => undefined);
  }, []);

  const insertPlan = useCallback((): void => {
    const current = docRef.current;
    const snapshot = stateRef.current;
    if (!current || snapshot.status !== "done") return;
    const section = tailorPlanToMarkdown(snapshot.plan, snapshot.model);
    const { next, start, end, replaced } = mergePlanIntoContent(current.content, section);
    guard("Tailor 計画の書き戻し前");
    writeContent(next);
    ensureEditable();
    setJump({ start, end });
    notify(replaced ? "本文の実装計画を更新しました" : "実装計画を末尾に挿入しました");
  }, [docRef, notify, writeContent, ensureEditable, setJump, guard]);

  const copyPlan = useCallback((): void => {
    const snapshot = stateRef.current;
    if (snapshot.status !== "done") return;
    void copyText(tailorPlanToMarkdown(snapshot.plan, snapshot.model)).then((ok) =>
      notify(ok ? "計画を Markdown でコピーしました" : "コピーできませんでした"),
    );
  }, [notify]);

  const copyHandoff = useCallback((): void => {
    const current = docRef.current;
    if (!current) return;
    const snapshot = stateRef.current;
    const planSection = snapshot.status === "done" ? tailorPlanToMarkdown(snapshot.plan, snapshot.model) : null;
    const prompt = buildHandoffPrompt({ title: current.meta.title, content: current.content, planSection });
    void copyText(prompt).then((ok) => notify(ok ? "実装プロンプトをコピーしました" : "コピーできませんでした"));
  }, [docRef, notify]);

  return { state, run, cancel, insertPlan, copyPlan, copyHandoff };
}
