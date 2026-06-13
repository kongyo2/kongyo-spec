import { distance } from "fastest-levenshtein";
import { z } from "zod";

export type AutocompleteProviderId = "mistral" | "inception";
export type AutocompleteFamily = "codestral" | "mercury";

export interface AutocompleteModelDef {
  readonly id: string;
  readonly label: string;
  readonly providerId: AutocompleteProviderId;
  readonly provider: string;
  readonly requestModel: string;
  readonly temperature: number;
  readonly family: AutocompleteFamily;
}

export interface AutocompleteProviderMeta {
  readonly id: AutocompleteProviderId;
  readonly label: string;
  readonly fimUrls: readonly string[];
  readonly keyHelpUrl: string;
  readonly keyPlaceholder: string;
}

export const AUTOCOMPLETE_PROVIDERS: Record<AutocompleteProviderId, AutocompleteProviderMeta> = {
  mistral: {
    id: "mistral",
    label: "Mistral",
    fimUrls: ["https://api.mistral.ai/v1/fim/completions", "https://codestral.mistral.ai/v1/fim/completions"],
    keyHelpUrl: "https://console.mistral.ai/api-keys",
    keyPlaceholder: "Mistral / Codestral のキー",
  },
  inception: {
    id: "inception",
    label: "Inception",
    fimUrls: ["https://api.inceptionlabs.ai/v1/fim/completions"],
    keyHelpUrl: "https://platform.inceptionlabs.ai/dashboard/api-keys",
    keyPlaceholder: "Inception のキー",
  },
};

export const AUTOCOMPLETE_MODELS: readonly AutocompleteModelDef[] = [
  {
    id: "mistral/codestral-2508",
    label: "Codestral",
    providerId: "mistral",
    provider: "Mistral",
    requestModel: "codestral-2508",
    temperature: 0.2,
    family: "codestral",
  },
  {
    id: "inception/mercury-edit-2",
    label: "Mercury Edit 2 (FIM)",
    providerId: "inception",
    provider: "Inception",
    requestModel: "mercury-edit-2",
    temperature: 0,
    family: "mercury",
  },
];

export const DEFAULT_AUTOCOMPLETE_MODEL_ID = "mistral/codestral-2508";

export function getAutocompleteModelById(id: string): AutocompleteModelDef {
  return AUTOCOMPLETE_MODELS.find((model) => model.id === id) ?? AUTOCOMPLETE_MODELS[0]!;
}

export function validAutocompleteModelId(value: unknown): boolean {
  return typeof value === "string" && AUTOCOMPLETE_MODELS.some((model) => model.id === value);
}

export const AUTOCOMPLETE_PROVIDER_SETTINGS_KEY: Record<AutocompleteProviderId, "mistralApiKey" | "inceptionApiKey"> = {
  mistral: "mistralApiKey",
  inception: "inceptionApiKey",
};

export const MAX_AUTOCOMPLETE_PREFIX_CHARS = 4000;
export const MAX_AUTOCOMPLETE_SUFFIX_CHARS = 1000;
export const AUTOCOMPLETE_MAX_TOKENS = 256;

export const AutocompleteRequestSchema = z.object({
  prefix: z
    .string()
    .max(MAX_AUTOCOMPLETE_PREFIX_CHARS * 2)
    .default(""),
  suffix: z
    .string()
    .max(MAX_AUTOCOMPLETE_SUFFIX_CHARS * 2)
    .default(""),
});
export type AutocompleteRequest = z.infer<typeof AutocompleteRequestSchema>;
export function parseAutocompleteRequest(raw: unknown): AutocompleteRequest {
  return AutocompleteRequestSchema.parse(raw);
}

export interface AutocompleteResponse {
  text: string;
  notice: string | null;
}

// ---------------------------------------------------------------------------
// Post-processing — ported from continuedev/kilocode autocomplete pipeline.
// ---------------------------------------------------------------------------

function lineIsRepeated(a: string, b: string): boolean {
  if (a.length <= 4 || b.length <= 4) return false;
  const aTrim = a.trim();
  const bTrim = b.trim();
  return distance(aTrim, bTrim) / bTrim.length < 0.1;
}

