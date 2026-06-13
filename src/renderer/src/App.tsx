import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Plus } from "lucide-react";
import {
  AUTOSAVE_DELAY_MS,
  type AutosaveDelay,
  DEFAULT_SETTINGS,
  type EditorViewMode,
  type FrayKinds,
  llmProfileDisplayName,
  rendererLlmRouting,
  SPLIT_RATIO,
  TOAST_DURATION_MS,
  type MermaidRenderer,
  type RendererSettings,
  type ToastDuration,
  type UpsertLlmProfileInput,
} from "@shared/schemas/settings";
import { byUpdatedDesc, type SpecDocument, type SpecMeta } from "@shared/schemas/spec";
import {
  MAX_WARP_MATERIAL_CHARS,
  MAX_WEAVE_CONTEXT_CHARS,
  MAX_WEAVE_MATERIAL_CHARS,
  MAX_WEAVE_WOVEN_CHARS,
  type WeaveQa,
} from "@shared/schemas/assist";
import type { SnapshotDocument } from "@shared/schemas/history";
import { Dialog, type DialogState } from "./components/Dialog";
import { DropOverlay } from "./components/DropOverlay";
import { Editor } from "./components/Editor";
import { FrayPanel, type AuditState } from "./components/FrayPanel";
import { LensPanel, type LensState } from "./components/LensPanel";
import { INITIAL_LOOM_SESSION, LoomPanel, type LoomSession, type WeaveKind } from "./components/LoomPanel";
import { Outline } from "./components/Outline";
import { PagesNav } from "./components/PagesNav";
import { Preview, type HeadingInfo } from "./components/Preview";
import { SearchBar } from "./components/SearchBar";
import { SelvagePanel, type SelvageState } from "./components/SelvagePanel";
import { Settings as SettingsScreen, type LlmSettings, type SettingChange } from "./components/Settings";
import { SpecsSidebar } from "./components/SpecsSidebar";
import { TailorPanel, type TailorState } from "./components/TailorPanel";
import { Toolbar, type EditorMode } from "./components/Toolbar";
import { INITIAL_WARP_SESSION, WarpPanel, type WarpSession } from "./components/WarpPanel";
import { applyAppearance, type AppearanceSettings } from "./lib/appearance";
import { copyText } from "./lib/clipboard";
import { safeDecode } from "./lib/dom";
import { errorMessage, ipcErrorMessage } from "./lib/errors";
import { detectFray, type FrayIssue } from "./lib/fray";
import { computePageHeadingIds } from "./lib/headings";
import { isMarkdownFile, MAX_IMPORT_BYTES, MAX_IMPORT_FILES, MAX_TOTAL_IMPORT_BYTES } from "./lib/import";
import { buildImportPlan, type DroppedFile } from "./lib/importPlan";
import { renderCached } from "./lib/markdown";
import { collectLinkDefinitions, splitPages } from "./lib/pages";
import { findPendingDecisions, nextPendingDecision } from "./lib/pending";
import { buildGlobalMatches, type GlobalMatch } from "./lib/search";
import { buildHandoffPrompt, mergePlanIntoContent, PLAN_HEADING, tailorPlanToMarkdown } from "./lib/tailor";
import { lineStartOffset } from "./lib/text";
import {
  applyTheme,
  clearLegacyTheme,
  nextPreference,
  resolveTheme,
  systemTheme,
  type ResolvedTheme,
  type ThemePreference,
} from "./lib/theme";
import { useFileDrop } from "./lib/useFileDrop";

interface SearchUiState {
  open: boolean;
  query: string;
}

interface PendingAnchor {
  docId: string;
  id: string;
}

interface AppProps {
  initialSettings: RendererSettings;
}

const modKey = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl ";

function spliceOut(text: string, range: { start: number; end: number }): string {
  const blockish =
    (range.start === 0 || text[range.start - 1] === "\n") && (range.end >= text.length || text[range.end] === "\n");
  if (!blockish) return text.slice(0, range.start) + text.slice(range.end);
  const before = text.slice(0, range.start).replace(/\n+$/, "");
  const after = text.slice(range.end).replace(/^\n+/, "");
  if (before.length === 0) return after;
  if (after.length === 0) return `${before}\n`;
  return `${before}\n\n${after}`;
}

