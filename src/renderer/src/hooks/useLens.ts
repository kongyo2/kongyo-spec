import { useCallback, useEffect, useRef, useState } from "react";
import { type LensState } from "../components/LensPanel";
import { ipcErrorMessage } from "../lib/errors";
import type { EditingApi } from "./useSpecWorkspace";

export interface LensController {
  state: LensState;
  run: () => void;
  cancel: () => void;
  applyRewrite: (excerpt: string, rewrite: string) => boolean;
}

export function useLens(editing: EditingApi, modelLabel: string, activeId: string | null): LensController {
  const { docRef, notify, writeContent } = editing;
  const [state, setState] = useState<LensState>({ status: "idle" });
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
    const reviewedContent = current.content;
    setState({ status: "running", model: modelLabel });
    window.api
      .reviewSpec(reviewedContent)
      .then(
        ({ report, model }) => {
          if (tokenRef.current === token) setState({ status: "done", report, model, reviewedContent });
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
    void window.api.cancelAssist("review").catch(() => undefined);
  }, []);

  const applyRewrite = useCallback(
    (excerpt: string, rewrite: string): boolean => {
      const current = docRef.current;
      if (!current) return false;
      const index = current.content.indexOf(excerpt);
      if (index === -1) {
        notify("該当箇所が見つかりません。本文が変更された可能性があります。");
        return false;
      }
      if (current.content.indexOf(excerpt, index + 1) !== -1) {
        notify("同じ記述が複数あるため適用できません。該当箇所を直接編集してください。");
        return false;
      }
      writeContent(current.content.slice(0, index) + rewrite + current.content.slice(index + excerpt.length));
      return true;
    },
    [docRef, notify, writeContent],
  );

  return { state, run, cancel, applyRewrite };
}