function longestCommonSubsequence(a: string, b: string): string {
  const lengths: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    lengths[i] = [];
    for (let j = 0; j <= b.length; j++) {
      if (i === 0 || j === 0) lengths[i]![j] = 0;
      else if (a[i - 1] === b[j - 1]) lengths[i]![j] = lengths[i - 1]![j - 1]! + 1;
      else lengths[i]![j] = Math.max(lengths[i - 1]![j]!, lengths[i]![j - 1]!);
    }
  }
  let result = "";
  let x = a.length;
  let y = b.length;
  while (x !== 0 && y !== 0) {
    if (lengths[x]![y] === lengths[x - 1]![y]) x--;
    else if (lengths[x]![y] === lengths[x]![y - 1]) y--;
    else {
      result = a[x - 1] + result;
      x--;
      y--;
    }
  }
  return result;
}

function rewritesLineAbove(completion: string, prefix: string): boolean {
  const lineAbove = prefix
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .slice(-1)[0];
  if (!lineAbove) return false;
  const firstLineOfCompletion = completion.split("\n").find((line) => line.trim().length > 0);
  if (!firstLineOfCompletion) return false;
  return lineIsRepeated(lineAbove, firstLineOfCompletion);
}

const MAX_REPETITION_FREQ_TO_CHECK = 3;
function isExtremeRepetition(completion: string): boolean {
  const lines = completion.split("\n");
  if (lines.length < 6) return false;
  for (let freq = 1; freq < MAX_REPETITION_FREQ_TO_CHECK; freq++) {
    const lcs = longestCommonSubsequence(lines[0]!, lines[freq]!);
    if (lcs.length > 5 || lcs.length > lines[0]!.length * 0.5) {
      let matchCount = 0;
      for (let i = 0; i < lines.length; i += freq) {
        if (lines[i]!.includes(lcs)) matchCount++;
      }
      if (matchCount * freq > 8 || (matchCount * freq) / lines.length > 0.8) return true;
    }
  }
  return false;
}

function removePrefixOverlap(completion: string, prefix: string): string {
  const prefixEnd = prefix.split("\n").pop();
  if (prefixEnd) {
    if (completion.startsWith(prefixEnd)) {
      completion = completion.slice(prefixEnd.length);
    } else {
      const trimmedPrefix = prefixEnd.trim();
      const lastWord = trimmedPrefix.split(/\s+/).pop();
      // Only strip the last word when the completion repeats that whole token — not
      // when it merely shares leading characters (e.g. "Use" vs "User IDs...").
      if (lastWord && completion.startsWith(lastWord) && !/\w/.test(completion.charAt(lastWord.length))) {
        completion = completion.slice(lastWord.length);
      } else if (completion.startsWith(trimmedPrefix)) {
        completion = completion.slice(trimmedPrefix.length);
      }
    }
  }
  return completion;
}

export function postprocessCompletion({
  completion,
  family,
  prefix,
  suffix,
}: {
  completion: string;
  family: AutocompleteFamily;
  prefix: string;
  suffix: string;
}): string | undefined {
  // Strip Mercury's echoed prefix before the repeated-line checks below, otherwise
  // rewritesLineAbove rejects completions that merely echo the current line and the
  // full-prefix branch of removePrefixOverlap becomes unreachable.
  if (family === "mercury") completion = removePrefixOverlap(completion, prefix);

  if (completion.trim().length === 0) return undefined;
  if (/^[\s]+$/.test(completion)) return undefined;
  if (rewritesLineAbove(completion, prefix)) return undefined;
  if (isExtremeRepetition(completion)) return undefined;

  if (family === "codestral") {
    if (completion[0] === " " && completion[1] !== " " && prefix.endsWith(" ") && suffix.startsWith("\n")) {
      completion = completion.slice(1);
    }
    if (suffix.length === 0 && prefix.endsWith("\n\n") && completion.startsWith("\n")) {
      completion = completion.slice(1);
    }
  }

  if (
    family === "mercury" &&
    (completion.startsWith("  ") || completion.startsWith("\t")) &&
    !prefix.endsWith("\n") &&
    (suffix.startsWith("\n") || suffix.trim().length === 0)
  ) {
    completion = "\n" + completion;
  }

  if (prefix.endsWith(" ") && completion.startsWith(" ")) completion = completion.slice(1);

  return completion;
}

// --- markdown language filter ----------------------------------------------

function isInsideCodeBlock(prefix: string): boolean {
  let inside = false;
  for (const line of prefix.split("\n")) {
    if (line.trim().startsWith("```")) inside = !inside;
  }
  return inside;
}

