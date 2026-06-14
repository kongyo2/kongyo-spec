import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorViewMode } from "@shared/schemas/settings";
import type { AutosaveDelay } from "@shared/schemas/settings";
import { byUpdatedDesc, type SpecDocument, type SpecMeta } from "@shared/schemas/spec";
import type { HeadingInfo } from "../components/Preview";
import type { EditorMode } from "../components/Toolbar";
import { safeDecode } from "../lib/dom";
import { errorMessage } from "../lib/errors";
import { computePageHeadingIds } from "../lib/headings";
import { isMarkdownFile, MAX_IMPORT_BYTES, MAX_IMPORT_FILES, MAX_TOTAL_IMPORT_BYTES } from "../lib/import";
import { buildImportPlan, type DroppedFile } from "../lib/importPlan";
import { renderCached } from "../lib/markdown";
import { collectLinkDefinitions, splitPages, type VirtualPage } from "../lib/pages";
import { findPendingDecisions, nextPendingDecision } from "../lib/pending";
import { PLAN_HEADING } from "../lib/tailor";
import { lineStartOffset } from "../lib/text";
import { useAutosave, type PendingSave } from "./useAutosave";

export interface PendingAnchor {
  docId: string;
  id: string;
}

export interface TextRange {
  start: number;
  end: number;
}

export type InsertResult = { kind: "replaced"; count: number } | { kind: "inserted"; fellBack: boolean };

export interface EditingApi {
  docRef: RefObject<SpecDocument | null>;
  selectionRef: RefObject<TextRange | null>;
  modeRef: RefObject<EditorMode>;
  notify: (message: string) => void;
  writeContent: (next: string) => void;
  ensureEditable: () => void;
  setJump: (range: TextRange | null) => void;
  guard: (label: string) => void;
  grabSelection: () => string | null;
  insertComposed: (text: string, rawTargets: string[]) => InsertResult | null;
  revealOffset: (start: number, end: number) => void;
  revealExcerpt: (excerpt: string) => void;
}

export interface SpecPersistence {
  flushSave: () => Promise<boolean>;
  loadedContentRef: RefObject<string>;
  pendingSaveRef: RefObject<PendingSave | null>;
  docRef: RefObject<SpecDocument | null>;
  setDoc: React.Dispatch<React.SetStateAction<SpecDocument | null>>;
  setSpecs: React.Dispatch<React.SetStateAction<SpecMeta[]>>;
}

export interface SpecWorkspaceParams {
  notify: (message: string) => void;
  autosaveDelay: AutosaveDelay;
  defaultViewMode: EditorViewMode;
  restoreLastSpec: boolean;
  lastActiveSpecId: string | null;
  closeDialog: () => void;
}

export interface SpecWorkspace {
  specs: SpecMeta[];
  activeId: string | null;
  doc: SpecDocument | null;
  saving: boolean;
  mode: EditorMode;
  setMode: React.Dispatch<React.SetStateAction<EditorMode>>;
  pageIndex: number;
  pages: VirtualPage[];
  pageHeadingIds: string[][];
  fullHeadingIds: string[];
  linkDefs: string;
  activePage: VirtualPage | undefined;
  pendingAnchor: PendingAnchor | null;
  clearAnchor: () => void;
  editorJump: TextRange | null;
  clearJump: () => void;
  headings: HeadingInfo[];
  setHeadings: (headings: HeadingInfo[]) => void;
  activeHeadingId: string | null;
  setActiveHeadingId: (id: string | null) => void;
  previewSyncRef: RefObject<((ratio: number) => void) | null>;
  pendingCount: number;
  planInDoc: boolean;
  setContent: (next: string) => void;
  goToPage: (index: number) => void;
  handleEditorSelection: (start: number, end: number) => void;
  handleEditorScrollRatio: (ratio: number) => void;
  handleLinkActivate: (href: string) => void;
  jumpToPending: () => void;
  openSpec: (id: string) => Promise<boolean>;
  createSpec: (title: string) => void;
  renameSpec: (id: string, title: string) => void;
  deleteSpec: (id: string) => void;
  importFiles: (files: File[]) => void;
  editing: EditingApi;
  persistence: SpecPersistence;
}

