import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_WEAVE_CONTEXT_CHARS,
  MAX_WEAVE_MATERIAL_CHARS,
  MAX_WEAVE_WOVEN_CHARS,
  type WeaveQa,
} from "@shared/schemas/assist";
import { INITIAL_LOOM_SESSION, type LoomSession, type WeaveKind } from "../components/LoomPanel";
import { ipcErrorMessage } from "../lib/errors";
import type { EditingApi } from "./useSpecWorkspace";

export interface LoomController {
  session: LoomSession;
  update: (patch: Partial<LoomSession>) => void;
  weave: (kind: WeaveKind) => void;
  retry: () => void;
  cancel: () => void;
  insert: () => void;
  pullSelection: () => void;
}

export function useLoom(editing: EditingApi, activeId: string | null): LoomController {
  const { docRef, notify, guard, grabSelection, insertComposed } = editing;
  const [session, setSession] = useState<LoomSession>(INITIAL_LOOM_SESSION);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const tokenRef = useRef(0);
  const runningRef = useRef(false);
  const lastKindRef = useRef<WeaveKind>("compose");

  useEffect(() => {
    tokenRef.current += 1;
    setSession(INITIAL_LOOM_SESSION);
  }, [activeId]);

  const update = useCallback((patch: Partial<LoomSession>): void => {
    setSession((prev) => ({ ...prev, ...patch }));
  }, []);

  const weave = useCallback(
    (kind: WeaveKind): void => {
      const current = docRef.current;
      if (!current || runningRef.current) return;
      const snapshot = sessionRef.current;
      const qa: WeaveQa[] = [];
      if (kind === "reweave" && snapshot.result !== null) {
        snapshot.result.questions.forEach((question, index) => {
          const answer = (snapshot.answers[index] ?? "").trim();
          if (answer.length > 0) qa.push({ question: question.question, answer: answer.slice(0, 4000) });
        });
      }
      const material = kind === "reweave" && snapshot.woven.trim().length > 0 ? snapshot.woven : snapshot.material;
      const materialLimit = kind === "reweave" ? MAX_WEAVE_WOVEN_CHARS : MAX_WEAVE_MATERIAL_CHARS;
      if (material.length > materialLimit) {
        notify(
          kind === "reweave"
            ? "織り上がりが上限(約 4.8 万字)を超えています。削ってから織り込んでください"
            : "素材が上限(約 3.2 万字)を超えています。削ってから織ってください",
        );
        return;
      }
      if (material.trim().length === 0 && qa.length === 0 && current.meta.title.trim().length === 0) {
        notify("素材がありません。メモや箇条書きを入れてから織ってください");
        return;
      }
      lastKindRef.current = kind;
      runningRef.current = true;
      const token = (tokenRef.current += 1);
      setSession((prev) => ({ ...prev, phase: "running", error: null }));
      window.api
        .weaveSpec({
          title: current.meta.title.slice(0, 200),
          material,
          context: current.content.slice(0, MAX_WEAVE_CONTEXT_CHARS),
          qa,
        })
        .then(
          ({ result, model }) => {
            if (tokenRef.current !== token) return;
            if (result.woven.length === 0 && result.questions.length === 0) {
              setSession((prev) => ({
                ...prev,
                phase: "error",
                error: "織れるものがありませんでした。素材を増やして再試行してください。",
              }));
              return;
            }
            setSession((prev) => ({
              ...prev,
              phase: "done",
              result,
              woven: result.woven,
              answers: new Array<string>(result.questions.length).fill(""),
              servedBy: model,
              error: null,
            }));
          },
          (err: unknown) => {
            if (tokenRef.current !== token) return;
            setSession((prev) => ({ ...prev, phase: "error", error: ipcErrorMessage(err) }));
          },
        )
        .finally(() => {
          runningRef.current = false;
        });
    },
    [docRef, notify],
  );

  const retry = useCallback((): void => {
    setSession((prev) => ({ ...prev, phase: prev.result !== null ? "done" : "compose", error: null }));
    weave(lastKindRef.current);
  }, [weave]);

  const cancel = useCallback((): void => {
    tokenRef.current += 1;
    setSession((prev) => ({ ...prev, phase: prev.result !== null ? "done" : "compose", error: null }));
    void window.api.cancelAssist("weave").catch(() => undefined);
  }, []);

  const insert = useCallback((): void => {
    const snapshot = sessionRef.current;
    const text = snapshot.woven.trim();
    if (text.length === 0) return;
    guard("Loom 織り上がりの反映前");
    const result = insertComposed(text, snapshot.replaceTargets);
    if (result === null) return;
    setSession(INITIAL_LOOM_SESSION);
    notify(
      result.kind === "replaced"
        ? result.count > 1
          ? `${result.count} 箇所を 1 つに織り直しました`
          : "選択箇所を置き換えました"
        : result.fellBack
          ? "置き換え対象を特定できないため、挿入に切り替えました"
          : "織り上がりを挿入しました",
    );
  }, [notify, guard, insertComposed]);

  const pullSelection = useCallback((): void => {
    const text = grabSelection();
    if (text === null) return;
    const prev = sessionRef.current;
    if (prev.replaceTargets.includes(text)) {
      notify("その範囲は取り込み済みです");
      return;
    }
    const merged = prev.material.trim().length > 0 ? `${prev.material.replace(/\s+$/, "")}\n\n${text}` : text;
    if (merged.length > MAX_WEAVE_MATERIAL_CHARS) {
      notify("素材が上限(約 3.2 万字)を超えるため取り込めません");
      return;
    }
    setSession({ ...prev, material: merged, replaceTargets: [...prev.replaceTargets, text] });
  }, [notify, grabSelection]);

  return { session, update, weave, retry, cancel, insert, pullSelection };
}
