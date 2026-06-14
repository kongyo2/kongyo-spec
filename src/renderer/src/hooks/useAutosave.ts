import { type Dispatch, type RefObject, type SetStateAction, useCallback, useEffect, useRef } from "react";
import { AUTOSAVE_DELAY_MS, type AutosaveDelay } from "@shared/schemas/settings";
import { byUpdatedDesc, type SpecDocument, type SpecMeta } from "@shared/schemas/spec";
import { errorMessage } from "../lib/errors";

export interface PendingSave {
  id: string;
  content: string;
}

export interface AutosaveParams {
  doc: SpecDocument | null;
  docRef: RefObject<SpecDocument | null>;
  setDoc: Dispatch<SetStateAction<SpecDocument | null>>;
  setSpecs: Dispatch<SetStateAction<SpecMeta[]>>;
  setSaving: Dispatch<SetStateAction<boolean>>;
  notify: (message: string) => void;
  autosaveDelay: AutosaveDelay;
}

export interface AutosaveController {
  flushSave: () => Promise<boolean>;
  loadedContentRef: RefObject<string>;
  pendingSaveRef: RefObject<PendingSave | null>;
}

export function useAutosave({
  doc,
  docRef,
  setDoc,
  setSpecs,
  setSaving,
  notify,
  autosaveDelay,
}: AutosaveParams): AutosaveController {
  const loadedContentRef = useRef("");
  const pendingSaveRef = useRef<PendingSave | null>(null);
  const flushPromiseRef = useRef<Promise<boolean> | null>(null);
  const flushSaveRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true));
  const retryTimerRef = useRef<number | null>(null);
  const saveFailedRef = useRef(false);

  const flushSave = useCallback((): Promise<boolean> => {
    if (flushPromiseRef.current) return flushPromiseRef.current;
    const run = (async (): Promise<boolean> => {
      while (pendingSaveRef.current) {
        const pending = pendingSaveRef.current;
        try {
          // eslint-disable-next-line no-await-in-loop
          const meta = await window.api.saveSpec(pending.id, pending.content);
          if (pendingSaveRef.current === pending) pendingSaveRef.current = null;
          if (docRef.current && docRef.current.meta.id === pending.id) {
            loadedContentRef.current = pending.content;
            if (docRef.current.content !== pending.content && pendingSaveRef.current === null) {
              pendingSaveRef.current = { id: docRef.current.meta.id, content: docRef.current.content };
            }
          }
          saveFailedRef.current = false;
          setSpecs((prev) => prev.map((spec) => (spec.id === meta.id ? meta : spec)).sort(byUpdatedDesc));
          setDoc((prev) => (prev && prev.meta.id === meta.id ? { ...prev, meta } : prev));
        } catch (err) {
          if (!saveFailedRef.current) {
            saveFailedRef.current = true;
            notify(`保存に失敗しました: ${errorMessage(err)}`);
          }
          if (retryTimerRef.current === null) {
            retryTimerRef.current = window.setTimeout(() => {
              retryTimerRef.current = null;
              if (pendingSaveRef.current) void flushSaveRef.current();
            }, 3000);
          }
          return false;
        }
      }
      return true;
    })();
    const tracked = run.finally(() => {
      if (flushPromiseRef.current === tracked) flushPromiseRef.current = null;
      setSaving(false);
    });
    flushPromiseRef.current = tracked;
    return tracked;
  }, [docRef, setDoc, setSpecs, setSaving, notify]);
  flushSaveRef.current = flushSave;

  useEffect(() => {
    if (!doc) return;
    if (doc.content === loadedContentRef.current) {
      if (pendingSaveRef.current?.id === doc.meta.id) pendingSaveRef.current = null;
      setSaving(false);
      return;
    }
    pendingSaveRef.current = { id: doc.meta.id, content: doc.content };
    setSaving(true);
    const handle = window.setTimeout(() => {
      void flushSave();
    }, AUTOSAVE_DELAY_MS[autosaveDelay]);
    return () => window.clearTimeout(handle);
  }, [doc, flushSave, autosaveDelay, setSaving]);

  useEffect(() => {
    return window.api.onFlushBeforeClose(() => {
      const current = docRef.current;
      if (current && current.content !== loadedContentRef.current) {
        pendingSaveRef.current = { id: current.meta.id, content: current.content };
      }
      void flushSave().then((ok) => {
        if (ok) window.api.notifyFlushComplete();
        else window.api.notifyFlushFailed();
      });
    });
  }, [flushSave, docRef]);

  return { flushSave, loadedContentRef, pendingSaveRef };
}