export function App({ initialSettings }: AppProps): React.ReactElement {
  const [specs, setSpecs] = useState<SpecMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [doc, setDoc] = useState<SpecDocument | null>(null);
  const [mode, setMode] = useState<EditorMode>("preview");
  const [pageIndex, setPageIndex] = useState(0);
  const [saving, setSaving] = useState(false);

  const [headings, setHeadings] = useState<HeadingInfo[]>([]);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);

  const [search, setSearch] = useState<SearchUiState>({ open: false, query: "" });
  const [matches, setMatches] = useState<GlobalMatch[]>([]);
  const [matchCursor, setMatchCursor] = useState(0);

  const [pendingAnchor, setPendingAnchor] = useState<PendingAnchor | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [themePreference, setThemePreference] = useState<ThemePreference>(initialSettings.theme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(initialSettings.theme));
  const [appearance, setAppearance] = useState<AppearanceSettings>(() => ({
    accent: initialSettings.accent,
    editorFontSize: initialSettings.editorFontSize,
    previewFontSize: initialSettings.previewFontSize,
    editorLineHeight: initialSettings.editorLineHeight,
    previewLineHeight: initialSettings.previewLineHeight,
    readingWidth: initialSettings.readingWidth,
  }));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [defaultViewMode, setDefaultViewMode] = useState<EditorViewMode>(initialSettings.defaultViewMode);
  const defaultViewModeRef = useRef(defaultViewMode);
  defaultViewModeRef.current = defaultViewMode;
  const [splitRatio, setSplitRatio] = useState(initialSettings.splitRatio);
  const splitRatioRef = useRef(splitRatio);
  splitRatioRef.current = splitRatio;
  const [autosaveDelay, setAutosaveDelay] = useState<AutosaveDelay>(initialSettings.autosaveDelay);
  const [toastDuration, setToastDuration] = useState<ToastDuration>(initialSettings.toastDuration);
  const [restoreLastSpec, setRestoreLastSpec] = useState(initialSettings.restoreLastSpec);
  const [frayAutoCheck, setFrayAutoCheck] = useState(initialSettings.frayAutoCheck);
  const [frayKinds, setFrayKinds] = useState<FrayKinds>(initialSettings.frayKinds);
  // main プロセス側で読まれる設定 (履歴・AI タイムアウト)。renderer は表示と書き込みのみ担う
  const [autoSnapshotMinutes, setAutoSnapshotMinutes] = useState(initialSettings.autoSnapshotMinutes);
  const [maxSnapshotsPerSpec, setMaxSnapshotsPerSpec] = useState(initialSettings.maxSnapshotsPerSpec);
  const [assistTimeoutSec, setAssistTimeoutSec] = useState(initialSettings.assistTimeoutSec);

  const [lensOpen, setLensOpen] = useState(false);
  const [lens, setLens] = useState<LensState>({ status: "idle" });

  const [frayOpen, setFrayOpen] = useState(false);
  const [audit, setAudit] = useState<AuditState>({ status: "idle" });
  const auditTokenRef = useRef(0);
  const auditRunningRef = useRef(false);
  const [tailorOpen, setTailorOpen] = useState(false);
  const [tailor, setTailor] = useState<TailorState>({ status: "idle" });
  const tailorRef = useRef(tailor);
  tailorRef.current = tailor;
  const tailorTokenRef = useRef(0);
  const tailorRunningRef = useRef(false);
  const [selvageOpen, setSelvageOpen] = useState(false);
  const [selvage, setSelvage] = useState<SelvageState>({ snapshots: null, error: null });
  const [selvageBusy, setSelvageBusy] = useState(false);
  const selvageBusyRef = useRef(false);
  const [editorJump, setEditorJump] = useState<{ start: number; end: number } | null>(null);
  const [aiKeySet, setAiKeySet] = useState(initialSettings.geminiApiKeySet);
  const [mermaidRenderer, setMermaidRenderer] = useState<MermaidRenderer>(initialSettings.mermaidRenderer);
  const [llm, setLlm] = useState(() => ({
    llmProfiles: initialSettings.llmProfiles,
    llmMainProfileId: initialSettings.llmMainProfileId,
    llmFallbackProfileIds: initialSettings.llmFallbackProfileIds,
    geminiModel: initialSettings.geminiModel,
  }));
  const lensTokenRef = useRef(0);
  const lensRunningRef = useRef(false);

  const [loomOpen, setLoomOpen] = useState(false);
  const [loomSession, setLoomSession] = useState<LoomSession>(INITIAL_LOOM_SESSION);
  const loomSessionRef = useRef(loomSession);
  loomSessionRef.current = loomSession;
  const loomTokenRef = useRef(0);
  const loomRunningRef = useRef(false);
  const lastWeaveKindRef = useRef<WeaveKind>("compose");
  const [warpOpen, setWarpOpen] = useState(false);
  const [warpSession, setWarpSession] = useState<WarpSession>(INITIAL_WARP_SESSION);
  const warpSessionRef = useRef(warpSession);
  warpSessionRef.current = warpSession;
  const warpTokenRef = useRef(0);
  const warpRunningRef = useRef(false);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);
  const modeRef = useRef<EditorMode>("preview");
  modeRef.current = mode;

  const loadedContentRef = useRef("");
  const pendingSaveRef = useRef<{ id: string; content: string } | null>(null);
  const openRequestRef = useRef(0);
  const pendingOpenIdRef = useRef<string | null>(null);
  const flushPromiseRef = useRef<Promise<boolean> | null>(null);
  const flushSaveRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true));
  const retryTimerRef = useRef<number | null>(null);
  const saveFailedRef = useRef(false);
  const docRef = useRef<SpecDocument | null>(null);
  docRef.current = doc;
  const specsRef = useRef<SpecMeta[]>([]);
  specsRef.current = specs;
  const deletingIdsRef = useRef<Set<string>>(new Set());
  const createIntentRef = useRef(0);
  const importIntentRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const pages = useMemo(() => splitPages(doc?.content ?? ""), [doc?.content]);
  const pageHeadingIds = useMemo(() => computePageHeadingIds(pages.map((page) => page.content)), [pages]);
  // 全ページを通しで採番しているため、平坦化すると全文レンダリング時の ID 列になる
  const fullHeadingIds = useMemo(() => pageHeadingIds.flat(), [pageHeadingIds]);
  const linkDefs = useMemo(() => collectLinkDefinitions(doc?.content ?? ""), [doc?.content]);
  const activePage = pages[pageIndex] ?? pages[0];

  const llmRouting = useMemo(() => rendererLlmRouting(llm), [llm]);
  const mainModelLabel = llmProfileDisplayName(llmRouting.main);
  const aiReady = [llmRouting.main, ...llmRouting.fallbacks].some(
    (profile) => profile.provider !== "gemini" || profile.apiKeySet || aiKeySet,
  );

  const applyLlmSettings = useCallback((settings: RendererSettings): void => {
    setLlm({
      llmProfiles: settings.llmProfiles,
      llmMainProfileId: settings.llmMainProfileId,
      llmFallbackProfileIds: settings.llmFallbackProfileIds,
      geminiModel: settings.geminiModel,
    });
    setAiKeySet(settings.geminiApiKeySet);
  }, []);

  useEffect(() => {
    const resolved = resolveTheme(themePreference);
    setResolvedTheme(resolved);
    applyTheme(resolved);
    void window.api
      .setSetting("theme", themePreference)
      .then((persisted) => {
        if (persisted) clearLegacyTheme();
      })
      .catch(() => undefined);
    if (themePreference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (): void => {
      const next = systemTheme();
      setResolvedTheme(next);
      applyTheme(next);
    };
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [themePreference]);

  useEffect(() => {
    applyAppearance(appearance, resolvedTheme);
  }, [appearance, resolvedTheme]);

  useEffect(() => {
    if (activeId === null) return;
    void window.api.setSetting("lastActiveSpecId", activeId).catch(() => undefined);
  }, [activeId]);

  useEffect(() => {
    lensTokenRef.current += 1;
    setLens((prev) => (prev.status === "running" ? prev : { status: "idle" }));
    loomTokenRef.current += 1;
    setLoomSession(INITIAL_LOOM_SESSION);
    warpTokenRef.current += 1;
    setWarpSession(INITIAL_WARP_SESSION);
    auditTokenRef.current += 1;
    setAudit((prev) => (prev.status === "running" ? prev : { status: "idle" }));
    tailorTokenRef.current += 1;
    setTailor((prev) => (prev.status === "running" ? prev : { status: "idle" }));
    setSelvage({ snapshots: null, error: null });
    selectionRef.current = null;
    setEditorJump(null);
  }, [activeId]);

  const flushSave = useCallback((): Promise<boolean> => {
    if (flushPromiseRef.current) return flushPromiseRef.current;
    const run = (async (): Promise<boolean> => {
      while (pendingSaveRef.current) {
        const pending = pendingSaveRef.current;
        try {
          // eslint-disable-next-line no-await-in-loop -- drains a serialized save queue in order
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
            setToast(`保存に失敗しました: ${errorMessage(err)}`);
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
    // 空キューでは run の本体が await に当たらず同期完了する。async 関数内の
    // finally で参照を消すと、直後の登録が完了済み Promise を残して以後の保存を
    // 全て飲み込むため、解放は登録後に繋いだ .finally(非同期実行)で行う。
    const tracked = run.finally(() => {
      if (flushPromiseRef.current === tracked) flushPromiseRef.current = null;
      setSaving(false);
    });
    flushPromiseRef.current = tracked;
    return tracked;
  }, []);
  flushSaveRef.current = flushSave;

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
          setToast(`仕様書の読み込みに失敗しました: ${errorMessage(err)}`);
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
    [flushSave],
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
        // 「前回の続きから」が無効なら最後に開いていた仕様書ではなく最新更新を開く
        const preferred = initialSettings.restoreLastSpec ? initialSettings.lastActiveSpecId : null;
        const target = (preferred !== null ? list.find((spec) => spec.id === preferred) : undefined) ?? list[0];
        if (target && docRef.current === null && pendingOpenIdRef.current === null) await openSpec(target.id);
      } catch (err) {
        setToast(`仕様書の読み込みに失敗しました: ${errorMessage(err)}`);
      }
    })();
  }, [openSpec]);

  useEffect(() => {
    if (pageIndex > pages.length - 1) setPageIndex(Math.max(0, pages.length - 1));
  }, [pages, pageIndex]);

  useEffect(() => {
    if (toast === null) return;
    const handle = window.setTimeout(() => setToast(null), TOAST_DURATION_MS[toastDuration]);
    return () => window.clearTimeout(handle);
  }, [toast, toastDuration]);

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
  }, [doc, flushSave, autosaveDelay]);

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
  }, [flushSave]);

  useEffect(() => {
    if (!search.open || search.query.length === 0) {
      setMatches([]);
      setMatchCursor(0);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void (async () => {
        const htmls = await Promise.all(
          pages.map((page, index) => renderCached(linkDefs + page.content, pageHeadingIds[index] ?? [])),
        );
        if (cancelled) return;
        const found = buildGlobalMatches(htmls, search.query);
        setMatches(found);
        setMatchCursor(0);
        const first = found[0];
        if (first) setPageIndex(first.pageIndex);
      })();
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [search.open, search.query, pages, pageHeadingIds, linkDefs]);

  useEffect(() => {
    if (!pendingAnchor || !doc || doc.meta.id !== pendingAnchor.docId) return;
    let cancelled = false;
    void (async () => {
      for (let i = 0; i < pages.length; i++) {
        // eslint-disable-next-line no-await-in-loop -- short-circuits on the first matching page
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

  const runLens = useCallback((): void => {
    const current = docRef.current;
    if (!current || lensRunningRef.current) return;
    lensRunningRef.current = true;
    const token = (lensTokenRef.current += 1);
    const reviewedContent = current.content;
    setLens({ status: "running", model: mainModelLabel });
    window.api
      .reviewSpec(reviewedContent)
      .then(
        ({ report, model }) => {
          if (lensTokenRef.current === token) setLens({ status: "done", report, model, reviewedContent });
          else setLens((prev) => (prev.status === "running" ? { status: "idle" } : prev));
        },
        (err: unknown) => {
          if (lensTokenRef.current === token) setLens({ status: "error", message: ipcErrorMessage(err) });
          else setLens((prev) => (prev.status === "running" ? { status: "idle" } : prev));
        },
      )
      .finally(() => {
        lensRunningRef.current = false;
      });
  }, [mainModelLabel]);

  const runAudit = useCallback((): void => {
    const current = docRef.current;
    if (!current || auditRunningRef.current) return;
    auditRunningRef.current = true;
    const token = (auditTokenRef.current += 1);
    const auditedContent = current.content;
    setAudit({ status: "running", model: mainModelLabel });
    window.api
      .auditSpec(auditedContent)
      .then(
        ({ report, model }) => {
          if (auditTokenRef.current === token) setAudit({ status: "done", report, model, auditedContent });
          else setAudit((prev) => (prev.status === "running" ? { status: "idle" } : prev));
        },
        (err: unknown) => {
          if (auditTokenRef.current === token) setAudit({ status: "error", message: ipcErrorMessage(err) });
          else setAudit((prev) => (prev.status === "running" ? { status: "idle" } : prev));
        },
      )
      .finally(() => {
        auditRunningRef.current = false;
      });
  }, [mainModelLabel]);

  const runTailor = useCallback((): void => {
    const current = docRef.current;
    if (!current || tailorRunningRef.current) return;
    tailorRunningRef.current = true;
    const token = (tailorTokenRef.current += 1);
    const tailoredContent = current.content;
    setTailor({ status: "running", model: mainModelLabel });
    window.api
      .tailorSpec(tailoredContent)
      .then(
        ({ plan, model }) => {
          if (tailorTokenRef.current === token) setTailor({ status: "done", plan, model, tailoredContent });
          else setTailor((prev) => (prev.status === "running" ? { status: "idle" } : prev));
        },
        (err: unknown) => {
          if (tailorTokenRef.current === token) setTailor({ status: "error", message: ipcErrorMessage(err) });
          else setTailor((prev) => (prev.status === "running" ? { status: "idle" } : prev));
        },
      )
      .finally(() => {
        tailorRunningRef.current = false;
      });
  }, [mainModelLabel]);

  // 中止: 先に UI を前の状態へ戻して以後の応答を無効化し、main 側の実行を打ち切る。
  // main からの reject はトークン不一致で捨てられるため、エラー表示にはならない
  const cancelLens = useCallback((): void => {
    lensTokenRef.current += 1;
    setLens({ status: "idle" });
    void window.api.cancelAssist("review").catch(() => undefined);
  }, []);

  const cancelAudit = useCallback((): void => {
    auditTokenRef.current += 1;
    setAudit({ status: "idle" });
    void window.api.cancelAssist("audit").catch(() => undefined);
  }, []);

  const cancelTailor = useCallback((): void => {
    tailorTokenRef.current += 1;
    setTailor({ status: "idle" });
    void window.api.cancelAssist("tailor").catch(() => undefined);
  }, []);

  const cancelWeave = useCallback((): void => {
    loomTokenRef.current += 1;
    setLoomSession((prev) => ({ ...prev, phase: prev.result !== null ? "done" : "compose", error: null }));
    void window.api.cancelAssist("weave").catch(() => undefined);
  }, []);

  const cancelWarp = useCallback((): void => {
    warpTokenRef.current += 1;
    setWarpSession((prev) => ({ ...prev, phase: prev.output.trim().length > 0 ? "done" : "compose", error: null }));
    void window.api.cancelAssist("warp").catch(() => undefined);
  }, []);

  // AI アシストによる大規模な書き換えの直前に、適用前の本文を留める。履歴は
  // 安全網であり本流を妨げないため、失敗は握りつぶす
  const guardBeforeAssist = useCallback((label: string): void => {
    const current = docRef.current;
    if (!current || current.content.trim().length === 0) return;
    void window.api.takeSnapshot(current.meta.id, current.content, label, "assist").catch(() => undefined);
  }, []);

  const insertTailorPlan = useCallback((): void => {
    const current = docRef.current;
    const state = tailorRef.current;
    if (!current || state.status !== "done") return;
    const section = tailorPlanToMarkdown(state.plan, state.model);
    const { next, start, end, replaced } = mergePlanIntoContent(current.content, section);
    guardBeforeAssist("Tailor 計画の書き戻し前");
    setDoc((prev) => (prev && prev.meta.id === current.meta.id ? { ...prev, content: next } : prev));
    if (modeRef.current === "preview") setMode("source");
    setEditorJump({ start, end });
    setToast(replaced ? "本文の実装計画を更新しました" : "実装計画を末尾に挿入しました");
  }, [guardBeforeAssist]);

  const copyTailorPlan = useCallback((): void => {
    const state = tailorRef.current;
    if (state.status !== "done") return;
    void copyText(tailorPlanToMarkdown(state.plan, state.model)).then((ok) =>
      setToast(ok ? "計画を Markdown でコピーしました" : "コピーできませんでした"),
    );
  }, []);

  const copyHandoff = useCallback((): void => {
    const current = docRef.current;
    if (!current) return;
    const state = tailorRef.current;
    const planSection = state.status === "done" ? tailorPlanToMarkdown(state.plan, state.model) : null;
    const prompt = buildHandoffPrompt({ title: current.meta.title, content: current.content, planSection });
    void copyText(prompt).then((ok) => setToast(ok ? "実装プロンプトをコピーしました" : "コピーできませんでした"));
  }, []);

  const applyLensRewrite = useCallback((excerpt: string, rewrite: string): boolean => {
    const current = docRef.current;
    if (!current) return false;
    const index = current.content.indexOf(excerpt);
    if (index === -1) {
      setToast("該当箇所が見つかりません。本文が変更された可能性があります。");
      return false;
    }
    if (current.content.indexOf(excerpt, index + 1) !== -1) {
      setToast("同じ記述が複数あるため適用できません。該当箇所を直接編集してください。");
      return false;
    }
    const next = current.content.slice(0, index) + rewrite + current.content.slice(index + excerpt.length);
    setDoc((prev) => (prev && prev.meta.id === current.meta.id ? { ...prev, content: next } : prev));
    return true;
  }, []);

  const jumpToLensExcerpt = useCallback(
    (excerpt: string): void => {
      const current = docRef.current;
      if (!current || excerpt.length === 0) return;
      const start = current.content.indexOf(excerpt);
      if (start === -1) {
        setToast("該当箇所が見つかりません。本文が変更された可能性があります。");
        return;
      }
      if (current.content.indexOf(excerpt, start + 1) !== -1) {
        setToast("同じ記述が複数あるため移動先を特定できません。");
        return;
      }
      const probe = excerpt.trim();
      const targetPage = probe.length > 0 ? pages.findIndex((page) => page.content.includes(probe)) : -1;
      if (targetPage !== -1) setPageIndex(targetPage);
      if (modeRef.current === "preview") setMode("source");
      setEditorJump({ start, end: start + excerpt.length });
    },
    [pages],
  );

  const jumpToOffset = useCallback(
    (start: number, end: number): void => {
      const current = docRef.current;
      if (!current) return;
      const bounded = Math.min(start, current.content.length);
      const lineIndex = current.content.slice(0, bounded).split("\n").length - 1;
      let targetPage = 0;
      for (let i = 0; i < pages.length; i++) {
        if (pages[i]!.startLine <= lineIndex) targetPage = i;
        else break;
      }
      setPageIndex(targetPage);
      if (modeRef.current === "preview") setMode("source");
      setEditorJump({ start: bounded, end: Math.min(end, current.content.length) });
    },
    [pages],
  );

  const handleEditorSelection = useCallback(
    (start: number, end: number): void => {
      selectionRef.current = { start, end };
      // Source / Split ではカーソル位置にページ表示(パンくず・ナビ)を追従させる
      if (modeRef.current === "preview") return;
      const current = docRef.current;
      if (!current) return;
      const bounded = Math.min(start, current.content.length);
      let line = 0;
      for (let i = 0; i < bounded; i++) {
        if (current.content.charCodeAt(i) === 10) line += 1;
      }
      let target = 0;
      for (let i = 0; i < pages.length; i++) {
        if (pages[i]!.startLine <= line) target = i;
        else break;
      }
      setPageIndex((prev) => (prev === target ? prev : target));
    },
    [pages],
  );

  const updateLoomSession = useCallback((patch: Partial<LoomSession>): void => {
    setLoomSession((prev) => ({ ...prev, ...patch }));
  }, []);

  const runWeave = useCallback((kind: WeaveKind): void => {
    const current = docRef.current;
    if (!current || loomRunningRef.current) return;
    const session = loomSessionRef.current;
    const qa: WeaveQa[] = [];
    if (kind === "reweave" && session.result !== null) {
      session.result.questions.forEach((question, index) => {
        const answer = (session.answers[index] ?? "").trim();
        if (answer.length > 0) qa.push({ question: question.question, answer: answer.slice(0, 4000) });
      });
    }
    const material = kind === "reweave" && session.woven.trim().length > 0 ? session.woven : session.material;
    const materialLimit = kind === "reweave" ? MAX_WEAVE_WOVEN_CHARS : MAX_WEAVE_MATERIAL_CHARS;
    if (material.length > materialLimit) {
      setToast(
        kind === "reweave"
          ? "織り上がりが上限(約 4.8 万字)を超えています。削ってから織り込んでください"
          : "素材が上限(約 3.2 万字)を超えています。削ってから織ってください",
      );
      return;
    }
    if (material.trim().length === 0 && qa.length === 0 && current.meta.title.trim().length === 0) {
      setToast("素材がありません。メモや箇条書きを入れてから織ってください");
      return;
    }
    lastWeaveKindRef.current = kind;
    loomRunningRef.current = true;
    const token = (loomTokenRef.current += 1);
    setLoomSession((prev) => ({ ...prev, phase: "running", error: null }));
    window.api
      .weaveSpec({
        title: current.meta.title.slice(0, 200),
        material,
        context: current.content.slice(0, MAX_WEAVE_CONTEXT_CHARS),
        qa,
      })
      .then(
        ({ result, model }) => {
          if (loomTokenRef.current !== token) return;
          if (result.woven.length === 0 && result.questions.length === 0) {
            setLoomSession((prev) => ({
              ...prev,
              phase: "error",
              error: "織れるものがありませんでした。素材を増やして再試行してください。",
            }));
            return;
          }
          setLoomSession((prev) => ({
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
          if (loomTokenRef.current !== token) return;
          setLoomSession((prev) => ({ ...prev, phase: "error", error: ipcErrorMessage(err) }));
        },
      )
      .finally(() => {
        loomRunningRef.current = false;
      });
  }, []);

  const retryWeave = useCallback((): void => {
    setLoomSession((prev) => ({ ...prev, phase: prev.result !== null ? "done" : "compose", error: null }));
    runWeave(lastWeaveKindRef.current);
  }, [runWeave]);

  const grabEditorSelection = useCallback((): string | null => {
    const current = docRef.current;
    if (!current) return null;
    if (modeRef.current === "preview") {
      setToast("Source / Split モードで取り込みたい範囲を選択してください");
      return null;
    }
    const selection = selectionRef.current;
    if (!selection || selection.start === selection.end) {
      setToast("選択範囲がありません。エディタで範囲を選択してください");
      return null;
    }
    return current.content.slice(selection.start, selection.end);
  }, []);

  const pullSelectionToLoom = useCallback((): void => {
    const text = grabEditorSelection();
    if (text === null) return;
    const prev = loomSessionRef.current;
    if (prev.replaceTargets.includes(text)) {
      setToast("その範囲は取り込み済みです");
      return;
    }
    const merged = prev.material.trim().length > 0 ? `${prev.material.replace(/\s+$/, "")}\n\n${text}` : text;
    if (merged.length > MAX_WEAVE_MATERIAL_CHARS) {
      setToast("素材が上限(約 3.2 万字)を超えるため取り込めません");
      return;
    }
    setLoomSession({ ...prev, material: merged, replaceTargets: [...prev.replaceTargets, text] });
  }, [grabEditorSelection]);

  const insertComposed = useCallback(
    (
      text: string,
      rawTargets: string[],
    ): { kind: "replaced"; count: number } | { kind: "inserted"; fellBack: boolean } | null => {
      const current = docRef.current;
      if (!current || text.length === 0) return null;
      const content = current.content;
      let fellBack = false;
      let replaceRanges: { start: number; end: number }[] | null = null;
      const targets = rawTargets.filter((target) => target.length > 0);
      if (targets.length > 0) {
        const resolved: { start: number; end: number }[] = [];
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
        const nextPage = pages[pageIndex + 1];
        const caret =
          modeRef.current !== "preview"
            ? (selectionRef.current?.end ?? content.length)
            : nextPage
              ? lineStartOffset(content, nextPage.startLine)
              : content.length;
        const before = content.slice(0, caret);
        const after = content.slice(caret);
        const lead = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
        const trail =
          after.length === 0 ? "\n" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
        next = before + lead + text + trail + after;
        jumpStart = caret + lead.length;
      }
      setDoc((prev) => (prev && prev.meta.id === current.meta.id ? { ...prev, content: next } : prev));
      if (modeRef.current === "preview") setMode("source");
      setEditorJump({ start: jumpStart, end: jumpStart + text.length });
      return replaceRanges ? { kind: "replaced", count: replaceRanges.length } : { kind: "inserted", fellBack };
    },
    [pages, pageIndex],
  );

  const insertWoven = useCallback((): void => {
    const session = loomSessionRef.current;
    const text = session.woven.trim();
    if (text.length === 0) return;
    guardBeforeAssist("Loom 織り上がりの反映前");
    const result = insertComposed(text, session.replaceTargets);
    if (result === null) return;
    setLoomSession(INITIAL_LOOM_SESSION);
    setToast(
      result.kind === "replaced"
        ? result.count > 1
          ? `${result.count} 箇所を 1 つに織り直しました`
          : "選択箇所を置き換えました"
        : result.fellBack
          ? "置き換え対象を特定できないため、挿入に切り替えました"
          : "織り上がりを挿入しました",
    );
  }, [insertComposed, guardBeforeAssist]);

  const updateWarpSession = useCallback((patch: Partial<WarpSession>): void => {
    setWarpSession((prev) => ({ ...prev, ...patch }));
  }, []);

  // materialOverride は Mermaid 構文の自動修復用(セッションの素材は変えずに、
  // 壊れたコードとエラーメッセージを差し替え素材として渡す)
  const runWarp = useCallback((materialOverride?: string): void => {
    const current = docRef.current;
    if (!current || warpRunningRef.current) return;
    const session = warpSessionRef.current;
    const material = materialOverride ?? session.material;
    if (material.trim().length === 0) {
      setToast("素材がありません。本文の選択範囲やメモを入れてから張ってください");
      return;
    }
    if (material.length > MAX_WARP_MATERIAL_CHARS) {
      setToast("素材が上限(約 2.4 万字)を超えています。削ってから張ってください");
      return;
    }
    warpRunningRef.current = true;
    const token = (warpTokenRef.current += 1);
    setWarpSession((prev) => ({ ...prev, phase: "running", error: null }));
    window.api
      .warpSpec({
        form: session.form,
        material,
        title: current.meta.title.slice(0, 200),
        diagram: session.diagram,
      })
      .then(
        ({ result, model }) => {
          if (warpTokenRef.current !== token) return;
          setWarpSession((prev) => ({
            ...prev,
            phase: "done",
            output: result.output,
            notes: result.notes,
            servedBy: model,
            error: null,
          }));
        },
        (err: unknown) => {
          if (warpTokenRef.current !== token) return;
          setWarpSession((prev) => ({ ...prev, phase: "error", error: ipcErrorMessage(err) }));
        },
      )
      .finally(() => {
        warpRunningRef.current = false;
      });
  }, []);

  const pullSelectionToWarp = useCallback((): void => {
    const text = grabEditorSelection();
    if (text === null) return;
    const prev = warpSessionRef.current;
    if (prev.replaceTargets.includes(text)) {
      setToast("その範囲は取り込み済みです");
      return;
    }
    const merged = prev.material.trim().length > 0 ? `${prev.material.replace(/\s+$/, "")}\n\n${text}` : text;
    if (merged.length > MAX_WARP_MATERIAL_CHARS) {
      setToast("素材が上限(約 2.4 万字)を超えるため取り込めません");
      return;
    }
    setWarpSession({ ...prev, material: merged, replaceTargets: [...prev.replaceTargets, text] });
  }, [grabEditorSelection]);

  // Mermaid のセルフヒーリング: レンダリングエラーの内容を添えて、いまの出力を
  // そのまま素材に張り直す(プロンプトが既存コードの構文修正を引き受ける)
  const repairWarpMermaid = useCallback(
    (renderError: string): void => {
      const session = warpSessionRef.current;
      const code = session.output.trim();
      if (session.form !== "mermaid" || code.length === 0) return;
      const material = [
        "以下の Mermaid コードはレンダリングでエラーになります。図の意味・構造は変えずに、構文だけを修復してください。",
        "",
        `エラーメッセージ: ${renderError.slice(0, 600)}`,
        "",
        "```mermaid",
        code,
        "```",
      ].join("\n");
      runWarp(material);
    },
    [runWarp],
  );

  const insertWarpOutput = useCallback((): void => {
    const session = warpSessionRef.current;
    const body = session.output.trim();
    if (body.length === 0) return;
    const text = session.form === "mermaid" ? `\`\`\`mermaid\n${body}\n\`\`\`` : body;
    guardBeforeAssist(session.form === "mermaid" ? "Warp 図の反映前" : "Warp 要件の反映前");
    const result = insertComposed(text, session.replaceTargets);
    if (result === null) return;
    setWarpSession(INITIAL_WARP_SESSION);
    setToast(
      result.kind === "replaced"
        ? result.count > 1
          ? `${result.count} 箇所を張り替えました`
          : "選択箇所を張り替えました"
        : result.fellBack
          ? "置き換え対象を特定できないため、挿入に切り替えました"
          : session.form === "mermaid"
            ? "図を挿入しました"
            : "要件を挿入しました",
    );
  }, [insertComposed, guardBeforeAssist]);

  const reloadSnapshots = useCallback((): void => {
    const current = docRef.current;
    if (!current) return;
    const specId = current.meta.id;
    window.api.listSnapshots(specId).then(
      (snapshots) => {
        if (docRef.current?.meta.id === specId) setSelvage({ snapshots, error: null });
      },
      (err: unknown) => {
        if (docRef.current?.meta.id === specId) {
          setSelvage((prev) => ({ snapshots: prev.snapshots ?? [], error: ipcErrorMessage(err) }));
        }
      },
    );
  }, []);

  // パネルを開いた時・仕様書を切り替えた時は即読み直す
  useEffect(() => {
    if (!selvageOpen || activeId === null) return;
    reloadSnapshots();
  }, [selvageOpen, activeId, reloadSnapshots]);

  // 保存のたび自動スナップショットが増えている可能性がある。打鍵ごとの保存で
  // I/O が嵩まないよう、updatedAt の変化からひと呼吸置いて読み直す
  const docUpdatedAt = doc?.meta.updatedAt;
  useEffect(() => {
    if (!selvageOpen || docUpdatedAt === undefined) return;
    const handle = window.setTimeout(reloadSnapshots, 1200);
    return () => window.clearTimeout(handle);
  }, [selvageOpen, docUpdatedAt, reloadSnapshots]);

  const takeManualSnapshot = useCallback(
    (label: string | null): void => {
      const current = docRef.current;
      if (!current) return;
      const specId = current.meta.id;
      window.api.takeSnapshot(specId, current.content, label).then(
        () => {
          setToast("いまの版を留めました");
          if (docRef.current?.meta.id === specId) reloadSnapshots();
        },
        (err: unknown) => setToast(`留められませんでした: ${ipcErrorMessage(err)}`),
      );
    },
    [reloadSnapshots],
  );

  const loadSnapshot = useCallback((snapshotId: string): Promise<SnapshotDocument> => {
    const current = docRef.current;
    if (!current) return Promise.reject(new Error("仕様書が開かれていません"));
    return window.api.readSnapshot(current.meta.id, snapshotId);
  }, []);

  const restoreFromSnapshot = useCallback(
    (snapshotId: string): void => {
      const current = docRef.current;
      if (!current || selvageBusyRef.current) return;
      selvageBusyRef.current = true;
      setSelvageBusy(true);
      const specId = current.meta.id;
      void (async () => {
        try {
          // 復元前の編集も guard スナップショットに含まれるよう、先にディスクへ流す
          if (current.content !== loadedContentRef.current) {
            pendingSaveRef.current = { id: specId, content: current.content };
          }
          const flushed = await flushSave();
          if (!flushed) {
            setToast("未保存の変更を書き込めないため、復元を中止しました");
            return;
          }
          if (docRef.current?.meta.id !== specId) return;
          const flushedContent = docRef.current.content;
          const result = await window.api.restoreSnapshot(specId, snapshotId);
          if (docRef.current?.meta.id !== specId) return;
          if (docRef.current.content !== flushedContent) {
            // エディタは復元中 readOnly だが、万一すり抜けた編集があれば編集を優先して
            // ディスクへ書き戻す(復元で上書きされた内容は次の保存の自動版として残る)
            pendingSaveRef.current = { id: specId, content: docRef.current.content };
            void flushSave();
            setToast("復元中に編集があったため適用を中止しました。編集内容を保持しています");
            reloadSnapshots();
            return;
          }
          loadedContentRef.current = result.content;
          pendingSaveRef.current = null;
          setDoc((prev) => (prev && prev.meta.id === specId ? { meta: result.meta, content: result.content } : prev));
          setSpecs((prev) => prev.map((spec) => (spec.id === specId ? result.meta : spec)).sort(byUpdatedDesc));
          setToast("選んだ版に戻しました。直前の状態も Selvage に残っています");
          reloadSnapshots();
        } catch (err) {
          setToast(`復元できませんでした: ${ipcErrorMessage(err)}`);
        } finally {
          selvageBusyRef.current = false;
          setSelvageBusy(false);
        }
      })();
    },
    [flushSave, reloadSnapshots],
  );

  const copySnapshot = useCallback((snapshotId: string): void => {
    const current = docRef.current;
    if (!current) return;
    window.api.readSnapshot(current.meta.id, snapshotId).then(
      (snapshot) =>
        void copyText(snapshot.content).then((ok) =>
          setToast(ok ? "この版の本文をコピーしました" : "コピーできませんでした"),
        ),
      (err: unknown) => setToast(ipcErrorMessage(err)),
    );
  }, []);

  const removeSnapshot = useCallback(
    (snapshotId: string): void => {
      const current = docRef.current;
      if (!current) return;
      const specId = current.meta.id;
      window.api.deleteSnapshot(specId, snapshotId).then(
        () => {
          setToast("版を削除しました");
          if (docRef.current?.meta.id === specId) reloadSnapshots();
        },
        (err: unknown) => setToast(`削除できませんでした: ${ipcErrorMessage(err)}`),
      );
    },
    [reloadSnapshots],
  );

  const togglePinSnapshot = useCallback((snapshotId: string, pinned: boolean): void => {
    const current = docRef.current;
    if (!current) return;
    const specId = current.meta.id;
    window.api.setSnapshotPinned(specId, snapshotId, pinned).then(
      (meta) => {
        setToast(pinned ? "この版をピン留めしました。上限でも自動削除されません" : "ピン留めを外しました");
        if (docRef.current?.meta.id !== specId) return;
        setSelvage((prev) =>
          prev.snapshots === null
            ? prev
            : { ...prev, snapshots: prev.snapshots.map((item) => (item.id === meta.id ? meta : item)) },
        );
      },
      (err: unknown) => setToast(`ピン留めを変更できませんでした: ${ipcErrorMessage(err)}`),
    );
  }, []);

  const pendingCount = useMemo(() => findPendingDecisions(doc?.content ?? "").length, [doc?.content]);
  const planInDoc = useMemo(() => pages.some((page) => page.depth === 2 && page.title === PLAN_HEADING), [pages]);

  // タイピングを妨げないよう、ほつれ検査は低優先度の遅延値に対して走らせる
  const deferredContent = useDeferredValue(doc?.content ?? "");
  const frayEnabled = (frayAutoCheck || frayOpen) && doc !== null;
  const frayIssues = useMemo<FrayIssue[]>(() => {
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

  // ほつれ検査の修正を本文へ適用する。検査はひと呼吸遅れた deferredContent に
  // 対して走るため、オフセットを信用せず置換前の文字列と照合してから書き換える
  const applyFrayFixes = useCallback((issues: FrayIssue[]): void => {
    const current = docRef.current;
    if (!current) return;
    const content = current.content;
    const all = issues
      .flatMap((issue) => issue.fix?.replacements ?? [])
      .sort((a, b) => a.start - b.start)
      // まとめて適用するとき、万一範囲が重なる置換は後勝ちにせず捨てる
      .filter((rep, index, sorted) => index === 0 || rep.start >= sorted[index - 1]!.end);
    if (all.length === 0) return;
    for (const rep of all) {
      if (content.slice(rep.start, rep.end) !== rep.from) {
        setToast("本文が検査時点から変わっています。再検査の完了を待ってからやり直してください");
        return;
      }
    }
    let next = content;
    for (let i = all.length - 1; i >= 0; i--) {
      const rep = all[i]!;
      next = next.slice(0, rep.start) + rep.to + next.slice(rep.end);
    }
    setDoc((prev) => (prev && prev.meta.id === current.meta.id ? { ...prev, content: next } : prev));
    setToast(`${all.length} 箇所を修正しました`);
  }, []);

  const previewSyncRef = useRef<((ratio: number) => void) | null>(null);
  const handleEditorScrollRatio = useCallback((ratio: number): void => {
    previewSyncRef.current?.(ratio);
  }, []);

  // ページ移動。Preview ではページ差し替え、Source / Split ではエディタとプレビューを
  // 該当節へスクロールする(Split のプレビューは全文表示のため)
  const goToPage = useCallback(
    (index: number): void => {
      const bounded = Math.max(0, Math.min(index, pages.length - 1));
      setPageIndex(bounded);
      const current = docRef.current;
      if (!current || modeRef.current === "preview") return;
      const page = pages[bounded];
      if (!page) return;
      const offset = lineStartOffset(current.content, page.startLine);
      setEditorJump({ start: offset, end: offset });
      if (modeRef.current === "split") {
        const anchor = pageHeadingIds[bounded]?.[0];
        if (anchor !== undefined) setPendingAnchor({ docId: current.meta.id, id: anchor });
        else previewSyncRef.current?.(0);
      }
    },
    [pages, pageHeadingIds],
  );

  const splitDragRef = useRef<DOMRect | null>(null);
  const handleDividerDown = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    const container = event.currentTarget.parentElement;
    if (!container) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    splitDragRef.current = container.getBoundingClientRect();
  }, []);
  const handleDividerMove = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    const rect = splitDragRef.current;
    if (!rect || rect.width <= 0) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    setSplitRatio(Math.min(SPLIT_RATIO.max, Math.max(SPLIT_RATIO.min, ratio)));
  }, []);
  const handleDividerUp = useCallback((): void => {
    if (splitDragRef.current === null) return;
    splitDragRef.current = null;
    void window.api.setSetting("splitRatio", splitRatioRef.current).catch(() => undefined);
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

  const toggleLens = useCallback((): void => {
    if (docRef.current === null) return;
    setLensOpen((prev) => {
      if (!prev) {
        setLoomOpen(false);
        setFrayOpen(false);
        setWarpOpen(false);
        setTailorOpen(false);
        setSelvageOpen(false);
      }
      return !prev;
    });
  }, []);

  const toggleLoom = useCallback((): void => {
    if (docRef.current === null) return;
    setLoomOpen((prev) => {
      if (!prev) {
        setLensOpen(false);
        setFrayOpen(false);
        setWarpOpen(false);
        setTailorOpen(false);
        setSelvageOpen(false);
      }
      return !prev;
    });
  }, []);

  const toggleFray = useCallback((): void => {
    if (docRef.current === null) return;
    setFrayOpen((prev) => {
      if (!prev) {
        setLensOpen(false);
        setLoomOpen(false);
        setWarpOpen(false);
        setTailorOpen(false);
        setSelvageOpen(false);
      }
      return !prev;
    });
  }, []);

  const toggleWarp = useCallback((): void => {
    if (docRef.current === null) return;
    setWarpOpen((prev) => {
      if (!prev) {
        setLensOpen(false);
        setLoomOpen(false);
        setFrayOpen(false);
        setTailorOpen(false);
        setSelvageOpen(false);
      }
      return !prev;
    });
  }, []);

  const toggleTailor = useCallback((): void => {
    if (docRef.current === null) return;
    setTailorOpen((prev) => {
      if (!prev) {
        setLensOpen(false);
        setLoomOpen(false);
        setFrayOpen(false);
        setWarpOpen(false);
        setSelvageOpen(false);
      }
      return !prev;
    });
  }, []);

  const toggleSelvage = useCallback((): void => {
    if (docRef.current === null) return;
    setSelvageOpen((prev) => {
      if (!prev) {
        setLensOpen(false);
        setLoomOpen(false);
        setFrayOpen(false);
        setWarpOpen(false);
        setTailorOpen(false);
      }
      return !prev;
    });
  }, []);

  const openSearch = useCallback(() => {
    setMode("preview");
    setSearch((prev) => ({ open: true, query: prev.query }));
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, []);

  const closeSearch = useCallback(() => {
    setSearch({ open: false, query: "" });
    setMatches([]);
    setMatchCursor(0);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key === ",") {
        event.preventDefault();
        setSettingsOpen((prev) => !prev);
        return;
      }
      if (settingsOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          setSettingsOpen(false);
        }
        return;
      }
      if (mod && event.key.toLowerCase() === "f") {
        event.preventDefault();
        openSearch();
      } else if (mod && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setDialog({ kind: "new" });
      } else if (mod && event.key.toLowerCase() === "l") {
        event.preventDefault();
        toggleLens();
      } else if (mod && event.key.toLowerCase() === "j") {
        event.preventDefault();
        toggleLoom();
      } else if (mod && event.key.toLowerCase() === "e") {
        event.preventDefault();
        toggleWarp();
      } else if (mod && event.key.toLowerCase() === "g") {
        event.preventDefault();
        toggleFray();
      } else if (mod && event.key.toLowerCase() === "i") {
        event.preventDefault();
        toggleTailor();
      } else if (mod && event.key.toLowerCase() === "h") {
        event.preventDefault();
        toggleSelvage();
      } else if (mod && event.key === "\\") {
        event.preventDefault();
        if (docRef.current !== null) setMode((prev) => (prev === "split" ? "preview" : "split"));
      } else if (event.key === "Escape" && search.open) {
        closeSearch();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    openSearch,
    closeSearch,
    search.open,
    settingsOpen,
    toggleLens,
    toggleLoom,
    toggleFray,
    toggleWarp,
    toggleTailor,
    toggleSelvage,
  ]);

  const stepMatch = (delta: number): void => {
    if (matches.length === 0) return;
    const nextCursor = (matchCursor + delta + matches.length) % matches.length;
    setMatchCursor(nextCursor);
    const target = matches[nextCursor];
    if (target && target.pageIndex !== pageIndex) setPageIndex(target.pageIndex);
  };

  const handleLinkActivate = useCallback(
    (href: string): void => {
      const reportLaunchFailure = (err: unknown): void => {
        setToast(`リンクを開けませんでした: ${errorMessage(err)}`);
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
        setToast(`リンク先が見つかりません: ${href}`);
        return;
      }
      void openSpec(target.id).then((opened) => {
        if (opened && fragment) setPendingAnchor({ docId: target.id, id: fragment });
      });
    },
    [doc, specs, openSpec],
  );

  const handleCreate = (title: string): void => {
    setDialog(null);
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
        setToast(`作成に失敗しました: ${errorMessage(err)}`);
      }
    })();
  };

  const handleRename = (id: string, title: string): void => {
    setDialog(null);
    void (async () => {
      try {
        const meta = await window.api.renameSpec(id, title);
        setSpecs((prev) => prev.map((spec) => (spec.id === id ? meta : spec)).sort(byUpdatedDesc));
        setDoc((prev) => (prev && prev.meta.id === id ? { ...prev, meta } : prev));
      } catch (err) {
        setToast(`変更に失敗しました: ${errorMessage(err)}`);
      }
    })();
  };

  const handleDelete = (id: string): void => {
    void (async () => {
      deletingIdsRef.current.add(id);
      try {
        if (docRef.current?.meta.id === id) pendingSaveRef.current = null;
        await flushSave();
        if (pendingOpenIdRef.current === id) openRequestRef.current += 1;
        await window.api.deleteSpec(id);
        setDialog(null);
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
        setToast(`削除に失敗しました: ${errorMessage(err)}`);
        const current = docRef.current;
        if (current && current.content !== loadedContentRef.current) {
          pendingSaveRef.current = { id: current.meta.id, content: current.content };
          void flushSave();
        }
      } finally {
        deletingIdsRef.current.delete(id);
      }
    })();
  };

  const importFiles = useCallback(
    (files: File[]): void => {
      const markdownFiles = files.filter(isMarkdownFile);
      if (markdownFiles.length === 0) {
        setToast("Markdown（.md）ファイルのみ読み込めます");
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
            // eslint-disable-next-line no-await-in-loop -- sequential reads keep ordering stable and bound memory
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
        if (notes.length > 0) setToast(notes.join(" ／ "));
        const last = metas[metas.length - 1];
        if (last && importIntentRef.current === intent && openRequestRef.current === navToken) await openSpec(last.id);
      })();
    },
    [openSpec],
  );

  const dragActive = useFileDrop(importFiles);

  // 設定ストアから読み直されて初めて効く設定 (main プロセスが読む履歴・AI タイムアウト、
  // 次回起動が読む復元フラグ) は、書き込みに失敗すると「変わったように見えて効かない」
  // 状態になる。renderer の state が真実になる他の設定と違い、結果を確かめて失敗時は
  // 永続値へ表示を巻き戻す
  const persistStoreBacked = useCallback(
    (write: () => Promise<boolean>, revert: (settings: RendererSettings) => void): void => {
      write().then(
        (persisted) => {
          if (persisted) return;
          setToast("設定ストアが利用できないため保存できませんでした");
          window.api.getSettings().then(revert, () => undefined);
        },
        () => undefined,
      );
    },
    [],
  );

  const handleSettingChange = useCallback(
    (change: SettingChange): void => {
      switch (change.key) {
        case "theme":
          setThemePreference(change.value);
          return;
        case "accent":
          setAppearance((prev) => ({ ...prev, accent: change.value }));
          void window.api.setSetting("accent", change.value).catch(() => undefined);
          return;
        case "editorFontSize":
          setAppearance((prev) => ({ ...prev, editorFontSize: change.value }));
          void window.api.setSetting("editorFontSize", change.value).catch(() => undefined);
          return;
        case "previewFontSize":
          setAppearance((prev) => ({ ...prev, previewFontSize: change.value }));
          void window.api.setSetting("previewFontSize", change.value).catch(() => undefined);
          return;
        case "editorLineHeight":
          setAppearance((prev) => ({ ...prev, editorLineHeight: change.value }));
          void window.api.setSetting("editorLineHeight", change.value).catch(() => undefined);
          return;
        case "previewLineHeight":
          setAppearance((prev) => ({ ...prev, previewLineHeight: change.value }));
          void window.api.setSetting("previewLineHeight", change.value).catch(() => undefined);
          return;
        case "readingWidth":
          setAppearance((prev) => ({ ...prev, readingWidth: change.value }));
          void window.api.setSetting("readingWidth", change.value).catch(() => undefined);
          return;
        case "mermaidRenderer":
          setMermaidRenderer(change.value);
          void window.api.setSetting("mermaidRenderer", change.value).catch(() => undefined);
          return;
        case "defaultViewMode":
          setDefaultViewMode(change.value);
          void window.api.setSetting("defaultViewMode", change.value).catch(() => undefined);
          return;
        case "autosaveDelay":
          setAutosaveDelay(change.value);
          void window.api.setSetting("autosaveDelay", change.value).catch(() => undefined);
          return;
        case "toastDuration":
          setToastDuration(change.value);
          void window.api.setSetting("toastDuration", change.value).catch(() => undefined);
          return;
        case "restoreLastSpec": {
          const value = change.value;
          setRestoreLastSpec(value);
          persistStoreBacked(
            () => window.api.setSetting("restoreLastSpec", value),
            (settings) => setRestoreLastSpec(settings.restoreLastSpec),
          );
          return;
        }
        case "frayAutoCheck":
          setFrayAutoCheck(change.value);
          void window.api.setSetting("frayAutoCheck", change.value).catch(() => undefined);
          return;
        case "frayKinds":
          setFrayKinds(change.value);
          void window.api.setSetting("frayKinds", change.value).catch(() => undefined);
          return;
        case "autoSnapshotMinutes": {
          const value = change.value;
          setAutoSnapshotMinutes(value);
          persistStoreBacked(
            () => window.api.setSetting("autoSnapshotMinutes", value),
            (settings) => setAutoSnapshotMinutes(settings.autoSnapshotMinutes),
          );
          return;
        }
        case "maxSnapshotsPerSpec": {
          const value = change.value;
          setMaxSnapshotsPerSpec(value);
          persistStoreBacked(
            () => window.api.setSetting("maxSnapshotsPerSpec", value),
            (settings) => setMaxSnapshotsPerSpec(settings.maxSnapshotsPerSpec),
          );
          return;
        }
        case "assistTimeoutSec": {
          const value = change.value;
          setAssistTimeoutSec(value);
          persistStoreBacked(
            () => window.api.setSetting("assistTimeoutSec", value),
            (settings) => setAssistTimeoutSec(settings.assistTimeoutSec),
          );
          return;
        }
      }
    },
    [persistStoreBacked],
  );

  const handleUpsertProfile = useCallback(
    async (input: UpsertLlmProfileInput): Promise<boolean> => {
      try {
        applyLlmSettings(await window.api.upsertLlmProfile(input));
        setToast("モデル設定を保存しました");
        return true;
      } catch (err) {
        setToast(ipcErrorMessage(err));
        return false;
      }
    },
    [applyLlmSettings],
  );

  const handleDeleteProfile = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        applyLlmSettings(await window.api.deleteLlmProfile(id));
        setToast("モデルを削除しました");
        return true;
      } catch (err) {
        setToast(ipcErrorMessage(err));
        return false;
      }
    },
    [applyLlmSettings],
  );

  const routingSeqRef = useRef(0);
  const routingQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const handleSetRouting = useCallback(
    (mainId: string, fallbackIds: string[]): void => {
      // 連打時に直前のクリックを織り込んだ状態から次の計算ができるよう楽観更新し、
      // IPC は直列化して最後の応答だけを正とする
      const seq = (routingSeqRef.current += 1);
      setLlm((prev) => ({ ...prev, llmMainProfileId: mainId, llmFallbackProfileIds: fallbackIds }));
      routingQueueRef.current = routingQueueRef.current.then(() =>
        window.api.setLlmRouting(mainId, fallbackIds).then(
          (settings) => {
            if (routingSeqRef.current === seq) applyLlmSettings(settings);
          },
          (err: unknown) => {
            if (routingSeqRef.current !== seq) return;
            setToast(ipcErrorMessage(err));
            // 楽観更新を残さない: 永続化済みの状態へ巻き戻す
            window.api.getSettings().then(applyLlmSettings, () => undefined);
          },
        ),
      );
    },
    [applyLlmSettings],
  );

  const handleSaveApiKey = useCallback(async (key: string | null): Promise<boolean> => {
    try {
      const persisted = await window.api.setSetting("geminiApiKey", key);
      if (!persisted) {
        setToast("設定ストアが利用できないため保存できませんでした");
        return false;
      }
      setAiKeySet(key !== null);
      setToast(key !== null ? "Gemini API キーを保存しました" : "Gemini API キーを削除しました");
      return true;
    } catch (err) {
      setToast(ipcErrorMessage(err));
      return false;
    }
  }, []);

  const handleResetSettings = useCallback((): void => {
    setThemePreference(DEFAULT_SETTINGS.theme);
    const defaults: AppearanceSettings = {
      accent: DEFAULT_SETTINGS.accent,
      editorFontSize: DEFAULT_SETTINGS.editorFontSize,
      previewFontSize: DEFAULT_SETTINGS.previewFontSize,
      editorLineHeight: DEFAULT_SETTINGS.editorLineHeight,
      previewLineHeight: DEFAULT_SETTINGS.previewLineHeight,
      readingWidth: DEFAULT_SETTINGS.readingWidth,
    };
    setAppearance(defaults);
    setMermaidRenderer(DEFAULT_SETTINGS.mermaidRenderer);
    setDefaultViewMode(DEFAULT_SETTINGS.defaultViewMode);
    setSplitRatio(DEFAULT_SETTINGS.splitRatio);
    setAutosaveDelay(DEFAULT_SETTINGS.autosaveDelay);
    setToastDuration(DEFAULT_SETTINGS.toastDuration);
    setFrayAutoCheck(DEFAULT_SETTINGS.frayAutoCheck);
    setFrayKinds(DEFAULT_SETTINGS.frayKinds);
    setRestoreLastSpec(DEFAULT_SETTINGS.restoreLastSpec);
    setAutoSnapshotMinutes(DEFAULT_SETTINGS.autoSnapshotMinutes);
    setMaxSnapshotsPerSpec(DEFAULT_SETTINGS.maxSnapshotsPerSpec);
    setAssistTimeoutSec(DEFAULT_SETTINGS.assistTimeoutSec);
    persistStoreBacked(
      () => window.api.setSetting("restoreLastSpec", DEFAULT_SETTINGS.restoreLastSpec),
      (settings) => setRestoreLastSpec(settings.restoreLastSpec),
    );
    persistStoreBacked(
      () => window.api.setSetting("autoSnapshotMinutes", DEFAULT_SETTINGS.autoSnapshotMinutes),
      (settings) => setAutoSnapshotMinutes(settings.autoSnapshotMinutes),
    );
    persistStoreBacked(
      () => window.api.setSetting("maxSnapshotsPerSpec", DEFAULT_SETTINGS.maxSnapshotsPerSpec),
      (settings) => setMaxSnapshotsPerSpec(settings.maxSnapshotsPerSpec),
    );
    persistStoreBacked(
      () => window.api.setSetting("assistTimeoutSec", DEFAULT_SETTINGS.assistTimeoutSec),
      (settings) => setAssistTimeoutSec(settings.assistTimeoutSec),
    );
    void window.api.setSetting("accent", defaults.accent).catch(() => undefined);
    void window.api.setSetting("editorFontSize", defaults.editorFontSize).catch(() => undefined);
    void window.api.setSetting("previewFontSize", defaults.previewFontSize).catch(() => undefined);
    void window.api.setSetting("editorLineHeight", defaults.editorLineHeight).catch(() => undefined);
    void window.api.setSetting("previewLineHeight", defaults.previewLineHeight).catch(() => undefined);
    void window.api.setSetting("readingWidth", defaults.readingWidth).catch(() => undefined);
    void window.api.setSetting("mermaidRenderer", DEFAULT_SETTINGS.mermaidRenderer).catch(() => undefined);
    void window.api.setSetting("defaultViewMode", DEFAULT_SETTINGS.defaultViewMode).catch(() => undefined);
    void window.api.setSetting("splitRatio", DEFAULT_SETTINGS.splitRatio).catch(() => undefined);
    void window.api.setSetting("autosaveDelay", DEFAULT_SETTINGS.autosaveDelay).catch(() => undefined);
    void window.api.setSetting("toastDuration", DEFAULT_SETTINGS.toastDuration).catch(() => undefined);
    void window.api.setSetting("frayAutoCheck", DEFAULT_SETTINGS.frayAutoCheck).catch(() => undefined);
    void window.api.setSetting("frayKinds", DEFAULT_SETTINGS.frayKinds).catch(() => undefined);
    // 内蔵 Gemini プロファイルを初期状態に復元してメインへ戻す。
    // 追加登録されたプロファイルとキーは資産なので消さない。
    // ルーティング更新と同じキューに直列化し、キュー済みの変更がリセットを上書きしないようにする
    const seq = (routingSeqRef.current += 1);
    routingQueueRef.current = routingQueueRef.current.then(() =>
      window.api.resetLlmRouting().then(
        (settings) => {
          if (routingSeqRef.current === seq) applyLlmSettings(settings);
        },
        (err: unknown) => {
          if (routingSeqRef.current === seq) setToast(ipcErrorMessage(err));
        },
      ),
    );
  }, [applyLlmSettings, persistStoreBacked]);

  const currentMatch = matches[matchCursor];
  const searchCurrentInPage = currentMatch && currentMatch.pageIndex === pageIndex ? currentMatch.indexInPage : -1;
  const previewAnchor = pendingAnchor && doc && pendingAnchor.docId === doc.meta.id ? pendingAnchor.id : null;
  const lensVisible = lensOpen && doc !== null;
  const loomVisible = loomOpen && doc !== null;
  const frayVisible = frayOpen && doc !== null;
  const warpVisible = warpOpen && doc !== null;
  const tailorVisible = tailorOpen && doc !== null;
  const selvageVisible = selvageOpen && doc !== null;
  const llmSettings: LlmSettings = {
    geminiApiKeySet: aiKeySet,
    profiles: llmRouting.roster,
    mainId: llmRouting.main.id,
    fallbackIds: llmRouting.fallbacks.map((profile) => profile.id),
    storedCount: llm.llmProfiles.length,
  };

  return (
    <div
      className={`app${lensVisible || loomVisible || frayVisible || warpVisible || tailorVisible || selvageVisible ? " lens-open" : ""}`}
    >
      <aside className="left-pane">
        <div className="brand">
          <span className="brand-mark">
            <FileText size={15} aria-hidden="true" />
          </span>
          <span className="brand-word">
            Kongyo <span className="brand-word-accent">Spec</span>
          </span>
        </div>
        <SpecsSidebar
          specs={specs}
          activeId={activeId}
          onSelect={(id) => void openSpec(id)}
          onNew={() => setDialog({ kind: "new" })}
          onRename={(id) => {
            const spec = specs.find((item) => item.id === id);
            setDialog({ kind: "rename", id, current: spec?.title ?? "" });
          }}
          onDelete={(id) => {
            const spec = specs.find((item) => item.id === id);
            setDialog({ kind: "delete", id, title: spec?.title ?? "" });
          }}
        />
        <PagesNav pages={pages} activeIndex={pageIndex} onSelect={goToPage} />
      </aside>

      <main className="center-pane">
        <Toolbar
          specTitle={doc?.meta.title ?? ""}
          pageTitle={activePage?.title ?? ""}
          pageIndex={pageIndex}
          pageCount={pages.length}
          prevTitle={pages[pageIndex - 1]?.title ?? null}
          nextTitle={pages[pageIndex + 1]?.title ?? null}
          mode={mode}
          saving={saving}
          themePreference={themePreference}
          lensOpen={lensVisible}
          lensAvailable={doc !== null}
          loomOpen={loomVisible}
          warpOpen={warpVisible}
          frayOpen={frayVisible}
          tailorOpen={tailorVisible}
          selvageOpen={selvageVisible}
          frayCount={frayAutoCheck ? frayIssues.length : 0}
          pendingCount={pendingCount}
          onMode={setMode}
          onPrev={() => goToPage(pageIndex - 1)}
          onNext={() => goToPage(pageIndex + 1)}
          onSearch={openSearch}
          onToggleLens={toggleLens}
          onToggleLoom={toggleLoom}
          onToggleWarp={toggleWarp}
          onToggleFray={toggleFray}
          onToggleTailor={toggleTailor}
          onToggleSelvage={toggleSelvage}
          onJumpPending={jumpToPending}
          onCycleTheme={() => setThemePreference((prev) => nextPreference(prev))}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        {search.open ? (
          <SearchBar
            query={search.query}
            matchCount={matches.length}
            currentIndex={matches.length > 0 ? matchCursor : -1}
            inputRef={searchInputRef}
            onQuery={(value) => setSearch((prev) => ({ ...prev, query: value }))}
            onNext={() => stepMatch(1)}
            onPrev={() => stepMatch(-1)}
            onClose={closeSearch}
          />
        ) : null}

        <div className="content-area">
          {doc === null ? (
            <div className="empty-state">
              <div className="empty-icon">
                <FileText size={28} aria-hidden="true" />
              </div>
              <div>
                <p className="empty-title">仕様書がありません</p>
                <p className="empty-sub">新しい仕様書を作成して書き始めましょう。</p>
              </div>
              <button type="button" className="empty-action" onClick={() => setDialog({ kind: "new" })}>
                <Plus size={16} aria-hidden="true" />
                新規作成
                <kbd>{modKey}N</kbd>
              </button>
            </div>
          ) : mode === "preview" ? (
            <Preview
              pageContent={activePage?.content ?? ""}
              headingIds={pageHeadingIds[pageIndex] ?? []}
              linkDefs={linkDefs}
              scrollResetKey={`${doc.meta.id}:${pageIndex}`}
              theme={resolvedTheme}
              mermaidRenderer={mermaidRenderer}
              searchQuery={search.open ? search.query : ""}
              searchCurrentInPage={searchCurrentInPage}
              pendingAnchor={previewAnchor}
              onAnchorHandled={() => setPendingAnchor(null)}
              onHeadings={setHeadings}
              onActiveHeading={setActiveHeadingId}
              onLinkActivate={handleLinkActivate}
            />
          ) : mode === "split" ? (
            <div className="split-view" style={{ "--split-ratio": `${splitRatio * 100}%` } as React.CSSProperties}>
              <div className="split-pane">
                <Editor
                  value={doc.content}
                  theme={resolvedTheme}
                  jump={editorJump}
                  readOnly={selvageBusy}
                  onJumpHandled={() => setEditorJump(null)}
                  onSelectionChange={handleEditorSelection}
                  onScrollRatio={handleEditorScrollRatio}
                  onChange={(next) => setDoc((prev) => (prev ? { ...prev, content: next } : prev))}
                />
              </div>
              <div
                className="split-divider"
                role="separator"
                aria-orientation="vertical"
                aria-label="分割位置を調整"
                title="ドラッグで分割位置を調整"
                onPointerDown={handleDividerDown}
                onPointerMove={handleDividerMove}
                onPointerUp={handleDividerUp}
                onPointerCancel={handleDividerUp}
              />
              <div className="split-pane">
                <Preview
                  pageContent={doc.content}
                  headingIds={fullHeadingIds}
                  linkDefs=""
                  scrollResetKey={doc.meta.id}
                  theme={resolvedTheme}
                  mermaidRenderer={mermaidRenderer}
                  searchQuery={search.open ? search.query : ""}
                  searchCurrentInPage={searchCurrentInPage}
                  pendingAnchor={previewAnchor}
                  onAnchorHandled={() => setPendingAnchor(null)}
                  onHeadings={setHeadings}
                  onActiveHeading={setActiveHeadingId}
                  onLinkActivate={handleLinkActivate}
                  scrollSyncRef={previewSyncRef}
                />
              </div>
            </div>
          ) : (
            <Editor
              value={doc.content}
              theme={resolvedTheme}
              jump={editorJump}
              readOnly={selvageBusy}
              onJumpHandled={() => setEditorJump(null)}
              onSelectionChange={handleEditorSelection}
              onChange={(next) => setDoc((prev) => (prev ? { ...prev, content: next } : prev))}
            />
          )}
        </div>
      </main>

      {lensVisible && doc ? (
        <LensPanel
          state={lens}
          modelLabel={mainModelLabel}
          apiKeySet={aiReady}
          docContent={doc.content}
          onRun={runLens}
          onCancel={cancelLens}
          onClose={() => setLensOpen(false)}
          onApply={applyLensRewrite}
          onJump={jumpToLensExcerpt}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : loomVisible && doc ? (
        <LoomPanel
          session={loomSession}
          modelLabel={mainModelLabel}
          apiKeySet={aiReady}
          onUpdate={updateLoomSession}
          onWeave={runWeave}
          onRetry={retryWeave}
          onCancel={cancelWeave}
          onInsert={insertWoven}
          onPullSelection={pullSelectionToLoom}
          onClose={() => setLoomOpen(false)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : frayVisible && doc ? (
        <FrayPanel
          issues={frayIssues}
          audit={audit}
          modelLabel={mainModelLabel}
          apiKeySet={aiReady}
          docContent={doc.content}
          onRunAudit={runAudit}
          onCancelAudit={cancelAudit}
          onClose={() => setFrayOpen(false)}
          onJumpOffset={jumpToOffset}
          onJumpExcerpt={jumpToLensExcerpt}
          onApplyFix={applyFrayFixes}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : warpVisible && doc ? (
        <WarpPanel
          session={warpSession}
          modelLabel={mainModelLabel}
          apiKeySet={aiReady}
          theme={resolvedTheme}
          mermaidRenderer={mermaidRenderer}
          onUpdate={updateWarpSession}
          onRun={() => runWarp()}
          onCancel={cancelWarp}
          onInsert={insertWarpOutput}
          onPullSelection={pullSelectionToWarp}
          onRepairMermaid={repairWarpMermaid}
          onClose={() => setWarpOpen(false)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : tailorVisible && doc ? (
        <TailorPanel
          state={tailor}
          modelLabel={mainModelLabel}
          apiKeySet={aiReady}
          docContent={doc.content}
          pendingCount={pendingCount}
          planInDoc={planInDoc}
          onRun={runTailor}
          onCancel={cancelTailor}
          onClose={() => setTailorOpen(false)}
          onInsert={insertTailorPlan}
          onCopyPlan={copyTailorPlan}
          onCopyHandoff={copyHandoff}
          onJumpExcerpt={jumpToLensExcerpt}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : selvageVisible && doc ? (
        <SelvagePanel
          state={selvage}
          docContent={doc.content}
          busy={selvageBusy}
          onTake={takeManualSnapshot}
          onLoad={loadSnapshot}
          onRestore={restoreFromSnapshot}
          onCopy={copySnapshot}
          onDelete={removeSnapshot}
          onTogglePin={togglePinSnapshot}
          onReload={reloadSnapshots}
          onClose={() => setSelvageOpen(false)}
        />
      ) : (
        <Outline headings={headings} activeId={activeHeadingId} />
      )}

      {dialog ? (
        <Dialog
          key={`${dialog.kind}-${dialog.kind === "new" ? "new" : dialog.id}`}
          state={dialog}
          onCancel={() => setDialog(null)}
          onSubmitTitle={(title) => {
            if (dialog.kind === "new") handleCreate(title);
            else if (dialog.kind === "rename") handleRename(dialog.id, title);
          }}
          onConfirmDelete={(id) => handleDelete(id)}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsScreen
          theme={themePreference}
          appearance={appearance}
          resolvedTheme={resolvedTheme}
          mermaidRenderer={mermaidRenderer}
          defaultViewMode={defaultViewMode}
          autosaveDelay={autosaveDelay}
          toastDuration={toastDuration}
          restoreLastSpec={restoreLastSpec}
          frayAutoCheck={frayAutoCheck}
          frayKinds={frayKinds}
          autoSnapshotMinutes={autoSnapshotMinutes}
          maxSnapshotsPerSpec={maxSnapshotsPerSpec}
          assistTimeoutSec={assistTimeoutSec}
          llm={llmSettings}
          onChange={handleSettingChange}
          onSaveApiKey={handleSaveApiKey}
          onUpsertProfile={handleUpsertProfile}
          onDeleteProfile={handleDeleteProfile}
          onSetRouting={handleSetRouting}
          onReset={handleResetSettings}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      {dragActive ? <DropOverlay /> : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
