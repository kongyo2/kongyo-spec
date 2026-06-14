import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_WARP_MATERIAL_CHARS } from "@shared/schemas/assist";
import { INITIAL_WARP_SESSION, type WarpSession } from "../components/WarpPanel";
import { ipcErrorMessage } from "../lib/errors";
import type { EditingApi } from "./useSpecWorkspace";

export interface WarpController {
  session: WarpSession;
  update: (patch: Partial<WarpSession>) => void;
  run: (materialOverride?: string) => void;
  cancel: () => void;
  insert: () => void;
  pullSelection: () => void;
  repairMermaid: (renderError: string) => void;
}

export function useWarp(editing: EditingApi, activeId: string | null): WarpController {
  const { docRef, notify, guard, grabSelection, insertComposed } = editing;
  const [session, setSession] = useState<WarpSession>(INITIAL_WARP_SESSION);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const tokenRef = useRef(0);
  const runningRef = useRef(false);

  useEffect(() => {
    tokenRef.current += 1;
    setSession(INITIAL_WARP_SESSION);
  }, [activeId]);

  const update = useCallback((patch: Partial<WarpSession>): void => {
    setSession((prev) => ({ ...prev, ...patch }));
  }, []);

  const run = useCallback(
    (materialOverride?: string): void => {
      const current = docRef.current;
      if (!current || runningRef.current) return;
      const snapshot = sessionRef.current;
      const material = materialOverride ?? snapshot.material;
      if (material.trim().length === 0) {
        notify("素材がありません。本文の選択範囲やメモを入れてから張ってください");
        return;
      }
      if (material.length > MAX_WARP_MATERIAL_CHARS) {
        notify("素材が上限(約 2.4 万字)を超えています。削ってから張ってください");
        return;
      }
      runningRef.current = true;
      const token = (tokenRef.current += 1);
      setSession((prev) => ({ ...prev, phase: "running", error: null }));
      window.api
        .warpSpec({
          form: snapshot.form,
          material,
          title: current.meta.title.slice(0, 200),
          diagram: snapshot.diagram,
        })
        .then(
          ({ result, model }) => {
            if (tokenRef.current !== token) return;
            setSession((prev) => ({
              ...prev,
              phase: "done",
              output: result.output,
              notes: result.notes,
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

  const cancel = useCallback((): void => {
    tokenRef.current += 1;
    setSession((prev) => ({ ...prev, phase: prev.output.trim().length > 0 ? "done" : "compose", error: null }));
    void window.api.cancelAssist("warp").catch(() => undefined);
  }, []);

  const insert = useCallback((): void => {
    const snapshot = sessionRef.current;
    const body = snapshot.output.trim();
    if (body.length === 0) return;
    const text = snapshot.form === "mermaid" ? `\`\`\`mermaid\n${body}\n\`\`\`` : body;
    guard(snapshot.form === "mermaid" ? "Warp 図の反映前" : "Warp 要件の反映前");
    const result = insertComposed(text, snapshot.replaceTargets);
    if (result === null) return;
    setSession(INITIAL_WARP_SESSION);
    notify(
      result.kind === "replaced"
        ? result.count > 1
          ? `${result.count} 箇所を張り替えました`
          : "選択箇所を張り替えました"
        : result.fellBack
          ? "置き換え対象を特定できないため、挿入に切り替えました"
          : snapshot.form === "mermaid"
            ? "図を挿入しました"
            : "要件を挿入しました",
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
    if (merged.length > MAX_WARP_MATERIAL_CHARS) {
      notify("素材が上限(約 2.4 万字)を超えるため取り込めません");
      return;
    }
    setSession({ ...prev, material: merged, replaceTargets: [...prev.replaceTargets, text] });
  }, [notify, grabSelection]);

  const repairMermaid = useCallback(
    (renderError: string): void => {
      const snapshot = sessionRef.current;
      const code = snapshot.output.trim();
      if (snapshot.form !== "mermaid" || code.length === 0) return;
      const material = [
        "以下の Mermaid コードはレンダリングでエラーになります。図の意味・構造は変えずに、構文だけを修復してください。",
        "",
        `エラーメッセージ: ${renderError.slice(0, 600)}`,
        "",
        "```mermaid",
        code,
        "```",
      ].join("\n");
      run(material);
    },
    [run],
  );

  return { session, update, run, cancel, insert, pullSelection, repairMermaid };
}
