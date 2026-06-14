import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildSearchRegExp,
  findMatches,
  type FindMatch,
  type FindOptions,
  replaceAll as replaceAllMatches,
  replaceOne,
} from "../lib/findReplace";
import type { EditingApi } from "./useSpecWorkspace";

interface SearchUiState {
  open: boolean;
  query: string;
  replace: string;
  showReplace: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface SearchHighlight {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  activeIndex: number;
}

export interface SearchController {
  search: SearchUiState;
  matches: FindMatch[];
  matchCount: number;
  currentIndex: number;
  regexInvalid: boolean;
  highlight: SearchHighlight | null;
  previewQuery: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  open: () => void;
  close: () => void;
  setQuery: (value: string) => void;
  setReplace: (value: string) => void;
  toggleReplace: () => void;
  toggleCase: () => void;
  toggleWord: () => void;
  toggleRegex: () => void;
  next: () => void;
  prev: () => void;
  replaceOne: () => void;
  replaceAll: () => void;
}

const INITIAL_SEARCH: SearchUiState = {
  open: false,
  query: "",
  replace: "",
  showReplace: false,
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

export function useSearch(editing: EditingApi, content: string): SearchController {
  const { docRef, notify, writeContent, ensureEditable, guard } = editing;
  const [search, setSearch] = useState<SearchUiState>(INITIAL_SEARCH);
  const [matchCursor, setMatchCursor] = useState(0);
  const searchStateRef = useRef(search);
  searchStateRef.current = search;
  const matchCursorRef = useRef(matchCursor);
  matchCursorRef.current = matchCursor;
  const inputRef = useRef<HTMLInputElement>(null);

  const searchOptions = useMemo<FindOptions>(
    () => ({ caseSensitive: search.caseSensitive, wholeWord: search.wholeWord, regex: search.regex }),
    [search.caseSensitive, search.wholeWord, search.regex],
  );
  const matches = useMemo<FindMatch[]>(
    () => (search.open && search.query.length > 0 ? findMatches(content, search.query, searchOptions) : []),
    [search.open, search.query, searchOptions, content],
  );
  const regexInvalid =
    search.regex && search.query.length > 0 && buildSearchRegExp(search.query, searchOptions) === null;
  const safeMatchCursor = matches.length > 0 ? Math.min(matchCursor, matches.length - 1) : 0;

  useEffect(() => {
    setMatchCursor(0);
  }, [search.query, search.caseSensitive, search.wholeWord, search.regex]);

  const open = useCallback((): void => {
    if (docRef.current === null) return;
    ensureEditable();
    setSearch((prev) => ({ ...prev, open: true }));
    requestAnimationFrame(() => inputRef.current?.select());
  }, [docRef, ensureEditable]);

  const close = useCallback((): void => {
    setSearch((prev) => ({ ...prev, open: false }));
    setMatchCursor(0);
  }, []);

  const gotoMatch = useCallback(
    (index: number, total: number): void => {
      if (total === 0) return;
      ensureEditable();
      setMatchCursor(((index % total) + total) % total);
    },
    [ensureEditable],
  );

  const replaceCurrent = useCallback((): void => {
    const current = docRef.current;
    if (!current) return;
    const opts: FindOptions = {
      caseSensitive: searchStateRef.current.caseSensitive,
      wholeWord: searchStateRef.current.wholeWord,
      regex: searchStateRef.current.regex,
    };
    const query = searchStateRef.current.query;
    const list = findMatches(current.content, query, opts);
    if (list.length === 0) return;
    const cursor = Math.min(matchCursorRef.current, list.length - 1);
    const target = list[cursor]!;
    const { content: next, caret } = replaceOne(current.content, target, query, searchStateRef.current.replace, opts);
    const after = findMatches(next, query, opts);
    let nextCursor = after.findIndex((match) => match.start >= caret);
    if (nextCursor === -1) nextCursor = 0;
    ensureEditable();
    writeContent(next);
    setMatchCursor(nextCursor);
  }, [docRef, ensureEditable, writeContent]);

  const replaceAll = useCallback((): void => {
    const current = docRef.current;
    if (!current) return;
    const opts: FindOptions = {
      caseSensitive: searchStateRef.current.caseSensitive,
      wholeWord: searchStateRef.current.wholeWord,
      regex: searchStateRef.current.regex,
    };
    const { content: next, count } = replaceAllMatches(
      current.content,
      searchStateRef.current.query,
      searchStateRef.current.replace,
      opts,
    );
    if (count === 0) {
      notify("置換対象が見つかりません");
      return;
    }
    guard("一括置換の前");
    ensureEditable();
    writeContent(next);
    setMatchCursor(0);
    notify(`${count} 件を置換しました`);
  }, [docRef, notify, guard, ensureEditable, writeContent]);

  const highlight = useMemo<SearchHighlight | null>(
    () =>
      search.open && search.query.length > 0
        ? {
            query: search.query,
            caseSensitive: search.caseSensitive,
            wholeWord: search.wholeWord,
            regex: search.regex,
            activeIndex: matches.length > 0 ? safeMatchCursor : -1,
          }
        : null,
    [search.open, search.query, search.caseSensitive, search.wholeWord, search.regex, matches.length, safeMatchCursor],
  );
  const previewQuery = search.open && !search.regex ? search.query : "";

  return {
    search,
    matches,
    matchCount: matches.length,
    currentIndex: matches.length > 0 ? safeMatchCursor : -1,
    regexInvalid,
    highlight,
    previewQuery,
    inputRef,
    open,
    close,
    setQuery: useCallback((value: string) => setSearch((prev) => ({ ...prev, query: value })), []),
    setReplace: useCallback((value: string) => setSearch((prev) => ({ ...prev, replace: value })), []),
    toggleReplace: useCallback(() => setSearch((prev) => ({ ...prev, showReplace: !prev.showReplace })), []),
    toggleCase: useCallback(() => setSearch((prev) => ({ ...prev, caseSensitive: !prev.caseSensitive })), []),
    toggleWord: useCallback(() => setSearch((prev) => ({ ...prev, wholeWord: !prev.wholeWord })), []),
    toggleRegex: useCallback(() => setSearch((prev) => ({ ...prev, regex: !prev.regex })), []),
    next: useCallback(
      () => gotoMatch(safeMatchCursor + 1, matches.length),
      [gotoMatch, safeMatchCursor, matches.length],
    ),
    prev: useCallback(
      () => gotoMatch(safeMatchCursor - 1, matches.length),
      [gotoMatch, safeMatchCursor, matches.length],
    ),
    replaceOne: replaceCurrent,
    replaceAll,
  };
}
