import {
  AUTOCOMPLETE_MAX_TOKENS,
  AUTOCOMPLETE_PROVIDER_SETTINGS_KEY,
  AUTOCOMPLETE_PROVIDERS,
  getAutocompleteModelById,
  MAX_AUTOCOMPLETE_PREFIX_CHARS,
  MAX_AUTOCOMPLETE_SUFFIX_CHARS,
  type AutocompleteModelDef,
  type AutocompleteRequest,
  type AutocompleteResponse,
} from "@shared/autocomplete";
import { readSettings } from "./settingsStore";

const FIM_TIMEOUT_MS = 12_000;

class FimHttpError extends Error {
  constructor(public readonly status: number) {
    super(`FIM request failed: ${status}`);
  }
}

type ErrorKind = "fatal" | "retriable" | "transient";

const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 120_000;
const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 300_000;
const FATAL_RECOVER_COOLDOWN_MS = 300_000;

function classify(error: unknown): ErrorKind {
  if (error instanceof FimHttpError) {
    const status = error.status;
    if (status === 401 || status === 402 || status === 403) return "fatal";
    if (status === 429 || status >= 500) return "retriable";
    return "transient";
  }
  // Non-HTTP failures reaching here are transport/timeout errors (user aborts are
  // filtered out before backoff), so engage the circuit breaker instead of spamming.
  return "retriable";
}

class ErrorBackoff {
  private fatal = false;
  private fatalStatus: number | null = null;
  private fatalAt = 0;
  private opened = 0;
  private failures = 0;
  private blockedUntil = 0;

  success(): void {
    this.fatal = false;
    this.fatalStatus = null;
    this.fatalAt = 0;
    this.failures = 0;
    this.blockedUntil = 0;
    this.opened = 0;
  }

  failure(error: unknown): ErrorKind {
    const kind = classify(error);
    if (kind === "fatal") {
      this.fatal = true;
      this.fatalStatus = error instanceof FimHttpError ? error.status : null;
      this.fatalAt = Date.now();
      return kind;
    }
    if (kind === "retriable") {
      this.failures++;
      this.blockedUntil = Date.now() + Math.min(BASE_DELAY_MS * 2 ** (this.failures - 1), MAX_DELAY_MS);
      if (this.failures >= CIRCUIT_THRESHOLD && this.opened === 0) this.opened = Date.now();
      return kind;
    }
    return kind;
  }

  blocked(): boolean {
    if (this.fatal) {
      // 401/403 (bad key) stay blocked until a settings change resets the backoff.
      if (this.fatalStatus !== 402) return true;
      // 402 (insufficient credit) clears once the user tops up at the provider.
      // Keep blocking until the cooldown elapses, then clear the fatal state and
      // fall through so a probe goes out and any later retriable failure records
      // normal backoff instead of being shadowed by the stale 402.
      if (Date.now() - this.fatalAt < FATAL_RECOVER_COOLDOWN_MS) return true;
      this.fatal = false;
      this.fatalStatus = null;
      this.fatalAt = 0;
    }
    if (this.opened > 0) {
      if (Date.now() - this.opened < CIRCUIT_COOLDOWN_MS) return true;
      this.opened = 0;
      this.failures = 0;
      this.blockedUntil = 0;
      return false;
    }
    if (this.blockedUntil > 0 && Date.now() < this.blockedUntil) return true;
    return false;
  }

  getFatalStatus(): number | null {
    return this.fatalStatus;
  }
}

const backoff = new ErrorBackoff();
let fatalNotified = false;
let inflight: AbortController | null = null;
let resetGeneration = 0;
const preferredFimUrl = new Map<string, string>();

export function cancelAutocomplete(): void {
  inflight?.abort();
  inflight = null;
}

export function resetAutocompleteBackoff(): void {
  backoff.success();
  fatalNotified = false;
  // A request started before this reset (e.g. with a now-replaced key) must not
  // re-mark the backoff fatal. Bump the generation and abort any in-flight call.
  resetGeneration += 1;
  inflight?.abort();
  inflight = null;
}

