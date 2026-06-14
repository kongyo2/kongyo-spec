import { type Dispatch, type RefObject, type SetStateAction, useEffect } from "react";
import type { SpecDocument } from "@shared/schemas/spec";
import type { EditorMode } from "../components/Toolbar";
import type { PanelId } from "./usePanels";

export interface ShortcutParams {
  settingsOpen: boolean;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  searchOpen: boolean;
  openSearch: () => void;
  closeSearch: () => void;
  openNewDialog: () => void;
  togglePanel: (id: PanelId) => void;
  docRef: RefObject<SpecDocument | null>;
  setMode: Dispatch<SetStateAction<EditorMode>>;
}

export function useAppShortcuts({
  settingsOpen,
  setSettingsOpen,
  searchOpen,
  openSearch,
  closeSearch,
  openNewDialog,
  togglePanel,
  docRef,
  setMode,
}: ShortcutParams): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
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
        openNewDialog();
      } else if (mod && event.key.toLowerCase() === "l") {
        event.preventDefault();
        togglePanel("lens");
      } else if (mod && event.key.toLowerCase() === "j") {
        event.preventDefault();
        togglePanel("loom");
      } else if (mod && event.key.toLowerCase() === "e") {
        event.preventDefault();
        togglePanel("warp");
      } else if (mod && event.key.toLowerCase() === "g") {
        event.preventDefault();
        togglePanel("fray");
      } else if (mod && event.key.toLowerCase() === "i") {
        event.preventDefault();
        togglePanel("tailor");
      } else if (mod && event.key.toLowerCase() === "h") {
        event.preventDefault();
        togglePanel("selvage");
      } else if (mod && event.key.toLowerCase() === "u") {
        event.preventDefault();
        togglePanel("prism");
      } else if (mod && event.key === "\\") {
        event.preventDefault();
        if (docRef.current !== null) setMode((prev) => (prev === "split" ? "preview" : "split"));
      } else if (event.key === "Escape" && searchOpen) {
        closeSearch();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen, setSettingsOpen, searchOpen, openSearch, closeSearch, openNewDialog, togglePanel, docRef, setMode]);
}
