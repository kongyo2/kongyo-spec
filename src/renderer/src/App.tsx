import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SpecDocument, SpecMeta } from "@shared/schemas/spec";
import { Dialog, type DialogState } from "./components/Dialog";
import { Editor } from "./components/Editor";
import { Outline } from "./components/Outline";
import { PagesNav } from "./components/PagesNav";
import { Preview, type HeadingInfo } from "./components/Preview";
import { SearchBar } from "./components/SearchBar";
import { SpecsSidebar } from "./components/SpecsSidebar";
import { Toolbar, type EditorMode } from "./components/Toolbar";
import { computePageHeadingIds } from "./lib/headings";
import { renderCached } from "./lib/markdown";
import { collectLinkDefinitions, splitPages } from "./lib/pages";
import { buildGlobalMatches, type GlobalMatch } from "./lib/search";
import {
  applyTheme,
  loadThemePreference,
  nextPreference,
  resolveTheme,
  saveThemePreference,
  systemTheme,
  type ResolvedTheme,
  type ThemePreference,
} from "./lib/theme";

interface SearchUiState {
  open: boolean;
  query: string;
}

interface PendingAnchor {
  docId: string;
  id: string;
}

function byUpdatedDesc(a: SpecMeta, b: SpecMeta): number {
  return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function App(): React.ReactElement {
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

  const [themePreference, setThemePreference] = useState<ThemePreference>(() => loadThemePreference());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(loadThemePreference()));

  const loadedContentRef = useRef("");
  const pendingSaveRef = useRef<{ id: string; content: string } | null>(null);
  const openRequestRef = useRef(0);
  const pendingOpenIdRef = useRef<string | null>(null);
  const flushPromiseRef = useRef<Promise<boolean> | null>(null);
  const docRef = useRef<SpecDocument | null>(null);
  docRef.current = doc;
  const specsRef = useRef<SpecMeta[]>([]);
  specsRef.current = specs;
  const searchInputRef = useRef<HTMLInputElement>(null);

  const pages = useMemo(() => splitPages(doc?.content ?? ""), [doc?.content]);
  const pageHeadingIds = useMemo(() => computePageHeadingIds(pages.map((page) => page.content)), [pages]);
  const linkDefs = useMemo(() => collectLinkDefinitions(doc?.content ?? ""), [doc?.content]);
  const activePage = pages[pageIndex] ?? pages[0];

  useEffect(() => {
    const resolved = resolveTheme(themePreference);
    setResolvedTheme(resolved);
    applyTheme(resolved);
    saveThemePreference(themePreference);
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

  const flushSave = useCallback((): Promise<boolean> => {
    if (flushPromiseRef.current) return flushPromiseRef.current;
    const run = (async (): Promise<boolean> => {
      try {
        while (pendingSaveRef.current) {
          const pending = pendingSaveRef.current;
          try {
            const meta = await window.api.saveSpec(pending.id, pending.content);
            if (pendingSaveRef.current === pending) pendingSaveRef.current = null;
            if (docRef.current && docRef.current.meta.id === pending.id) {
              loadedContentRef.current = pending.content;
            }
            setSpecs((prev) => prev.map((spec) => (spec.id === meta.id ? meta : spec)).sort(byUpdatedDesc));
            setDoc((prev) => (prev && prev.meta.id === meta.id ? { ...prev, meta } : prev));
          } catch (err) {
            setToast(`保存に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
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
          setToast(`仕様書の読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`);
          return false;
        }
        if (token !== openRequestRef.current) return false;
        const current = docRef.current;
        if (current && current.content !== loadedContentRef.current) {
          pendingSaveRef.current = { id: current.meta.id, content: current.content };
          if (!(await flushSave())) return false;
          if (token !== openRequestRef.current) return false;
        }
        loadedContentRef.current = document.content;
        setActiveId(id);
        setDoc(document);
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
        const first = list[0];
        if (first && docRef.current === null && pendingOpenIdRef.current === null) await openSpec(first.id);
      } catch (err) {
        setToast(`仕様書の読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`);
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
  }, [openSearch, closeSearch, search.open]);

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
        setToast(`リンクを開けませんでした: ${err instanceof Error ? err.message : String(err)}`);
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
      const path = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
      const fragment = hashIndex >= 0 ? safeDecode(href.slice(hashIndex + 1)) : null;

      if (path.length === 0) {
        if (fragment && doc) setPendingAnchor({ docId: doc.meta.id, id: fragment });
        return;
      }

      const fileName = safeDecode(path).replace(/^\.\//, "").replace(/\/+$/, "");
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
    void (async () => {
      try {
        const meta = await window.api.createSpec(title);
        setSpecs((prev) => [meta, ...prev]);
        if (openRequestRef.current !== navToken) return;
        const opened = await openSpec(meta.id);
        if (opened) setMode("source");
      } catch (err) {
        setToast(`作成に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
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
        setToast(`変更に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  };

  const handleDelete = (id: string): void => {
    void (async () => {
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
        setToast(`削除に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  };

  const currentMatch = matches[matchCursor];
  const searchCurrentInPage = currentMatch && currentMatch.pageIndex === pageIndex ? currentMatch.indexInPage : -1;
  const previewAnchor = pendingAnchor && doc && pendingAnchor.docId === doc.meta.id ? pendingAnchor.id : null;

  return (
    <div className="app">
      <aside className="left-pane">
        <div className="brand">🗎 Kongyo Spec</div>
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
              <p>仕様書が選択されていません。</p>
              <button type="button" onClick={() => setDialog({ kind: "new" })}>
                + 新規作成
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

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
