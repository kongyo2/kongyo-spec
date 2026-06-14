import { useCallback, useRef, useState } from "react";
import type { TableEditRequest } from "../components/Preview";
import { parseTable, serializeTable, type TableModel } from "../lib/table";
import { lineRangeOffsets } from "../lib/text";
import type { VirtualPage } from "../lib/pages";
import type { EditingApi } from "./useSpecWorkspace";

interface TableEditState {
  specId: string;
  absStartLine: number;
  absEndLineExclusive: number;
  model: TableModel;
  focus: { row: number; col: number } | null;
}

export interface TableEditorController {
  state: TableEditState | null;
  request: (request: TableEditRequest) => void;
  apply: (model: TableModel) => void;
  cancel: () => void;
}

export function useTableEditor(editing: EditingApi, activePage: VirtualPage | undefined): TableEditorController {
  const { docRef, modeRef, notify, writeContent } = editing;
  const [state, setState] = useState<TableEditState | null>(null);
  const stateRef = useRef<TableEditState | null>(null);
  stateRef.current = state;
  const activePageRef = useRef(activePage);
  activePageRef.current = activePage;

  const request = useCallback(
    (req: TableEditRequest): void => {
      const current = docRef.current;
      if (!current) return;
      const base = modeRef.current === "split" ? 0 : (activePageRef.current?.startLine ?? 0);
      setState({
        specId: current.meta.id,
        absStartLine: base + req.pageLineStart,
        absEndLineExclusive: base + req.pageLineEnd + 1,
        model: parseTable(req.raw),
        focus: req.focus,
      });
    },
    [docRef, modeRef],
  );

  const apply = useCallback(
    (model: TableModel): void => {
      const edit = stateRef.current;
      const current = docRef.current;
      if (!edit || !current || current.meta.id !== edit.specId) {
        setState(null);
        return;
      }
      const [start, end] = lineRangeOffsets(current.content, edit.absStartLine, edit.absEndLineExclusive);
      writeContent(current.content.slice(0, start) + serializeTable(model) + current.content.slice(end));
      setState(null);
      notify("テーブルを更新しました");
    },
    [docRef, notify, writeContent],
  );

  const cancel = useCallback((): void => setState(null), []);

  return { state, request, apply, cancel };
}
