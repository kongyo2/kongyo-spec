import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import {
  type AutosaveDelay,
  DEFAULT_SETTINGS,
  type EditorViewMode,
  type MermaidRenderer,
  type RendererSettings,
  type ToastDuration,
} from "@shared/schemas/settings";
import { applyAppearance, type AppearanceSettings } from "../lib/appearance";
import type { ResolvedTheme } from "../lib/theme";
import type { SettingChange } from "../components/Settings";

export interface EditorSettings {
  appearance: AppearanceSettings;
  mermaidRenderer: MermaidRenderer;
  defaultViewMode: EditorViewMode;
  splitRatio: number;
  splitRatioRef: RefObject<number>;
  setSplitRatio: (ratio: number) => void;
  autosaveDelay: AutosaveDelay;
  toastDuration: ToastDuration;
  restoreLastSpec: boolean;
  autoSnapshotMinutes: number;
  maxSnapshotsPerSpec: number;
  assistTimeoutSec: number;
  autocompleteEnabled: boolean;
  autocompleteModelId: string;
  change: (change: SettingChange) => void;
  reset: () => void;
}

export function useEditorSettings(
  initial: RendererSettings,
  notify: (message: string) => void,
  resolvedTheme: ResolvedTheme,
): EditorSettings {
  const [appearance, setAppearance] = useState<AppearanceSettings>(() => ({
    accent: initial.accent,
    editorFontSize: initial.editorFontSize,
    previewFontSize: initial.previewFontSize,
    editorLineHeight: initial.editorLineHeight,
    previewLineHeight: initial.previewLineHeight,
    readingWidth: initial.readingWidth,
  }));
  const [mermaidRenderer, setMermaidRenderer] = useState<MermaidRenderer>(initial.mermaidRenderer);
  const [defaultViewMode, setDefaultViewMode] = useState<EditorViewMode>(initial.defaultViewMode);
  const [splitRatio, setSplitRatio] = useState(initial.splitRatio);
  const splitRatioRef = useRef(splitRatio);
  splitRatioRef.current = splitRatio;
  const [autosaveDelay, setAutosaveDelay] = useState<AutosaveDelay>(initial.autosaveDelay);
  const [toastDuration, setToastDuration] = useState<ToastDuration>(initial.toastDuration);
  const [restoreLastSpec, setRestoreLastSpec] = useState(initial.restoreLastSpec);
  const [autoSnapshotMinutes, setAutoSnapshotMinutes] = useState(initial.autoSnapshotMinutes);
  const [maxSnapshotsPerSpec, setMaxSnapshotsPerSpec] = useState(initial.maxSnapshotsPerSpec);
  const [assistTimeoutSec, setAssistTimeoutSec] = useState(initial.assistTimeoutSec);
  const [autocompleteEnabled, setAutocompleteEnabled] = useState(initial.autocompleteEnabled);
  const [autocompleteModelId, setAutocompleteModelId] = useState(initial.autocompleteModelId);

  useEffect(() => {
    applyAppearance(appearance, resolvedTheme);
  }, [appearance, resolvedTheme]);

  const persistStoreBacked = useCallback(
    (write: () => Promise<boolean>, revert: (settings: RendererSettings) => void): void => {
      write().then(
        (persisted) => {
          if (persisted) return;
          notify("設定ストアが利用できないため保存できませんでした");
          window.api.getSettings().then(revert, () => undefined);
        },
        () => undefined,
      );
    },
    [notify],
  );

  const applyChange = useCallback(
    (change: SettingChange): void => {
      switch (change.key) {
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
        case "autocompleteEnabled": {
          const value = change.value;
          setAutocompleteEnabled(value);
          persistStoreBacked(
            () => window.api.setSetting("autocompleteEnabled", value),
            (settings) => setAutocompleteEnabled(settings.autocompleteEnabled),
          );
          return;
        }
        case "autocompleteModelId": {
          const value = change.value;
          setAutocompleteModelId(value);
          persistStoreBacked(
            () => window.api.setSetting("autocompleteModelId", value),
            (settings) => setAutocompleteModelId(settings.autocompleteModelId),
          );
          return;
        }
      }
    },
    [persistStoreBacked],
  );

  const reset = useCallback((): void => {
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
    setRestoreLastSpec(DEFAULT_SETTINGS.restoreLastSpec);
    setAutoSnapshotMinutes(DEFAULT_SETTINGS.autoSnapshotMinutes);
    setMaxSnapshotsPerSpec(DEFAULT_SETTINGS.maxSnapshotsPerSpec);
    setAssistTimeoutSec(DEFAULT_SETTINGS.assistTimeoutSec);
    setAutocompleteEnabled(DEFAULT_SETTINGS.autocompleteEnabled);
    setAutocompleteModelId(DEFAULT_SETTINGS.autocompleteModelId);
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
    persistStoreBacked(
      () => window.api.setSetting("autocompleteEnabled", DEFAULT_SETTINGS.autocompleteEnabled),
      (settings) => setAutocompleteEnabled(settings.autocompleteEnabled),
    );
    persistStoreBacked(
      () => window.api.setSetting("autocompleteModelId", DEFAULT_SETTINGS.autocompleteModelId),
      (settings) => setAutocompleteModelId(settings.autocompleteModelId),
    );
  }, [persistStoreBacked]);

  return {
    appearance,
    mermaidRenderer,
    defaultViewMode,
    splitRatio,
    splitRatioRef,
    setSplitRatio,
    autosaveDelay,
    toastDuration,
    restoreLastSpec,
    autoSnapshotMinutes,
    maxSnapshotsPerSpec,
    assistTimeoutSec,
    autocompleteEnabled,
    autocompleteModelId,
    change: applyChange,
    reset,
  };
}
