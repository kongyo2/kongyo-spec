import { useCallback, useRef, useState } from "react";
import { FileText, Plus } from "lucide-react";
import { getAutocompleteModelById } from "@shared/autocomplete";
import { DEFAULT_SETTINGS, type RendererSettings, SPLIT_RATIO } from "@shared/schemas/settings";
import { Dialog, type DialogState } from "./components/Dialog";
import { DropOverlay } from "./components/DropOverlay";
import { Editor } from "./components/Editor";
import { FrayPanel } from "./components/FrayPanel";
import { LensPanel } from "./components/LensPanel";
import { LoomPanel } from "./components/LoomPanel";
import { Outline } from "./components/Outline";
import { PagesNav } from "./components/PagesNav";
import { Preview } from "./components/Preview";
import { PrismPanel } from "./components/PrismPanel";
import { SearchBar } from "./components/SearchBar";
import { SelvagePanel } from "./components/SelvagePanel";
import { Settings as SettingsScreen, type LlmSettings, type SettingChange } from "./components/Settings";
import { SpecsSidebar } from "./components/SpecsSidebar";
import { TableEditor } from "./components/TableEditor";
import { TailorPanel } from "./components/TailorPanel";
import { Toolbar } from "./components/Toolbar";
import { WarpPanel } from "./components/WarpPanel";
import { useFileDrop } from "./lib/useFileDrop";
import { useAppShortcuts } from "./hooks/useAppShortcuts";
import { useEditorSettings } from "./hooks/useEditorSettings";
import { useFray } from "./hooks/useFray";
import { useLens } from "./hooks/useLens";
import { useLlmSettings } from "./hooks/useLlmSettings";
import { useLoom } from "./hooks/useLoom";
import { usePanels } from "./hooks/usePanels";
import { usePrism } from "./hooks/usePrism";
import { useSearch } from "./hooks/useSearch";
import { useSelvage } from "./hooks/useSelvage";
import { useSpecWorkspace } from "./hooks/useSpecWorkspace";
import { useTableEditor } from "./hooks/useTableEditor";
import { useTailor } from "./hooks/useTailor";
import { useTheme } from "./hooks/useTheme";
import { useToast } from "./hooks/useToast";
import { useWarp } from "./hooks/useWarp";

interface AppProps {
  initialSettings: RendererSettings;
}

const modKey = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl ";