function fatalNotice(status: number | null): string {
  if (status === 402) return "オートコンプリート: クレジット残高が不足しています。";
  return "オートコンプリート: API キーが拒否されました。設定を確認してください。";
}

async function postFim(url: string, key: string, body: string, signal: AbortSignal): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body,
    signal,
  });
}

async function requestFim(
  model: AutocompleteModelDef,
  key: string,
  body: string,
  userSignal: AbortSignal,
): Promise<string> {
  const urls = AUTOCOMPLETE_PROVIDERS[model.providerId].fimUrls;
  const ordered = (() => {
    const preferred = preferredFimUrl.get(model.providerId);
    if (preferred && urls.includes(preferred)) return [preferred, ...urls.filter((u) => u !== preferred)];
    return [...urls];
  })();

  let response: Response | null = null;
  for (let i = 0; i < ordered.length; i++) {
    const url = ordered[i]!;
    const isLast = i === ordered.length - 1;
    let attempt: Response;
    try {
      // Each endpoint gets its own timeout budget so a hang on the first URL
      // still leaves time to fail over to the second.
      const signal = AbortSignal.any([userSignal, AbortSignal.timeout(FIM_TIMEOUT_MS)]);
      // eslint-disable-next-line no-await-in-loop
      attempt = await postFim(url, key, body, signal);
    } catch (err) {
      // Transport failure or per-endpoint timeout: fail over to the next URL,
      // but never swallow a user abort and never loop past the last URL.
      if (userSignal.aborted || isLast) throw err;
      preferredFimUrl.delete(model.providerId);
      continue;
    }
    if (attempt.ok) {
      preferredFimUrl.set(model.providerId, url);
      response = attempt;
      break;
    }
    // Endpoint-specific (401/403) or server (5xx) failures: try the next URL; a
    // healthy second endpoint can still serve. Other statuses (400/404/429) stop.
    const shouldTryNextEndpoint = attempt.status === 401 || attempt.status === 403 || attempt.status >= 500;
    if (!shouldTryNextEndpoint || isLast) {
      response = attempt;
      break;
    }
    preferredFimUrl.delete(model.providerId);
  }

  if (response === null) throw new FimHttpError(502);
  if (!response.ok) throw new FimHttpError(response.status);

  const payload = (await response.json()) as {
    choices?: { text?: unknown; message?: { content?: unknown } }[];
  };
  const choice = payload?.choices?.[0];
  const content = choice?.message?.content ?? choice?.text;
  return typeof content === "string" ? content : "";
}

export async function autocomplete(input: AutocompleteRequest): Promise<AutocompleteResponse> {
  inflight?.abort();
  const controller = new AbortController();
  inflight = controller;
  const generation = resetGeneration;
  try {
    const settings = readSettings();
    if (!settings.autocompleteEnabled) return { text: "", notice: null };
    if (backoff.blocked()) return { text: "", notice: null };

    const model = getAutocompleteModelById(settings.autocompleteModelId);
    const key = settings[AUTOCOMPLETE_PROVIDER_SETTINGS_KEY[model.providerId]];
    if (key === null) return { text: "", notice: null };

    const prefix = input.prefix.slice(-MAX_AUTOCOMPLETE_PREFIX_CHARS);
    if (prefix.trim().length === 0) return { text: "", notice: null };
    const suffix = input.suffix.slice(0, MAX_AUTOCOMPLETE_SUFFIX_CHARS);

    const body = JSON.stringify({
      model: model.requestModel,
      prompt: prefix,
      suffix,
      max_tokens: AUTOCOMPLETE_MAX_TOKENS,
      temperature: model.temperature,
      stream: false,
    });

    const text = await requestFim(model, key, body, controller.signal);
    backoff.success();
    fatalNotified = false;
    return { text, notice: null };
  } catch (err) {
    if (controller.signal.aborted) return { text: "", notice: null };
    if (generation !== resetGeneration) return { text: "", notice: null };
    const kind = backoff.failure(err);
    if (kind === "fatal" && !fatalNotified) {
      fatalNotified = true;
      return { text: "", notice: fatalNotice(backoff.getFatalStatus()) };
    }
    return { text: "", notice: null };
  } finally {
    if (inflight === controller) inflight = null;
  }
}
