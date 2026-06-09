import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Plus } from "lucide-react";
import {
  DEFAULT_SETTINGS,
  llmProfileDisplayName,
  rendererLlmRouting,
  type MermaidRenderer,
  type RendererSettings,
  type UpsertLlmProfileInput,
} from "@shared/schemas/settings";
import { byUpdatedDesc, type SpecDocument, type SpecMeta } from "@shared/schemas/spec";
import {
  MAX_WEAVE_CONTEXT_CHARS,
  MAX_WEAVE_MATERIAL_CHARS,
  MAX_WEAVE_WOVEN_CHARS,
  type WeaveQa,
} from "@shared/schemas/assist";
import { Dialog, type DialogState } from "./components/Dialog";
import { DropOverlay } from "./components/DropOverlay";
import { Editor } from "./components/Editor";
import { LensPanel, type LensState } from "./components/LensPanel";
import { INITIAL_LOOM_SESSION, LoomPanel, type LoomSession, type WeaveKind } from "./components/LoomPanel";
import { Outline } from "./components/Outline";
import { PagesNav } from "./components/PagesNav";
import { Preview, type HeadingInfo } from "./components/Preview";
import { SearchBar } from "./components/SearchBar";
import { Settings as SettingsScreen, type LlmSettings, type SettingChange } from "./components/Settings";
import { SpecsSidebar } from "./components/SpecsSidebar";
import { Toolbar, type EditorMode } from "./components/Toolbar";
import { applyAppearance, type AppearanceSettings } from "./lib/appearance";
import { safeDecode } from "./lib/dom";
import { errorMessage, ipcErrorMessage } from "./lib/errors";
import { computePageHeadingIds } from "./lib/headings";
import { isMarkdownFile, MAX_IMPORT_BYTES, MAX_IMPORT_FILES, MAX_TOTAL_IMPORT_BYTES } from "./lib/import";
import { buildImportPlan, type DroppedFile } from "./lib/importPlan";
import { renderCached } from "./lib/markdown";
import { collectLinkDefinitions, splitPages } from "./lib/pages";
import { findPendingDecisions, nextPendingDecision } from "./lib/pending";
import { buildGlobalMatches, type GlobalMatch } from "./lib/search";
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

