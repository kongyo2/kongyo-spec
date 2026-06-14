import { useCallback, useEffect, useRef, useState } from "react";
import type { SnapshotDocument } from "@shared/schemas/history";
import { byUpdatedDesc } from "@shared/schemas/spec";
import { type SelvageState } from "../components/SelvagePanel";
import { copyText } from "../lib/clipboard";
import { ipcErrorMessage } from "../lib/errors";
import type { SpecPersistence } from "./useSpecWorkspace";

export interface SelvageParams {
  persistence: SpecPersistence;
  notify: (message: string) => void;
  activeId: string | null;
  open: boolean;
  docUpdatedAt: string | undefined;
}

export interface SelvageController {
  state: SelvageState;
  busy: boolean;
  reload: () => void;
  take: (label: string | null) => void;
  load: (snapshotId: string) => Promise<SnapshotDocument>;
  restore: (snapshotId: string) => void;
  copy: (snapshotId: string) => void;
  remove: (snapshotId: string) => void;
  togglePin: (snapshotId: string, pinned: boolean) => void;
}

export function useSelvage({ persistence, notify, activeId, open, docUpdatedAt }: SelvageParams): SelvageController {
  const { flushSave, loadedContentRef, pendingSaveRef, docRef, setDoc, setSpecs } = persistence;
  const [state, setState] = useState<SelvageState>({ snapshots: null, error: null });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    setState({ snapshots: null, error: null });
  }, [activeId]);

  const reload = useCallback((): void => {
    const current = docRef.current;
    if (!current) return;
    const specId = current.meta.id;
    window.api.listSnapshots(specId).then(
      (snapshots) => {
        if (docRef.current?.meta.id === specId) setState({ snapshots, error: null });
      },
      (err: unknown) => {
        if (docRef.current?.meta.id === specId) {
          setState((prev) => ({ snapshots: prev.snapshots ?? [], error: ipcErrorMessage(err) }));
        }
      },
    );
  }, [docRef]);

  useEffect(() => {
    if (!open || activeId === null) return;
    reload();
  }, [open, activeId, reload]);

  useEffect(() => {
    if (!open || docUpdatedAt === undefined) return;
    const handle = window.setTimeout(reload, 1200);
    return () => window.clearTimeout(handle);
  }, [open, docUpdatedAt, reload]);

  const take = useCallback(
    (label: string | null): void => {
      const current = docRef.current;
      if (!current) return;
      const specId = current.meta.id;
      window.api.takeSnapshot(specId, current.content, label).then(
        () => {
          notify("いまの版を留めました");
          if (docRef.current?.meta.id === specId) reload();
        },
        (err: unknown) => notify(`留められませんでした: ${ipcErrorMessage(err)}`),
      );
    },
    [docRef, notify, reload],
  );

  const load = useCallback(
    (snapshotId: string): Promise<SnapshotDocument> => {
      const current = docRef.current;
      if (!current) return Promise.reject(new Error("仕様書が開かれていません"));
      return window.api.readSnapshot(current.meta.id, snapshotId);
    },
    [docRef],
  );

  const restore = useCallback(
    (snapshotId: string): void => {
      const current = docRef.current;
      if (!current || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      const specId = current.meta.id;
      void (async () => {
        try {
          if (current.content !== loadedContentRef.current) {
            pendingSaveRef.current = { id: specId, content: current.content };
          }
          const flushed = await flushSave();
          if (!flushed) {
            notify("未保存の変更を書き込めないため、復元を中止しました");
            return;
          }
          if (docRef.current?.meta.id !== specId) return;
          const flushedContent = docRef.current.content;
          const result = await window.api.restoreSnapshot(specId, snapshotId);
          if (docRef.current?.meta.id !== specId) return;
          if (docRef.current.content !== flushedContent) {
            pendingSaveRef.current = { id: specId, content: docRef.current.content };
            void flushSave();
            notify("復元中に編集があったため適用を中止しました。編集内容を保持しています");
            reload();
            return;
          }
          loadedContentRef.current = result.content;
          pendingSaveRef.current = null;
          setDoc((prev) => (prev && prev.meta.id === specId ? { meta: result.meta, content: result.content } : prev));
          setSpecs((prev) => prev.map((spec) => (spec.id === specId ? result.meta : spec)).sort(byUpdatedDesc));
          notify("選んだ版に戻しました。直前の状態も Selvage に残っています");
          reload();
        } catch (err) {
          notify(`復元できませんでした: ${ipcErrorMessage(err)}`);
        } finally {
          busyRef.current = false;
          setBusy(false);
        }
      })();
    },
    [flushSave, reload, notify, docRef, loadedContentRef, pendingSaveRef, setDoc, setSpecs],
  );

  const copy = useCallback(
    (snapshotId: string): void => {
      const current = docRef.current;
      if (!current) return;
      window.api.readSnapshot(current.meta.id, snapshotId).then(
        (snapshot) =>
          void copyText(snapshot.content).then((ok) =>
            notify(ok ? "この版の本文をコピーしました" : "コピーできませんでした"),
          ),
        (err: unknown) => notify(ipcErrorMessage(err)),
      );
    },
    [docRef, notify],
  );

  const remove = useCallback(
    (snapshotId: string): void => {
      const current = docRef.current;
      if (!current) return;
      const specId = current.meta.id;
      window.api.deleteSnapshot(specId, snapshotId).then(
        () => {
          notify("版を削除しました");
          if (docRef.current?.meta.id === specId) reload();
        },
        (err: unknown) => notify(`削除できませんでした: ${ipcErrorMessage(err)}`),
      );
    },
    [docRef, notify, reload],
  );

  const togglePin = useCallback(
    (snapshotId: string, pinned: boolean): void => {
      const current = docRef.current;
      if (!current) return;
      const specId = current.meta.id;
      window.api.setSnapshotPinned(specId, snapshotId, pinned).then(
        (meta) => {
          notify(pinned ? "この版をピン留めしました。上限でも自動削除されません" : "ピン留めを外しました");
          if (docRef.current?.meta.id !== specId) return;
          setState((prev) =>
            prev.snapshots === null
              ? prev
              : { ...prev, snapshots: prev.snapshots.map((item) => (item.id === meta.id ? meta : item)) },
          );
        },
        (err: unknown) => notify(`ピン留めを変更できませんでした: ${ipcErrorMessage(err)}`),
      );
    },
    [docRef, notify],
  );

  return { state, busy, reload, take, load, restore, copy, remove, togglePin };
}
