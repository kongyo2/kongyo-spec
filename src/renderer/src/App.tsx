import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Plus } from "lucide-react";
import { DEFAULT_SETTINGS, type Settings } from "@shared/schemas/settings";
import { byUpdatedDesc, type SpecDocument, type SpecMeta } from "@shared/schemas/spec";
import { Dialog, type DialogState } from "./components/Dialog";
import { DropOverlay } from "./components/DropOverlay";
import { Editor } from "./components/Editor";
import { Outline } from "./components/Outline";
import { PagesNav } from "./components/PagesNav";
import { Preview, type HeadingInfo } from "./components/Preview";
import { SearchBar } from "./components/SearchBar";
import { Settings as SettingsScreen, type SettingChange } from "./components/Settings";
import { SpecsSidebar } from "./components/SpecsSidebar";
import { Toolbar, type EditorMode } from "./components/Toolbar";
import { applyAppearance, type AppearanceSettings } from "./lib/appearance";
import { safeDecode } from "./lib/dom";
import { errorMessage } from "./lib/errors";
import { computePageHeadingIds } from "./lib/headings";
import { deriveTitle, isMarkdownFile, MAX_IMPORT_BYTES } from "./lib/import";
import { renderCached } from "./lib/markdown";
import { collectLinkDefinitions, splitPages } from "./lib/pages";
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
  initialSettings: Settings;
}

const modKey = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl ";

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
  const searchInputRef = useRef<HTMLInputElement>(null);

  const pages = useMemo(() => splitPages(doc?.content ?? ""), [doc?.content]);
  const pageHeadingIds = useMemo(() => computePageHeadingIds(pages.map((page) => page.content)), [pages]);
  const linkDefs = useMemo(() => collectLinkDefinitions(doc?.content ?? ""), [doc?.content]);
  const activePage = pages[pageIndex] ?? pages[0];

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

  const flushSave = useCallback((): Promise<boolean> => {
    if (flushPromiseRef.current) return flushPromiseRef.current;
    const run = (async (): Promise<boolean> => {
      try {
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
      } finally {
        flushPromiseRef.current = null;
        setSaving(false);
      }
    })();
    flushPromiseRef.current = run;
    return run;
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
      } else if (event.key === "Escape" && search.open) {
        closeSearch();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openSearch, closeSearch, search.open, settingsOpen]);

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
      void (async () => {
        const imported: SpecMeta[] = [];
        for (const file of markdownFiles) {
          if (file.size > MAX_IMPORT_BYTES) {
            setToast(`ファイルが大きすぎます: ${file.name}`);
            continue;
          }
          try {
            // eslint-disable-next-line no-await-in-loop -- sequential imports keep ids and ordering stable
            const text = await file.text();
            // eslint-disable-next-line no-await-in-loop -- part of the same serialized import loop
            const meta = await window.api.importSpec(deriveTitle(file.name), text);
            imported.push(meta);
          } catch (err) {
            setToast(`「${file.name}」の読み込みに失敗しました: ${errorMessage(err)}`);
          }
        }
        if (imported.length === 0) return;
        setSpecs((prev) => [...imported, ...prev].sort(byUpdatedDesc));
        const last = imported[imported.length - 1];
        if (last) await openSpec(last.id);
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
    void window.api.setSetting("accent", defaults.accent).catch(() => undefined);
    void window.api.setSetting("editorFontSize", defaults.editorFontSize).catch(() => undefined);
    void window.api.setSetting("previewFontSize", defaults.previewFontSize).catch(() => undefined);
    void window.api.setSetting("readingWidth", defaults.readingWidth).catch(() => undefined);
  }, []);

  const currentMatch = matches[matchCursor];
  const searchCurrentInPage = currentMatch && currentMatch.pageIndex === pageIndex ? currentMatch.indexInPage : -1;
  const previewAnchor = pendingAnchor && doc && pendingAnchor.docId === doc.meta.id ? pendingAnchor.id : null;

  return (
    <div className="app">
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
          onMode={setMode}
          onPrev={() => setPageIndex((index) => Math.max(0, index - 1))}
          onNext={() => setPageIndex((index) => Math.min(pages.length - 1, index + 1))}
          onSearch={openSearch}
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
              onChange={(next) => setDoc((prev) => (prev ? { ...prev, content: next } : prev))}
            />
          )}
        </div>
      </main>

      <Outline headings={headings} activeId={activeHeadingId} />

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
          onChange={handleSettingChange}
          onReset={handleResetSettings}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      {dragActive ? <DropOverlay /> : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