function lineStartOffset(content: string, line: number): number {
  let offset = 0;
  for (let current = 0; current < line; current++) {
    const newline = content.indexOf("\n", offset);
    if (newline === -1) return content.length;
    offset = newline + 1;
  }
  return offset;
}

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
    readingWidth: initialSettings.readingWidth,
  }));
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [lensOpen, setLensOpen] = useState(false);
  const [lens, setLens] = useState<LensState>({ status: "idle" });
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
        setMode("preview");
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
        const preferred = initialSettings.lastActiveSpecId;
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
    const handle = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(handle);
  }, [toast]);

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
    }, 600);
    return () => window.clearTimeout(handle);
  }, [doc, flushSave]);

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
      setMode("source");
      setEditorJump({ start, end: start + excerpt.length });
    },
    [pages],
  );

  const handleEditorSelection = useCallback((start: number, end: number): void => {
    selectionRef.current = { start, end };
  }, []);

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

  const pullSelectionToLoom = useCallback((): void => {
    const current = docRef.current;
    if (!current) return;
    if (modeRef.current !== "source") {
      setToast("Source モードで取り込みたい範囲を選択してください");
      return;
    }
    const selection = selectionRef.current;
    if (!selection || selection.start === selection.end) {
      setToast("選択範囲がありません。エディタで範囲を選択してください");
      return;
    }
    const text = current.content.slice(selection.start, selection.end);
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
  }, []);

  const insertWoven = useCallback((): void => {
    const current = docRef.current;
    if (!current) return;
    const session = loomSessionRef.current;
    const text = session.woven.trim();
    if (text.length === 0) return;
    const content = current.content;
    let notice: string | null = null;
    let replaceRanges: { start: number; end: number }[] | null = null;
    const targets = session.replaceTargets.filter((target) => target.length > 0);
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
      else notice = "置き換え対象を特定できないため、挿入に切り替えました";
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
        modeRef.current === "source"
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
    setLoomSession(INITIAL_LOOM_SESSION);
    setMode("source");
    setEditorJump({ start: jumpStart, end: jumpStart + text.length });
    setToast(
      notice ??
        (replaceRanges
          ? replaceRanges.length > 1
            ? `${replaceRanges.length} 箇所を 1 つに織り直しました`
            : "選択箇所を置き換えました"
          : "織り上がりを挿入しました"),
    );
  }, [pages, pageIndex]);

  const pendingCount = useMemo(() => findPendingDecisions(doc?.content ?? "").length, [doc?.content]);

  const jumpToPending = useCallback((): void => {
    const current = docRef.current;
    if (!current) return;
    const ranges = findPendingDecisions(current.content);
    const target = nextPendingDecision(ranges, selectionRef.current?.end ?? 0);
    if (!target) return;
    setMode("source");
    setEditorJump({ start: target.start, end: target.end });
  }, []);

  const toggleLens = useCallback((): void => {
    if (docRef.current === null) return;
    setLensOpen((prev) => {
      if (!prev) setLoomOpen(false);
      return !prev;
    });
  }, []);

  const toggleLoom = useCallback((): void => {
    if (docRef.current === null) return;
    setLoomOpen((prev) => {
      if (!prev) setLensOpen(false);
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
      } else if (event.key === "Escape" && search.open) {
        closeSearch();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openSearch, closeSearch, search.open, settingsOpen, toggleLens, toggleLoom]);

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

  const handleSettingChange = useCallback((change: SettingChange): void => {
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
      case "readingWidth":
        setAppearance((prev) => ({ ...prev, readingWidth: change.value }));
        void window.api.setSetting("readingWidth", change.value).catch(() => undefined);
        return;
      case "mermaidRenderer":
        setMermaidRenderer(change.value);
        void window.api.setSetting("mermaidRenderer", change.value).catch(() => undefined);
        return;
    }
  }, []);

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
      readingWidth: DEFAULT_SETTINGS.readingWidth,
    };
    setAppearance(defaults);
    setMermaidRenderer(DEFAULT_SETTINGS.mermaidRenderer);
    void window.api.setSetting("accent", defaults.accent).catch(() => undefined);
    void window.api.setSetting("editorFontSize", defaults.editorFontSize).catch(() => undefined);
    void window.api.setSetting("previewFontSize", defaults.previewFontSize).catch(() => undefined);
    void window.api.setSetting("readingWidth", defaults.readingWidth).catch(() => undefined);
    void window.api.setSetting("mermaidRenderer", DEFAULT_SETTINGS.mermaidRenderer).catch(() => undefined);
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
  }, [applyLlmSettings]);

  const currentMatch = matches[matchCursor];
  const searchCurrentInPage = currentMatch && currentMatch.pageIndex === pageIndex ? currentMatch.indexInPage : -1;
  const previewAnchor = pendingAnchor && doc && pendingAnchor.docId === doc.meta.id ? pendingAnchor.id : null;
  const lensVisible = lensOpen && doc !== null;
  const loomVisible = loomOpen && doc !== null;
  const llmSettings: LlmSettings = {
    geminiApiKeySet: aiKeySet,
    profiles: llmRouting.roster,
    mainId: llmRouting.main.id,
    fallbackIds: llmRouting.fallbacks.map((profile) => profile.id),
    storedCount: llm.llmProfiles.length,
  };

  return (
    <div className={`app${lensVisible || loomVisible ? " lens-open" : ""}`}>
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
        <PagesNav pages={pages} activeIndex={pageIndex} onSelect={setPageIndex} />
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
          pendingCount={pendingCount}
          onMode={setMode}
          onPrev={() => setPageIndex((index) => Math.max(0, index - 1))}
          onNext={() => setPageIndex((index) => Math.min(pages.length - 1, index + 1))}
          onSearch={openSearch}
          onToggleLens={toggleLens}
          onToggleLoom={toggleLoom}
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
          ) : (
            <Editor
              value={doc.content}
              theme={resolvedTheme}
              jump={editorJump}
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
          onInsert={insertWoven}
          onPullSelection={pullSelectionToLoom}
          onClose={() => setLoomOpen(false)}
          onOpenSettings={() => setSettingsOpen(true)}
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