function removeSpuriousNewlinesBeforeCodeBlockClosingFences(suggestion: string, prefix: string): string {
  if (!isInsideCodeBlock(prefix)) return suggestion;
  if (!/^(?:\r?\n)+(?=```)/.test(suggestion)) return suggestion;
  if (/(?:\r?\n)$/.test(prefix)) return suggestion.replace(/^(?:\r?\n)+(?=```)/, "");
  return suggestion.replace(/^(\r?\n)(?:\r?\n)+(?=```)/, "$1");
}

// --- duplication filters ----------------------------------------------------

interface SuggestionParts {
  suggestion: string;
  prefix: string;
  suffix: string;
}

function duplicatesFromPrefixOrSuffix({ suggestion, prefix, suffix }: SuggestionParts): boolean {
  const trimmed = suggestion.trim();
  return trimmed.length === 0 || prefix.trimEnd().endsWith(trimmed) || suffix.trimStart().startsWith(trimmed);
}

function duplicatesFromEdgeLines({ suggestion, prefix, suffix }: SuggestionParts): boolean {
  const trimmedSuggestion = suggestion.trim();
  if (!trimmedSuggestion.includes("\n")) return false;
  const suggestionLines = trimmedSuggestion.split("\n");
  const firstSuggestionLine = suggestionLines[0]?.trim() ?? "";
  const lastSuggestionLine = suggestionLines[suggestionLines.length - 1]?.trim() ?? "";
  const prefixLastLine = prefix.trimEnd().split("\n").pop()?.trim() ?? "";
  const suffixFirstLine = suffix.trimStart().split("\n")[0]?.trim() ?? "";
  if (firstSuggestionLine.length > 0 && prefixLastLine.length > 0 && firstSuggestionLine === prefixLastLine)
    return true;
  if (lastSuggestionLine.length > 0 && suffixFirstLine.length > 0 && lastSuggestionLine === suffixFirstLine)
    return true;
  return false;
}

function containsRepetitivePhraseFromPrefix({ suggestion }: SuggestionParts): boolean {
  const phraseLength = 30;
  const minRepetitions = 3;
  if (suggestion.length < phraseLength * minRepetitions) return false;
  const stripped = suggestion.replace(/\W+$/, "");
  if (stripped.length < phraseLength) return false;
  const phrase = stripped.slice(-phraseLength);
  let count = 0;
  let pos = 0;
  while ((pos = suggestion.indexOf(phrase, pos)) !== -1) {
    count++;
    pos += phrase.length;
  }
  return count >= minRepetitions;
}

function normalizeToCompleteLine({ suggestion, prefix, suffix }: SuggestionParts): SuggestionParts | null {
  const prefixNewlineIndex = prefix.lastIndexOf("\n");
  const restPrefix = prefixNewlineIndex === -1 ? "" : prefix.slice(0, prefixNewlineIndex + 1);
  const prefixLineTail = prefixNewlineIndex === -1 ? prefix : prefix.slice(prefixNewlineIndex + 1);
  const suffixNewlineIndex = suffix.indexOf("\n");
  const suffixLineHead = suffixNewlineIndex === -1 ? suffix : suffix.slice(0, suffixNewlineIndex);
  const restSuffix = suffixNewlineIndex === -1 ? "" : suffix.slice(suffixNewlineIndex);
  if (prefixLineTail.length === 0 && suffixLineHead.length === 0) return null;
  return { prefix: restPrefix, suggestion: prefixLineTail + suggestion + suffixLineHead, suffix: restSuffix };
}

function suggestionConsideredDuplication(params: SuggestionParts): boolean {
  if (duplicatesFromPrefixOrSuffix(params)) return true;
  if (duplicatesFromEdgeLines(params)) return true;
  if (containsRepetitivePhraseFromPrefix(params)) return true;
  const normalized = normalizeToCompleteLine(params);
  return !!normalized && (duplicatesFromPrefixOrSuffix(normalized) || duplicatesFromEdgeLines(normalized));
}

export function postprocessAutocompleteSuggestion(params: {
  suggestion: string;
  prefix: string;
  suffix: string;
  family: AutocompleteFamily;
}): string | undefined {
  const processed = postprocessCompletion({
    completion: params.suggestion,
    family: params.family,
    prefix: params.prefix,
    suffix: params.suffix,
  });
  if (processed === undefined) return undefined;
  const filtered = removeSpuriousNewlinesBeforeCodeBlockClosingFences(processed, params.prefix);
  if (suggestionConsideredDuplication({ suggestion: filtered, prefix: params.prefix, suffix: params.suffix })) {
    return undefined;
  }
  return filtered;
}

// ---------------------------------------------------------------------------
// Trigger gating — skip mid-word typing (ASCII). Japanese prose has no word
// boundaries here, so completions stay eager between IME commits.
// ---------------------------------------------------------------------------

function isMidWordTyping(prefix: string, suffix: string): boolean {
  if (prefix.length === 0) return false;
  const suffixStartsWithWordChar = /^[a-zA-Z0-9_]/.test(suffix);
  const wordMatch = prefix.match(/([a-zA-Z_][a-zA-Z0-9_]*)$/);
  const lengthOfWordAtEndOfPrefix = wordMatch ? wordMatch[1]!.length : 0;
  return lengthOfWordAtEndOfPrefix > 2 || suffixStartsWithWordChar;
}

export function shouldSkipAutocomplete(prefix: string, suffix: string): boolean {
  return isMidWordTyping(prefix, suffix);
}

// ---------------------------------------------------------------------------
// Suggestion cache — reuse prior completions as the user types/deletes.
// ---------------------------------------------------------------------------

export interface FillInAtCursorSuggestion {
  text: string;
  prefix: string;
  suffix: string;
}

export type MatchType = "exact" | "partial_typing" | "backward_deletion";

export interface MatchingSuggestion {
  text: string;
  matchType: MatchType;
}

export const MAX_SUGGESTIONS_HISTORY = 20;

export function updateSuggestionsHistory(
  history: FillInAtCursorSuggestion[],
  entry: FillInAtCursorSuggestion,
): FillInAtCursorSuggestion[] {
  const isDuplicate = history.some(
    (existing) => existing.text === entry.text && existing.prefix === entry.prefix && existing.suffix === entry.suffix,
  );
  if (isDuplicate) return history;
  const next = [...history, entry];
  if (next.length > MAX_SUGGESTIONS_HISTORY) next.shift();
  return next;
}

export function findMatchingSuggestion(
  prefix: string,
  suffix: string,
  history: FillInAtCursorSuggestion[],
): MatchingSuggestion | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const cached = history[i]!;
    if (prefix === cached.prefix && suffix === cached.suffix) {
      return { text: cached.text, matchType: "exact" };
    }
    if (cached.text !== "" && prefix.startsWith(cached.prefix) && suffix === cached.suffix) {
      const typed = prefix.substring(cached.prefix.length);
      if (cached.text.startsWith(typed)) {
        return { text: cached.text.substring(typed.length), matchType: "partial_typing" };
      }
    }
    if (cached.text !== "" && cached.prefix.startsWith(prefix) && suffix === cached.suffix) {
      const deleted = cached.prefix.substring(prefix.length);
      return { text: deleted + cached.text, matchType: "backward_deletion" };
    }
  }
  return null;
}

export function countLines(text: string): number {
  if (text === "") return 0;
  const lineBreakCount = (text.match(/\r?\n/g) || []).length;
  return lineBreakCount + 1 - (text.endsWith("\n") ? 1 : 0);
}

export function getFirstLine(text: string): string {
  return text.split(/\r?\n/, 1)[0]!;
}

export function shouldShowOnlyFirstLine(prefix: string, suggestion: string): boolean {
  if (suggestion.startsWith("\n") || suggestion.startsWith("\r\n")) return false;
  const currentLinePrefix = prefix.slice(prefix.lastIndexOf("\n") + 1);
  if (!currentLinePrefix.match(/\w/)) return false;
  if (currentLinePrefix.trim().length > 0) return true;
  return countLines(suggestion) >= 3;
}

// ---------------------------------------------------------------------------
// Adaptive debounce — clamp toward observed request latency.
// ---------------------------------------------------------------------------

export const MIN_DEBOUNCE_DELAY_MS = 150;
export const INITIAL_DEBOUNCE_DELAY_MS = 300;
export const MAX_DEBOUNCE_DELAY_MS = 1000;
export const LATENCY_SAMPLE_SIZE = 10;

export function calcDebounceDelay(latencyHistory: number[]): number {
  if (latencyHistory.length === 0) return MIN_DEBOUNCE_DELAY_MS;
  const sum = latencyHistory.reduce((acc, v) => acc + v, 0);
  const avg = Math.round(sum / latencyHistory.length);
  return Math.max(MIN_DEBOUNCE_DELAY_MS, Math.min(avg, MAX_DEBOUNCE_DELAY_MS));
}
