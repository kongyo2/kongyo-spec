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

function classify(error: unknown): ErrorKind {
  const status = error instanceof FimHttpError ? error.status : null;
  if (status === null) return "transient";
  if (status === 401 || status === 402 || status === 403) return "fatal";
  if (status === 429 || status >= 500) return "retriable";
  return "transient";
}

class ErrorBackoff {
  private fatal = false;
  private fatalStatus: number | null = null;
  private opened = 0;
  private failures = 0;
  private blockedUntil = 0;

  success(): void {
    this.fatal = false;
    this.fatalStatus = null;
    this.failures = 0;
    this.blockedUntil = 0;
    this.opened = 0;
  }

  failure(error: unknown): ErrorKind {
    const kind = classify(error);
    if (kind === "fatal") {
      this.fatal = true;
      this.fatalStatus = error instanceof FimHttpError ? error.status : null;
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
    if (this.fatal) return true;
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
const preferredFimUrl = new Map<string, string>();

export function cancelAutocomplete(): void {
  inflight?.abort();
  inflight = null;
}

export function resetAutocompleteBackoff(): void {
  backoff.success();
  fatalNotified = false;
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
  signal: AbortSignal,
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
    // eslint-disable-next-line no-await-in-loop
    const attempt = await postFim(url, key, body, signal);
    if (attempt.ok) {
      preferredFimUrl.set(model.providerId, url);
      response = attempt;
      break;
    }
    const isEndpointMismatch = attempt.status === 401 || attempt.status === 403;
    if (!isEndpointMismatch || i === ordered.length - 1) {
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

    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(FIM_TIMEOUT_MS)]);
    const text = await requestFim(model, key, body, signal);
    backoff.success();
    fatalNotified = false;
    return { text, notice: null };
  } catch (err) {
    if (controller.signal.aborted) return { text: "", notice: null };
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
