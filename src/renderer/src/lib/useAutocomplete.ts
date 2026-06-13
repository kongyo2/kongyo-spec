import { type KeyboardEvent, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import {
  calcDebounceDelay,
  type FillInAtCursorSuggestion,
  findMatchingSuggestion,
  getAutocompleteModelById,
  getFirstLine,
  INITIAL_DEBOUNCE_DELAY_MS,
  LATENCY_SAMPLE_SIZE,
  MAX_AUTOCOMPLETE_PREFIX_CHARS,
  MAX_AUTOCOMPLETE_SUFFIX_CHARS,
  postprocessAutocompleteSuggestion,
  shouldSkipAutocomplete,
  updateSuggestionsHistory,
} from "@shared/autocomplete";

export interface GhostSuggestion {
  anchor: number;
  text: string;
}

interface UseAutocompleteOptions {
  enabled: boolean;
  modelId: string;
  readOnly: boolean;
  value: string;
  onChange: (next: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onNotice?: ((message: string) => void) | undefined;
}

export interface AutocompleteController {
  ghost: GhostSuggestion | null;
  handleInput: () => void;
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  handleBlur: () => void;
  handlePointerDown: () => void;
  handleCompositionStart: () => void;
  handleCompositionEnd: () => void;
  dismiss: () => void;
}

interface Context {
  caret: number;
  atEol: boolean;
  atEod: boolean;
  prefix: string;
  suffix: string;
}

export function useAutocomplete(options: UseAutocompleteOptions): AutocompleteController {
  const { enabled, modelId, readOnly, value, onChange, textareaRef } = options;

  const [ghost, setGhostState] = useState<GhostSuggestion | null>(null);
  const ghostRef = useRef<GhostSuggestion | null>(null);
  const historyRef = useRef<FillInAtCursorSuggestion[]>([]);
  const tokenRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const inflightRef = useRef(false);
  const latencyRef = useRef<number[]>([]);
  const debounceRef = useRef(INITIAL_DEBOUNCE_DELAY_MS);
  const composingRef = useRef(false);
  const onNoticeRef = useRef(options.onNotice);
  onNoticeRef.current = options.onNotice;

  const family = getAutocompleteModelById(modelId).family;

  const setGhost = useCallback((next: GhostSuggestion | null): void => {
    const prev = ghostRef.current;
    if (prev === next) return;
    if (prev && next && prev.anchor === next.anchor && prev.text === next.text) return;
    if (!prev && !next) return;
    ghostRef.current = next;
    setGhostState(next);
  }, []);

  const readContext = useCallback((): Context | null => {
    const textarea = textareaRef.current;
    if (!textarea) return null;
    const caret = textarea.selectionStart;
    if (caret !== textarea.selectionEnd) return null;
    const doc = textarea.value;
    return {
      caret,
      atEol: caret === doc.length || doc[caret] === "\n",
      atEod: caret === doc.length,
      prefix: doc.slice(Math.max(0, caret - MAX_AUTOCOMPLETE_PREFIX_CHARS), caret),
      suffix: doc.slice(caret, caret + MAX_AUTOCOMPLETE_SUFFIX_CHARS),
    };
  }, [textareaRef]);

  const reconcile = useCallback((): void => {
    if (!enabled || readOnly || composingRef.current) {
      setGhost(null);
      return;
    }
    const ctx = readContext();
    if (!ctx || !ctx.atEol) {
      setGhost(null);
      return;
    }
    const match = findMatchingSuggestion(ctx.prefix, ctx.suffix, historyRef.current);
    if (!match || match.text.length === 0) {
      setGhost(null);
      return;
    }
    const visible = ctx.atEod ? match.text : getFirstLine(match.text);
    if (visible.length === 0) {
      setGhost(null);
      return;
    }
    setGhost({ anchor: ctx.caret, text: visible });
  }, [enabled, readOnly, readContext, setGhost]);

  const dismiss = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    tokenRef.current += 1;
    if (inflightRef.current) {
      inflightRef.current = false;
      void window.api.cancelAutocomplete().catch(() => undefined);
    }
    setGhost(null);
  }, [setGhost]);

  const fireRequest = useCallback((): void => {
    if (!enabled || readOnly || composingRef.current) return;
    const ctx = readContext();
    if (!ctx || !ctx.atEol || ctx.prefix.trim().length === 0) return;
    if (findMatchingSuggestion(ctx.prefix, ctx.suffix, historyRef.current)) return;
    if (shouldSkipAutocomplete(ctx.prefix, ctx.suffix)) return;

    const token = (tokenRef.current += 1);
    inflightRef.current = true;
    const started = performance.now();
    const reqPrefix = ctx.prefix;
    const reqSuffix = ctx.suffix;

    void window.api.autocomplete({ prefix: reqPrefix, suffix: reqSuffix }).then(
      ({ text, notice }) => {
        if (token !== tokenRef.current) return;
        inflightRef.current = false;
        if (notice) onNoticeRef.current?.(notice);
        latencyRef.current.push(performance.now() - started);
        if (latencyRef.current.length > LATENCY_SAMPLE_SIZE) {
          latencyRef.current.shift();
          debounceRef.current = calcDebounceDelay(latencyRef.current);
        }
        const processed =
          text.length > 0
            ? postprocessAutocompleteSuggestion({ suggestion: text, prefix: reqPrefix, suffix: reqSuffix, family })
            : undefined;
        historyRef.current = updateSuggestionsHistory(historyRef.current, {
          text: processed ?? "",
          prefix: reqPrefix,
          suffix: reqSuffix,
        });
        reconcile();
      },
      () => {
        if (token === tokenRef.current) inflightRef.current = false;
      },
    );
  }, [enabled, readOnly, readContext, family, reconcile]);

  const scheduleRequest = useCallback((): void => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      fireRequest();
    }, debounceRef.current);
  }, [fireRequest]);

  const handleInput = useCallback((): void => {
    if (composingRef.current) {
      setGhost(null);
      return;
    }
    reconcile();
    if (enabled && !readOnly) scheduleRequest();
  }, [enabled, readOnly, reconcile, scheduleRequest, setGhost]);

  const accept = useCallback((): void => {
    const current = ghostRef.current;
    const textarea = textareaRef.current;
    if (!current || !textarea) return;
    const doc = textarea.value;
    const cursor = current.anchor + current.text.length;
    const next = doc.slice(0, current.anchor) + current.text + doc.slice(current.anchor);
    tokenRef.current += 1;
    setGhost(null);
    onChange(next);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.selectionStart = cursor;
        ta.selectionEnd = cursor;
      }
    });
  }, [onChange, setGhost, textareaRef]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      const current = ghostRef.current;
      if (current === null) return false;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
        return true;
      }
      if (event.key === "Tab" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
        const textarea = event.currentTarget;
        if (textarea.selectionStart === textarea.selectionEnd && textarea.selectionStart === current.anchor) {
          event.preventDefault();
          accept();
          return true;
        }
      }
      if (
        event.key.startsWith("Arrow") ||
        event.key === "Home" ||
        event.key === "End" ||
        event.key === "PageUp" ||
        event.key === "PageDown" ||
        event.ctrlKey ||
        event.metaKey
      ) {
        dismiss();
      }
      return false;
    },
    [accept, dismiss],
  );

  const handleCompositionStart = useCallback((): void => {
    composingRef.current = true;
    dismiss();
  }, [dismiss]);

  const handleCompositionEnd = useCallback((): void => {
    composingRef.current = false;
    if (enabled && !readOnly) scheduleRequest();
  }, [enabled, readOnly, scheduleRequest]);

  useEffect(() => {
    reconcile();
  }, [value, reconcile]);

  useEffect(() => {
    historyRef.current = [];
    latencyRef.current = [];
    debounceRef.current = INITIAL_DEBOUNCE_DELAY_MS;
    dismiss();
  }, [modelId, dismiss]);

  useEffect(() => {
    if (!enabled) {
      historyRef.current = [];
      dismiss();
    }
  }, [enabled, dismiss]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      tokenRef.current += 1;
      if (inflightRef.current) void window.api.cancelAutocomplete().catch(() => undefined);
    },
    [],
  );

  return {
    ghost,
    handleInput,
    handleKeyDown,
    handleBlur: dismiss,
    handlePointerDown: dismiss,
    handleCompositionStart,
    handleCompositionEnd,
    dismiss,
  };
}