function spliceOut(text: string, range: TextRange): string {
  const blockish =
    (range.start === 0 || text[range.start - 1] === "\n") && (range.end >= text.length || text[range.end] === "\n");
  if (!blockish) return text.slice(0, range.start) + text.slice(range.end);
  const before = text.slice(0, range.start).replace(/\n+$/, "");
  const after = text.slice(range.end).replace(/^\n+/, "");
  if (before.length === 0) return after;
  if (after.length === 0) return `${before}\n`;
  return `${before}\n\n${after}`;
}

export function useSpecWorkspace({
  notify,
  autosaveDelay,
  defaultViewMode,
  restoreLastSpec,
  lastActiveSpecId,
  closeDialog,
}: SpecWorkspaceParams): SpecWorkspace {
  const [specs, setSpecs] = useState<SpecMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [doc, setDoc] = useState<SpecDocument | null>(null);
  const [mode, setMode] = useState<EditorMode>("preview");
  const [pageIndex, setPageIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [headings, setHeadings] = useState<HeadingInfo[]>([]);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [pendingAnchor, setPendingAnchor] = useState<PendingAnchor | null>(null);
  const [editorJump, setEditorJump] = useState<TextRange | null>(null);

  const docRef = useRef<SpecDocument | null>(null);
  docRef.current = doc;
  const specsRef = useRef<SpecMeta[]>([]);
  specsRef.current = specs;
  const modeRef = useRef<EditorMode>("preview");
  modeRef.current = mode;
  const selectionRef = useRef<TextRange | null>(null);
  const defaultViewModeRef = useRef(defaultViewMode);
  defaultViewModeRef.current = defaultViewMode;

  const openRequestRef = useRef(0);
  const pendingOpenIdRef = useRef<string | null>(null);
  const deletingIdsRef = useRef<Set<string>>(new Set());
  const createIntentRef = useRef(0);
  const importIntentRef = useRef(0);
  const previewSyncRef = useRef<((ratio: number) => void) | null>(null);

  const { flushSave, loadedContentRef, pendingSaveRef } = useAutosave({
    doc,
    docRef,
    setDoc,
    setSpecs,
    setSaving,
    notify,
    autosaveDelay,
  });

  const pages = useMemo(() => splitPages(doc?.content ?? ""), [doc?.content]);
  const pageHeadingIds = useMemo(() => computePageHeadingIds(pages.map((page) => page.content)), [pages]);
  const fullHeadingIds = useMemo(() => pageHeadingIds.flat(), [pageHeadingIds]);
  const linkDefs = useMemo(() => collectLinkDefinitions(doc?.content ?? ""), [doc?.content]);
  const activePage = pages[pageIndex] ?? pages[0];

  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const pageIndexRef = useRef(pageIndex);
  pageIndexRef.current = pageIndex;
  const pageHeadingIdsRef = useRef(pageHeadingIds);
  pageHeadingIdsRef.current = pageHeadingIds;

  const pendingCount = useMemo(() => findPendingDecisions(doc?.content ?? "").length, [doc?.content]);
  const planInDoc = useMemo(() => pages.some((page) => page.depth === 2 && page.title === PLAN_HEADING), [pages]);

  const openSpec = useCallback(
    async (id: string): Promise<boolean> => {
      const token = (openRequestRef.current += 1);
      pendingOpenIdRef.current = id;
      try {
        const flushed = await flushSave();
        if (!flushed) return false;
        if (token !== openRequestRef.current) return false;
        let document: SpecDocument;
        try {
          document = await window.api.readSpec(id);
        } catch (err) {
          notify(`仕様書の読み込みに失敗しました: ${errorMessage(err)}`);
          return false;
        }
        if (token !== openRequestRef.current) return false;
        const current = docRef.current;
        if (current && current.content !== loadedContentRef.current) {
          pendingSaveRef.current = { id: current.meta.id, content: current.content };
          if (!(await flushSave())) return false;
          if (token !== openRequestRef.current) return false;
        }
        if (deletingIdsRef.current.has(id)) return false;
        const reconciledMeta = specsRef.current.find((spec) => spec.id === id) ?? document.meta;
        loadedContentRef.current = document.content;
        setActiveId(id);
        setDoc({ meta: reconciledMeta, content: document.content });
        setPageIndex(0);
        setMode(defaultViewModeRef.current);
        setActiveHeadingId(null);
        setPendingAnchor(null);
        return true;
      } finally {
        if (openRequestRef.current === token) pendingOpenIdRef.current = null;
      }
    },
    [flushSave, notify, loadedContentRef, pendingSaveRef],
  );

  useEffect(() => {
    void (async () => {
      try {
        const list = await window.api.listSpecs();
        setSpecs((prev) => {
          const known = new Set(list.map((spec) => spec.id));
          const extras = prev.filter((spec) => !known.has(spec.id));
          return [...extras, ...list].sort(byUpdatedDesc);
        });
        const preferred = restoreLastSpec ? lastActiveSpecId : null;
        const target = (preferred !== null ? list.find((spec) => spec.id === preferred) : undefined) ?? list[0];
        if (target && docRef.current === null && pendingOpenIdRef.current === null) await openSpec(target.id);
      } catch (err) {
        notify(`仕様書の読み込みに失敗しました: ${errorMessage(err)}`);
      }
    })();
  }, [openSpec, notify, restoreLastSpec, lastActiveSpecId]);

  useEffect(() => {
    if (activeId === null) return;
    void window.api.setSetting("lastActiveSpecId", activeId).catch(() => undefined);
  }, [activeId]);

  useEffect(() => {
    selectionRef.current = null;
    setEditorJump(null);
  }, [activeId]);

  useEffect(() => {
    if (pageIndex > pages.length - 1) setPageIndex(Math.max(0, pages.length - 1));
  }, [pages, pageIndex]);

  useEffect(() => {
    if (!pendingAnchor || !doc || doc.meta.id !== pendingAnchor.docId) return;
    let cancelled = false;
    void (async () => {
      for (let i = 0; i < pages.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        const html = await renderCached(linkDefs + (pages[i]?.content ?? ""), pageHeadingIds[i] ?? []);
        if (cancelled) return;
        const parsed = new DOMParser().parseFromString(html, "text/html");
        if (parsed.getElementById(pendingAnchor.id)) {
          setPageIndex(i);
          return;
        }
      }
      if (!cancelled) setPendingAnchor(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [pendingAnchor, pages, doc, pageHeadingIds, linkDefs]);

  const writeContent = useCallback((next: string): void => {
    const current = docRef.current;
    if (!current) return;
    setDoc((prev) => (prev && prev.meta.id === current.meta.id ? { ...prev, content: next } : prev));
  }, []);

  const setContent = useCallback((next: string): void => {
    setDoc((prev) => (prev ? { ...prev, content: next } : prev));
  }, []);

  const ensureEditable = useCallback((): void => {
    if (modeRef.current === "preview") setMode("source");
  }, []);

  const setJump = useCallback((range: TextRange | null): void => {
    setEditorJump(range);
  }, []);

  const clearJump = useCallback((): void => setEditorJump(null), []);
  const clearAnchor = useCallback((): void => setPendingAnchor(null), []);

  const guard = useCallback((label: string): void => {
    const current = docRef.current;
    if (!current || current.content.trim().length === 0) return;
    void window.api.takeSnapshot(current.meta.id, current.content, label, "assist").catch(() => undefined);
  }, []);

  const grabSelection = useCallback((): string | null => {
    const current = docRef.current;
    if (!current) return null;
    if (modeRef.current === "preview") {
      notify("Source / Split モードで取り込みたい範囲を選択してください");
      return null;
    }
    const selection = selectionRef.current;
    if (!selection || selection.start === selection.end) {
      notify("選択範囲がありません。エディタで範囲を選択してください");
      return null;
    }
    return current.content.slice(selection.start, selection.end);
  }, [notify]);

  const insertComposed = useCallback((text: string, rawTargets: string[]): InsertResult | null => {
    const current = docRef.current;
    if (!current || text.length === 0) return null;
    const content = current.content;
    const livePages = pagesRef.current;
    const livePageIndex = pageIndexRef.current;
    let fellBack = false;
    let replaceRanges: TextRange[] | null = null;
    const targets = rawTargets.filter((target) => target.length > 0);
    if (targets.length > 0) {
      const resolved: TextRange[] = [];
      let unique = true;
      for (const target of targets) {
        const first = content.indexOf(target);
        if (first === -1 || content.indexOf(target, first + 1) !== -1) {
          unique = false;
          break;
        }
        resolved.push({ start: first, end: first + target.length });
      }
      if (unique) {
        resolved.sort((a, b) => a.start - b.start);
        for (let i = 1; i < resolved.length && unique; i++) {
          if (resolved[i]!.start < resolved[i - 1]!.end) unique = false;
        }
      }
      if (unique) replaceRanges = resolved;
      else fellBack = true;
    }
    let next: string;
    let jumpStart: number;
    if (replaceRanges) {
      const primary = replaceRanges[0]!;
      next = content;
      for (let i = replaceRanges.length - 1; i >= 1; i--) {
        next = spliceOut(next, replaceRanges[i]!);
      }
      next = next.slice(0, primary.start) + text + next.slice(primary.end);
      jumpStart = primary.start;
    } else {
      const nextPage = livePages[livePageIndex + 1];
      const caret =
        modeRef.current !== "preview"
          ? (selectionRef.current?.end ?? content.length)
          : nextPage
            ? lineStartOffset(content, nextPage.startLine)
            : content.length;
      const before = content.slice(0, caret);
      const after = content.slice(caret);
      const lead = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
      const trail = after.length === 0 ? "\n" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
      next = before + lead + text + trail + after;
      jumpStart = caret + lead.length;
    }
    setDoc((prev) => (prev && prev.meta.id === current.meta.id ? { ...prev, content: next } : prev));
    if (modeRef.current === "preview") setMode("source");
    setEditorJump({ start: jumpStart, end: jumpStart + text.length });
    return replaceRanges ? { kind: "replaced", count: replaceRanges.length } : { kind: "inserted", fellBack };
  }, []);

  const revealOffset = useCallback((start: number, end: number): void => {
    const current = docRef.current;
    if (!current) return;
    const livePages = pagesRef.current;
    const bounded = Math.min(start, current.content.length);
    const lineIndex = current.content.slice(0, bounded).split("\n").length - 1;
    let targetPage = 0;
    for (let i = 0; i < livePages.length; i++) {
      if (livePages[i]!.startLine <= lineIndex) targetPage = i;
      else break;
    }
    setPageIndex(targetPage);
    if (modeRef.current === "preview") setMode("source");
    setEditorJump({ start: bounded, end: Math.min(end, current.content.length) });
  }, []);

  const revealExcerpt = useCallback(
    (excerpt: string): void => {
      const current = docRef.current;
      if (!current || excerpt.length === 0) return;
      const start = current.content.indexOf(excerpt);
      if (start === -1) {
        notify("該当箇所が見つかりません。本文が変更された可能性があります。");
        return;
      }
      if (current.content.indexOf(excerpt, start + 1) !== -1) {
        notify("同じ記述が複数あるため移動先を特定できません。");
        return;
      }
      const probe = excerpt.trim();
      const livePages = pagesRef.current;
      const targetPage = probe.length > 0 ? livePages.findIndex((page) => page.content.includes(probe)) : -1;
      if (targetPage !== -1) setPageIndex(targetPage);
      if (modeRef.current === "preview") setMode("source");
      setEditorJump({ start, end: start + excerpt.length });
    },
    [notify],
  );

  const goToPage = useCallback((index: number): void => {
    const livePages = pagesRef.current;
    const bounded = Math.max(0, Math.min(index, livePages.length - 1));
    setPageIndex(bounded);
    const current = docRef.current;
    if (!current || modeRef.current === "preview") return;
    const page = livePages[bounded];
    if (!page) return;
    const offset = lineStartOffset(current.content, page.startLine);
    setEditorJump({ start: offset, end: offset });
    if (modeRef.current === "split") {
      const anchor = pageHeadingIdsRef.current[bounded]?.[0];
      if (anchor !== undefined) setPendingAnchor({ docId: current.meta.id, id: anchor });
      else previewSyncRef.current?.(0);
    }
  }, []);

  const handleEditorSelection = useCallback((start: number, end: number): void => {
    selectionRef.current = { start, end };
    if (modeRef.current === "preview") return;
    const current = docRef.current;
    if (!current) return;
    const livePages = pagesRef.current;
    const bounded = Math.min(start, current.content.length);
    let line = 0;
    for (let i = 0; i < bounded; i++) {
      if (current.content.charCodeAt(i) === 10) line += 1;
    }
    let target = 0;
    for (let i = 0; i < livePages.length; i++) {
      if (livePages[i]!.startLine <= line) target = i;
      else break;
    }
    setPageIndex((prev) => (prev === target ? prev : target));
  }, []);

  const handleEditorScrollRatio = useCallback((ratio: number): void => {
    previewSyncRef.current?.(ratio);
  }, []);

  const jumpToPending = useCallback((): void => {
    const current = docRef.current;
    if (!current) return;
    const ranges = findPendingDecisions(current.content);
    const target = nextPendingDecision(ranges, selectionRef.current?.end ?? 0);
    if (!target) return;
    if (modeRef.current === "preview") setMode("source");
    setEditorJump({ start: target.start, end: target.end });
  }, []);

  const handleLinkActivate = useCallback(
    (href: string): void => {
      const reportLaunchFailure = (err: unknown): void => {
        notify(`リンクを開けませんでした: ${errorMessage(err)}`);
      };
      if (href.startsWith("//")) {
        void window.api.openExternal(`https:${href}`).catch(reportLaunchFailure);
        return;
      }
      if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) {
        void window.api.openExternal(href).catch(reportLaunchFailure);
        return;
      }
      const hashIndex = href.indexOf("#");
      const beforeHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
      const fragment = hashIndex >= 0 ? safeDecode(href.slice(hashIndex + 1)) : null;
      const queryIndex = beforeHash.indexOf("?");
      const pathname = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;

      if (pathname.length === 0) {
        if (fragment && doc) setPendingAnchor({ docId: doc.meta.id, id: fragment });
        return;
      }

      const fileName = safeDecode(pathname).replace(/^\.\//, "").replace(/\/+$/, "");
      const targetId = fileName.replace(/\.md$/i, "");
      const target = specs.find((spec) => spec.id === targetId);
      if (!target) {
        notify(`リンク先が見つかりません: ${href}`);
        return;
      }
      void openSpec(target.id).then((opened) => {
        if (opened && fragment) setPendingAnchor({ docId: target.id, id: fragment });
      });
    },
    [doc, specs, openSpec, notify],
  );

  const createSpec = useCallback(
    (title: string): void => {
      const navToken = openRequestRef.current;
      const intent = (createIntentRef.current += 1);
      void (async () => {
        try {
          const meta = await window.api.createSpec(title);
          setSpecs((prev) => [meta, ...prev]);
          if (createIntentRef.current !== intent) return;
          if (openRequestRef.current !== navToken) return;
          const opened = await openSpec(meta.id);
          if (opened) setMode("source");
        } catch (err) {
          notify(`作成に失敗しました: ${errorMessage(err)}`);
        }
      })();
    },
    [openSpec, notify],
  );

  const renameSpec = useCallback(
    (id: string, title: string): void => {
      void (async () => {
        try {
          const meta = await window.api.renameSpec(id, title);
          setSpecs((prev) => prev.map((spec) => (spec.id === id ? meta : spec)).sort(byUpdatedDesc));
          setDoc((prev) => (prev && prev.meta.id === id ? { ...prev, meta } : prev));
        } catch (err) {
          notify(`変更に失敗しました: ${errorMessage(err)}`);
        }
      })();
    },
    [notify],
  );

  const deleteSpec = useCallback(
    (id: string): void => {
      void (async () => {
        deletingIdsRef.current.add(id);
        try {
          if (docRef.current?.meta.id === id) pendingSaveRef.current = null;
          await flushSave();
          if (pendingOpenIdRef.current === id) openRequestRef.current += 1;
          await window.api.deleteSpec(id);
          closeDialog();
          setSpecs((prev) => prev.filter((spec) => spec.id !== id));
          if (docRef.current?.meta.id === id) {
            const fallback = specsRef.current.find((spec) => spec.id !== id);
            if (fallback) {
              await openSpec(fallback.id);
            } else {
              setDoc(null);
              setActiveId(null);
              loadedContentRef.current = "";
            }
          }
        } catch (err) {
          notify(`削除に失敗しました: ${errorMessage(err)}`);
          const current = docRef.current;
          if (current && current.content !== loadedContentRef.current) {
            pendingSaveRef.current = { id: current.meta.id, content: current.content };
            void flushSave();
          }
        } finally {
          deletingIdsRef.current.delete(id);
        }
      })();
    },
    [flushSave, openSpec, notify, closeDialog, loadedContentRef, pendingSaveRef],
  );

  const importFiles = useCallback(
    (files: File[]): void => {
      const markdownFiles = files.filter(isMarkdownFile);
      if (markdownFiles.length === 0) {
        notify("Markdown（.md）ファイルのみ読み込めます");
        return;
      }
      const skipped = files.length - markdownFiles.length;
      const intent = (importIntentRef.current += 1);
      const navToken = openRequestRef.current;
      void (async () => {
        const notes: string[] = [];
        const dropped: DroppedFile[] = [];
        let totalBytes = 0;
        let capped = false;
        for (const file of markdownFiles) {
          if (file.size > MAX_IMPORT_BYTES) {
            notes.push(`「${file.name}」は大きすぎます`);
            continue;
          }
          if (dropped.length >= MAX_IMPORT_FILES || totalBytes + file.size > MAX_TOTAL_IMPORT_BYTES) {
            capped = true;
            break;
          }
          try {
            // eslint-disable-next-line no-await-in-loop
            const content = await file.text();
            totalBytes += file.size;
            dropped.push({ name: file.name, path: window.api.getFilePath(file), content });
          } catch (err) {
            notes.push(`「${file.name}」を読み込めません: ${errorMessage(err)}`);
          }
        }
        if (capped) notes.push("一度に取り込める上限を超えたため一部のみ取り込みました");
        let metas: SpecMeta[] = [];
        let strippedMeta = false;
        if (dropped.length > 0) {
          try {
            const plan = buildImportPlan(dropped);
            strippedMeta = plan.strippedMeta;
            if (plan.assetsCapped) notes.push("画像が多すぎるため一部のアセットは取り込まれません");
            const result = await window.api.importSpecs({ specs: plan.specs, assets: plan.assets });
            metas = result.metas;
            if (result.skippedAssets > 0) notes.push(`${result.skippedAssets} 件のアセットを取り込めません`);
            const failed = plan.specs.length - metas.length;
            if (failed > 0) notes.push(`${failed} 件の取り込みに失敗しました`);
          } catch (err) {
            notes.push(`読み込みに失敗しました: ${errorMessage(err)}`);
          }
        }
        if (metas.length > 0) setSpecs((prev) => [...metas, ...prev].sort(byUpdatedDesc));
        if (skipped > 0) notes.push(`Markdown 以外の ${skipped} 件をスキップ`);
        if (strippedMeta) notes.push("一部のフロントマターは取り込まれません");
        if (notes.length > 0) notify(notes.join(" ／ "));
        const last = metas[metas.length - 1];
        if (last && importIntentRef.current === intent && openRequestRef.current === navToken) await openSpec(last.id);
      })();
    },
    [openSpec, notify],
  );

  const editing = useMemo<EditingApi>(
    () => ({
      docRef,
      selectionRef,
      modeRef,
      notify,
      writeContent,
      ensureEditable,
      setJump,
      guard,
      grabSelection,
      insertComposed,
      revealOffset,
      revealExcerpt,
    }),
    [notify, writeContent, ensureEditable, setJump, guard, grabSelection, insertComposed, revealOffset, revealExcerpt],
  );

  const persistence = useMemo<SpecPersistence>(
    () => ({ flushSave, loadedContentRef, pendingSaveRef, docRef, setDoc, setSpecs }),
    [flushSave, loadedContentRef, pendingSaveRef],
  );

  return {
    specs,
    activeId,
    doc,
    saving,
    mode,
    setMode,
    pageIndex,
    pages,
    pageHeadingIds,
    fullHeadingIds,
    linkDefs,
    activePage,
    pendingAnchor,
    clearAnchor,
    editorJump,
    clearJump,
    headings,
    setHeadings,
    activeHeadingId,
    setActiveHeadingId,
    previewSyncRef,
    pendingCount,
    planInDoc,
    setContent,
    goToPage,
    handleEditorSelection,
    handleEditorScrollRatio,
    handleLinkActivate,
    jumpToPending,
    openSpec,
    createSpec,
    renameSpec,
    deleteSpec,
    importFiles,
    editing,
    persistence,
  };
}