export function App({ initialSettings }: AppProps): React.ReactElement {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeDialog = useCallback(() => setDialog(null), []);
  const openNewDialog = useCallback(() => setDialog({ kind: "new" }), []);

  const notifyRef = useRef<(message: string) => void>(() => undefined);
  const notify = useCallback((message: string) => notifyRef.current(message), []);

  const theme = useTheme(initialSettings.theme);
  const editorSettings = useEditorSettings(initialSettings, notify, theme.resolved);
  const toast = useToast(editorSettings.toastDuration);
  notifyRef.current = toast.notify;
  const llm = useLlmSettings(initialSettings, notify);

  const workspace = useSpecWorkspace({
    notify,
    autosaveDelay: editorSettings.autosaveDelay,
    defaultViewMode: editorSettings.defaultViewMode,
    restoreLastSpec: initialSettings.restoreLastSpec,
    lastActiveSpecId: initialSettings.lastActiveSpecId,
    closeDialog,
  });
  const {
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
  } = workspace;

  const panels = usePanels(editing.docRef);
  const lens = useLens(editing, llm.mainModelLabel, activeId);
  const fray = useFray({
    editing,
    modelLabel: llm.mainModelLabel,
    activeId,
    doc,
    specs,
    frayOpen: panels.active === "fray",
    frayAutoCheck: editorSettings.frayAutoCheck,
    frayKinds: editorSettings.frayKinds,
  });
  const tailor = useTailor(editing, llm.mainModelLabel, activeId);
  const loom = useLoom(editing, activeId);
  const warp = useWarp(editing, activeId);
  const prism = usePrism(editing, activeId);
  const selvage = useSelvage({
    persistence,
    notify,
    activeId,
    open: panels.active === "selvage",
    docUpdatedAt: doc?.meta.updatedAt,
  });
  const search = useSearch(editing, doc?.content ?? "");
  const tableEditor = useTableEditor(editing, activePage);

  useAppShortcuts({
    settingsOpen,
    setSettingsOpen,
    searchOpen: search.search.open,
    openSearch: search.open,
    closeSearch: search.close,
    openNewDialog,
    togglePanel: panels.toggle,
    docRef: editing.docRef,
    setMode,
  });

  const dragActive = useFileDrop(importFiles);

  const setThemePreference = theme.setPreference;
  const changeEditorSetting = editorSettings.change;
  const handleSettingChange = useCallback(
    (change: SettingChange): void => {
      if (change.key === "theme") setThemePreference(change.value);
      else changeEditorSetting(change);
    },
    [setThemePreference, changeEditorSetting],
  );

  const resetEditorSettings = editorSettings.reset;
  const resetLlm = llm.reset;
  const handleResetSettings = useCallback((): void => {
    setThemePreference(DEFAULT_SETTINGS.theme);
    resetEditorSettings();
    resetLlm();
  }, [setThemePreference, resetEditorSettings, resetLlm]);

  const splitDragRef = useRef<DOMRect | null>(null);
  const setSplitRatio = editorSettings.setSplitRatio;
  const splitRatioRef = editorSettings.splitRatioRef;
  const handleDividerDown = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    const container = event.currentTarget.parentElement;
    if (!container) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    splitDragRef.current = container.getBoundingClientRect();
  }, []);
  const handleDividerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      const rect = splitDragRef.current;
      if (!rect || rect.width <= 0) return;
      const ratio = (event.clientX - rect.left) / rect.width;
      setSplitRatio(Math.min(SPLIT_RATIO.max, Math.max(SPLIT_RATIO.min, ratio)));
    },
    [setSplitRatio],
  );
  const handleDividerUp = useCallback((): void => {
    if (splitDragRef.current === null) return;
    splitDragRef.current = null;
    void window.api.setSetting("splitRatio", splitRatioRef.current).catch(() => undefined);
  }, [splitRatioRef]);

  const autocompleteProviderId = getAutocompleteModelById(editorSettings.autocompleteModelId).providerId;
  const autocompleteKeySet = autocompleteProviderId === "mistral" ? llm.mistralKeySet : llm.inceptionKeySet;
  const autocompleteActive = editorSettings.autocompleteEnabled && autocompleteKeySet;

  const active = panels.active;
  const lensVisible = active === "lens" && doc !== null;
  const loomVisible = active === "loom" && doc !== null;
  const frayVisible = active === "fray" && doc !== null;
  const warpVisible = active === "warp" && doc !== null;
  const prismVisible = active === "prism" && doc !== null;
  const tailorVisible = active === "tailor" && doc !== null;
  const selvageVisible = active === "selvage" && doc !== null;
  const dockOpen = active !== null && doc !== null;

  const previewAnchor = pendingAnchor && doc && pendingAnchor.docId === doc.meta.id ? pendingAnchor.id : null;

  const llmSettings: LlmSettings = {
    geminiApiKeySet: llm.aiKeySet,
    profiles: llm.roster,
    mainId: llm.mainId,
    fallbackIds: llm.fallbackIds,
    storedCount: llm.storedCount,
    autocompleteEnabled: editorSettings.autocompleteEnabled,
    autocompleteModelId: editorSettings.autocompleteModelId,
    mistralApiKeySet: llm.mistralKeySet,
    inceptionApiKeySet: llm.inceptionKeySet,
  };

  return (
    <div className={`app${dockOpen ? " lens-open" : ""}`}>
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
          onNew={openNewDialog}
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
          themePreference={theme.preference}
          lensOpen={lensVisible}
          lensAvailable={doc !== null}
          loomOpen={loomVisible}
          warpOpen={warpVisible}
          prismOpen={prismVisible}
          frayOpen={frayVisible}
          tailorOpen={tailorVisible}
          selvageOpen={selvageVisible}
          frayCount={editorSettings.frayAutoCheck ? fray.issues.length : 0}
          pendingCount={pendingCount}
          onMode={setMode}
          onPrev={() => goToPage(pageIndex - 1)}
          onNext={() => goToPage(pageIndex + 1)}
          onSearch={search.open}
          onToggleLens={() => panels.toggle("lens")}
          onToggleLoom={() => panels.toggle("loom")}
          onToggleWarp={() => panels.toggle("warp")}
          onTogglePrism={() => panels.toggle("prism")}
          onToggleFray={() => panels.toggle("fray")}
          onToggleTailor={() => panels.toggle("tailor")}
          onToggleSelvage={() => panels.toggle("selvage")}
          onJumpPending={jumpToPending}
          onCycleTheme={theme.cycle}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        {search.search.open ? (
          <SearchBar
            query={search.search.query}
            replace={search.search.replace}
            showReplace={search.search.showReplace}
            caseSensitive={search.search.caseSensitive}
            wholeWord={search.search.wholeWord}
            regex={search.search.regex}
            regexInvalid={search.regexInvalid}
            matchCount={search.matchCount}
            currentIndex={search.currentIndex}
            inputRef={search.inputRef}
            onQuery={search.setQuery}
            onReplaceChange={search.setReplace}
            onToggleReplace={search.toggleReplace}
            onToggleCase={search.toggleCase}
            onToggleWord={search.toggleWord}
            onToggleRegex={search.toggleRegex}
            onNext={search.next}
            onPrev={search.prev}
            onReplaceOne={search.replaceOne}
            onReplaceAll={search.replaceAll}
            onClose={search.close}
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
              <button type="button" className="empty-action" onClick={openNewDialog}>
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
              theme={theme.resolved}
              mermaidRenderer={editorSettings.mermaidRenderer}
              searchQuery={search.previewQuery}
              searchCurrentInPage={-1}
              pendingAnchor={previewAnchor}
              onAnchorHandled={clearAnchor}
              onHeadings={setHeadings}
              onActiveHeading={setActiveHeadingId}
              onLinkActivate={handleLinkActivate}
              onTableEdit={tableEditor.request}
            />
          ) : mode === "split" ? (
            <div
              className="split-view"
              style={{ "--split-ratio": `${editorSettings.splitRatio * 100}%` } as React.CSSProperties}
            >
              <div className="split-pane">
                <Editor
                  value={doc.content}
                  theme={theme.resolved}
                  jump={editorJump}
                  readOnly={selvage.busy}
                  searchHighlight={search.highlight}
                  onNotice={notify}
                  onJumpHandled={clearJump}
                  onSelectionChange={handleEditorSelection}
                  onScrollRatio={handleEditorScrollRatio}
                  onChange={setContent}
                  autocompleteEnabled={autocompleteActive}
                  autocompleteModelId={editorSettings.autocompleteModelId}
                  autocompleteDocId={doc.meta.id}
                  onAutocompleteNotice={notify}
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
                  theme={theme.resolved}
                  mermaidRenderer={editorSettings.mermaidRenderer}
                  searchQuery={search.previewQuery}
                  searchCurrentInPage={-1}
                  pendingAnchor={previewAnchor}
                  onAnchorHandled={clearAnchor}
                  onHeadings={setHeadings}
                  onActiveHeading={setActiveHeadingId}
                  onLinkActivate={handleLinkActivate}
                  onTableEdit={tableEditor.request}
                  scrollSyncRef={previewSyncRef}
                />
              </div>
            </div>
          ) : (
            <Editor
              value={doc.content}
              theme={theme.resolved}
              jump={editorJump}
              readOnly={selvage.busy}
              searchHighlight={search.highlight}
              onNotice={notify}
              onJumpHandled={clearJump}
              onSelectionChange={handleEditorSelection}
              onChange={setContent}
              autocompleteEnabled={autocompleteActive}
              autocompleteModelId={editorSettings.autocompleteModelId}
              autocompleteDocId={doc.meta.id}
              onAutocompleteNotice={notify}
            />
          )}
        </div>
      </main>

      {lensVisible && doc ? (
        <LensPanel
          state={lens.state}
          modelLabel={llm.mainModelLabel}
          apiKeySet={llm.aiReady}
          docContent={doc.content}
          onRun={lens.run}
          onCancel={lens.cancel}
          onClose={() => panels.close("lens")}
          onApply={lens.applyRewrite}
          onJump={editing.revealExcerpt}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : loomVisible && doc ? (
        <LoomPanel
          session={loom.session}
          modelLabel={llm.mainModelLabel}
          apiKeySet={llm.aiReady}
          onUpdate={loom.update}
          onWeave={loom.weave}
          onRetry={loom.retry}
          onCancel={loom.cancel}
          onInsert={loom.insert}
          onPullSelection={loom.pullSelection}
          onClose={() => panels.close("loom")}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : frayVisible && doc ? (
        <FrayPanel
          issues={fray.issues}
          audit={fray.audit}
          modelLabel={llm.mainModelLabel}
          apiKeySet={llm.aiReady}
          docContent={doc.content}
          onRunAudit={fray.runAudit}
          onCancelAudit={fray.cancelAudit}
          onClose={() => panels.close("fray")}
          onJumpOffset={editing.revealOffset}
          onJumpExcerpt={editing.revealExcerpt}
          onApplyFix={fray.applyFixes}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : warpVisible && doc ? (
        <WarpPanel
          session={warp.session}
          modelLabel={llm.mainModelLabel}
          apiKeySet={llm.aiReady}
          theme={theme.resolved}
          mermaidRenderer={editorSettings.mermaidRenderer}
          onUpdate={warp.update}
          onRun={() => warp.run()}
          onCancel={warp.cancel}
          onInsert={warp.insert}
          onPullSelection={warp.pullSelection}
          onRepairMermaid={warp.repairMermaid}
          onClose={() => panels.close("warp")}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : prismVisible && doc ? (
        <PrismPanel
          session={prism.session}
          modelLabel={llm.mainModelLabel}
          apiKeySet={llm.aiReady}
          onUpdate={prism.update}
          onRun={prism.run}
          onCancel={prism.cancel}
          onAdopt={prism.adopt}
          onCopy={prism.copy}
          onPullSelection={prism.pullSelection}
          onClose={() => panels.close("prism")}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : tailorVisible && doc ? (
        <TailorPanel
          state={tailor.state}
          modelLabel={llm.mainModelLabel}
          apiKeySet={llm.aiReady}
          docContent={doc.content}
          pendingCount={pendingCount}
          planInDoc={planInDoc}
          onRun={tailor.run}
          onCancel={tailor.cancel}
          onClose={() => panels.close("tailor")}
          onInsert={tailor.insertPlan}
          onCopyPlan={tailor.copyPlan}
          onCopyHandoff={tailor.copyHandoff}
          onJumpExcerpt={editing.revealExcerpt}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : selvageVisible && doc ? (
        <SelvagePanel
          state={selvage.state}
          docContent={doc.content}
          busy={selvage.busy}
          onTake={selvage.take}
          onLoad={selvage.load}
          onRestore={selvage.restore}
          onCopy={selvage.copy}
          onDelete={selvage.remove}
          onTogglePin={selvage.togglePin}
          onReload={selvage.reload}
          onClose={() => panels.close("selvage")}
        />
      ) : (
        <Outline headings={headings} activeId={activeHeadingId} />
      )}

      {dialog ? (
        <Dialog
          key={`${dialog.kind}-${dialog.kind === "new" ? "new" : dialog.id}`}
          state={dialog}
          onCancel={closeDialog}
          onSubmitTitle={(title) => {
            if (dialog.kind === "new") {
              closeDialog();
              createSpec(title);
            } else if (dialog.kind === "rename") {
              closeDialog();
              renameSpec(dialog.id, title);
            }
          }}
          onConfirmDelete={(id) => deleteSpec(id)}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsScreen
          theme={theme.preference}
          appearance={editorSettings.appearance}
          resolvedTheme={theme.resolved}
          mermaidRenderer={editorSettings.mermaidRenderer}
          defaultViewMode={editorSettings.defaultViewMode}
          autosaveDelay={editorSettings.autosaveDelay}
          toastDuration={editorSettings.toastDuration}
          restoreLastSpec={editorSettings.restoreLastSpec}
          frayAutoCheck={editorSettings.frayAutoCheck}
          frayKinds={editorSettings.frayKinds}
          autoSnapshotMinutes={editorSettings.autoSnapshotMinutes}
          maxSnapshotsPerSpec={editorSettings.maxSnapshotsPerSpec}
          assistTimeoutSec={editorSettings.assistTimeoutSec}
          llm={llmSettings}
          onChange={handleSettingChange}
          onSaveApiKey={llm.saveApiKey}
          onSaveAutocompleteKey={llm.saveAutocompleteKey}
          onUpsertProfile={llm.upsertProfile}
          onDeleteProfile={llm.deleteProfile}
          onSetRouting={llm.setRouting}
          onReset={handleResetSettings}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      {tableEditor.state ? (
        <TableEditor
          key={`${tableEditor.state.specId}:${tableEditor.state.absStartLine}`}
          model={tableEditor.state.model}
          initialFocus={tableEditor.state.focus}
          onApply={tableEditor.apply}
          onCancel={tableEditor.cancel}
        />
      ) : null}

      {dragActive ? <DropOverlay /> : null}

      {toast.toast ? <div className="toast">{toast.toast}</div> : null}
    </div>
  );
}
