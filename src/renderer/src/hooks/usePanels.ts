import { type RefObject, useCallback, useState } from "react";
import type { SpecDocument } from "@shared/schemas/spec";

export type PanelId = "lens" | "loom" | "fray" | "warp" | "prism" | "tailor" | "selvage";

export interface PanelsController {
  active: PanelId | null;
  toggle: (id: PanelId) => void;
  close: (id: PanelId) => void;
}

export function usePanels(docRef: RefObject<SpecDocument | null>): PanelsController {
  const [active, setActive] = useState<PanelId | null>(null);

  const toggle = useCallback(
    (id: PanelId): void => {
      if (docRef.current === null) return;
      setActive((prev) => (prev === id ? null : id));
    },
    [docRef],
  );

  const close = useCallback((id: PanelId): void => {
    setActive((prev) => (prev === id ? null : prev));
  }, []);

  return { active, toggle, close };
}
