import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_PRISM_CONTEXT_CHARS, MAX_PRISM_SELECTION_CHARS, type PrismDirection } from "@shared/schemas/assist";
import { INITIAL_PRISM_SESSION, type PrismSession } from "../components/PrismPanel";
import { copyText } from "../lib/clipboard";
import { ipcErrorMessage } from "../lib/errors";
import type { EditingApi, TextRange } from "./useSpecWorkspace";

export interface PrismController {
  session: PrismSession;
  update: (patch: Partial<PrismSession>) => void;
  run: (directionOverride?: PrismDirection) => void;
  cancel: () => void;
  adopt: (text: string) => void;
  copy: (text: string) => void;
  pullSelection: () => void;
}

function buildPrismContext(content: string, selection: string, range: TextRange | null): string {
  if (content.length <= MAX_PRISM_CONTEXT_CHARS) return content;
  const anchored =
    range !== null && content.slice(range.start, range.end) === selection ? range.start : content.indexOf(selection);
  if (anchored === -1) return content.slice(0, MAX_PRISM_CONTEXT_CHARS);
  const margin = Math.floor((MAX_PRISM_CONTEXT_CHARS - Math.min(selection.length, MAX_PRISM_CONTEXT_CHARS)) / 2);
  const start = Math.max(0, anchored - margin);
  const end = Math.min(content.length, anchored + selection.length + margin);
  return content.slice(start, end);
}

export function usePrism(editing: EditingApi, activeId: string | null): PrismController {
  const { docRef, selectionRef, notify, writeContent, ensureEditable, setJump, guard, grabSelection, insertComposed } =
    editing;
  const [session, setSession] = useState<PrismSession>(INITIAL_PRISM_SESSION);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const tokenRef = useRef(0);
  const runningRef = useRef(false);
  const shownDirRef = useRef<PrismDirection>("abstract");

  useEffect(() => {
    tokenRef.current += 1;
    setSession(INITIAL_PRISM_SESSION);
    if (runningRef.current) {
      runningRef.current = false;
      void window.api.cancelAssist("prism").catch(() => undefined);
    }
  }, [activeId]);

  const update = useCallback((patch: Partial<PrismSession>): void => {
    setSession((prev) => ({ ...prev, ...patch }));
  }, []);

  const run = useCallback(
    (directionOverride?: PrismDirection): void => {
      const current = docRef.current;
      if (!current || runningRef.current) return;
      const snapshot = sessionRef.current;
      const direction = directionOverride ?? snapshot.direction;
      const selection = snapshot.selection;
      if (selection.trim().length === 0) {
        notify("分光する一節がありません。本文を選んで取り込むか、書き入れてください");
        return;
      }
      if (selection.length > MAX_PRISM_SELECTION_CHARS) {
        notify("一節が長すぎます(約 8000 字まで)。狭めてから分光してください");
        return;
      }
      runningRef.current = true;
      const token = (tokenRef.current += 1);
      setSession((prev) => ({ ...prev, direction, phase: "running", error: null }));
      window.api
        .prismSpec({
          direction,
          selection,
          title: current.meta.title.slice(0, 200),
          context: buildPrismContext(current.content, selection, snapshot.replaceRange),
        })
        .then(
          ({ result, model }) => {
            if (tokenRef.current !== token) return;
            shownDirRef.current = direction;
            setSession((prev) => ({
              ...prev,
              phase: "done",
              reading: result.reading,
              variants: result.variants,
              drafts: result.variants.map((variant) => variant.text),
              servedBy: model,
              error: null,
            }));
          },
          (err: unknown) => {
            if (tokenRef.current !== token) return;
            const message = ipcErrorMessage(err);
            if (sessionRef.current.variants.length > 0) {
              setSession((prev) => ({ ...prev, phase: "done", direction: shownDirRef.current, error: null }));
              notify(`分光に失敗しました: ${message}`);
            } else {
              setSession((prev) => ({ ...prev, phase: "error", error: message }));
            }
          },
        )
        .finally(() => {
          if (tokenRef.current === token) runningRef.current = false;
        });
    },
    [docRef, notify],
  );

  const cancel = useCallback((): void => {
    tokenRef.current += 1;
    runningRef.current = false;
    setSession((prev) =>
      prev.variants.length > 0
        ? { ...prev, phase: "done", direction: shownDirRef.current, error: null }
        : { ...prev, phase: "compose", error: null },
    );
    void window.api.cancelAssist("prism").catch(() => undefined);
  }, []);

  const adopt = useCallback(
    (text: string): void => {
      if (text.trim().length === 0) return;
      const current = docRef.current;
      if (!current) return;
      const snapshot = sessionRef.current;
      guard(snapshot.direction === "abstract" ? "Prism 抽象化の反映前" : "Prism 具体化の反映前");
      const range = snapshot.replaceRange;
      if (range !== null && current.content.slice(range.start, range.end) === (snapshot.replaceTargets[0] ?? "")) {
        writeContent(current.content.slice(0, range.start) + text + current.content.slice(range.end));
        ensureEditable();
        setJump({ start: range.start, end: range.start + text.length });
        setSession(INITIAL_PRISM_SESSION);
        notify("選択箇所を置き換えました");
        return;
      }
      const result = insertComposed(text, snapshot.replaceTargets);
      if (result === null) return;
      setSession(INITIAL_PRISM_SESSION);
      notify(
        result.kind === "replaced"
          ? "選択箇所を置き換えました"
          : result.fellBack
            ? "置き換え対象を特定できないため、挿入に切り替えました"
            : "エディタへ挿入しました",
      );
    },
    [docRef, notify, writeContent, ensureEditable, setJump, guard, insertComposed],
  );

  const copy = useCallback(
    (text: string): void => {
      if (text.trim().length === 0) return;
      void copyText(text).then((ok) => notify(ok ? "案をコピーしました" : "コピーできませんでした"));
    },
    [notify],
  );

  const pullSelection = useCallback((): void => {
    const text = grabSelection();
    if (text === null) return;
    if (text.length > MAX_PRISM_SELECTION_CHARS) {
      notify("選択範囲が長すぎます(約 8000 字まで)。狭めてから取り込んでください");
      return;
    }
    const sel = selectionRef.current;
    const range = sel !== null && sel.start !== sel.end ? { start: sel.start, end: sel.end } : null;
    setSession((prev) => ({ ...prev, selection: text, replaceTargets: [text], replaceRange: range }));
  }, [notify, grabSelection, selectionRef]);

  return { session, update, run, cancel, adopt, copy, pullSelection };
}
