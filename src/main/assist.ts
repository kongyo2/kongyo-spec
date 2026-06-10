import { ApiError, GoogleGenAI, Type, type Schema } from "@google/genai";
import {
  MAX_TAILOR_TASKS,
  parseAuditReport,
  parseLensReport,
  parseTailorPlan,
  parseWarpResult,
  parseWeaveResult,
  type AssistAudit,
  type AssistKind,
  type AssistReview,
  type AssistTailor,
  type AssistWarp,
  type AssistWeave,
  type WarpSpecInput,
  type WeaveSpecInput,
} from "@shared/schemas/assist";
import { llmProfileDisplayName, settingsLlmRouting, type LlmProfile, type Settings } from "@shared/schemas/settings";
import { readSettings } from "./settingsStore";

const MAX_SPEC_CHARS = 240_000;

const SYSTEM_PROMPT = `あなたは仕様書(spec)の専門レビュアー「Lens」です。AI 駆動開発のために人間が書いた仕様書を、実装 AI に渡す前に点検します。

前提となる思想:
- 仕様書の価値は「人間にしか決められないこと」だけが書かれていることにある。
- 過剰な具体は実装側の探索を歪め、根拠のない記述は誤った実装を確定させる。
- あなたの仕事は仕様を書き足すことでも、欠落を埋めることでもない。「削るべき具体」と「人間が決めるべき問い」を返すことだけである。

次の 3 種類だけを報告する:

1. kind="overspec"(過剰な具体化)
   目的の達成に寄与しないのに実装の自由を奪っている記述。
   - 根拠なく指定された実装手段(ライブラリ、アルゴリズム、データ構造、内部構成)
   - ユーザーストーリーや受け入れ条件で足りるのに固定された UI 配置・操作手順・画面文言
   - 例示のつもりが仕様として読めてしまう記述
   対象外: 「〜に準拠」「制約:」など意図して書かれた制約、根拠が併記された指定、外部インターフェースの取り決め。
   rewrite には、書き手の意図を保ったまま実装の自由を取り戻す書き換え案を入れる(excerpt をそのまま置換できる Markdown 断片)。

2. kind="speculation"(根拠のない断定)
   文書のどこからも導出できない具体値・選択。書き手の推測がそのまま仕様になっている箇所。
   - 由来の書かれていない数値(タイムアウト、上限、閾値、件数)
   - 理由なく選ばれた方式・形式・順序
   question には、その値・選択の根拠を確かめる短い問いを入れる。rewrite は null。

3. kind="decision"(未決定の重要事項)
   仕様書が沈黙しているが、実装者が勝手に決めると手戻りが大きい事項。
   答えを提案してはいけない。人間が決めるべき問いとして question に書く。
   excerpt は関連する記述があれば逐語で引用し、なければ空文字列にする。rewrite は null。

報告の規律:
- 確信があるものだけを報告する。疑わしきは報告しない。指摘のノイズは書き手の時間を奪う。
- 全体で最大 10 件。重要なものから順に並べる。問題がなければ findings は空配列でよい。
- excerpt は本文からの逐語的な引用(要約・改変・省略記号の挿入を禁止)。その箇所を一意に特定できる最小限の長さにする。
- 原文の引用を除き、すべて日本語で書く。

文書全体の「高度」も測る(altitude、合計が 100 になる整数):
- intent: なぜ作るのか(目的、背景、価値)
- behavior: 何が起きるべきか(ユーザーストーリー、振る舞い、受け入れ条件)
- implementation: どう作るか(技術選定、内部設計、手順)

verdict には文書全体への一行の所見を書く(80 字以内、断定調)。`;

const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    verdict: { type: Type.STRING },
    altitude: {
      type: Type.OBJECT,
      properties: {
        intent: { type: Type.INTEGER },
        behavior: { type: Type.INTEGER },
        implementation: { type: Type.INTEGER },
      },
      required: ["intent", "behavior", "implementation"],
      propertyOrdering: ["intent", "behavior", "implementation"],
    },
    findings: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          kind: { type: Type.STRING, enum: ["overspec", "speculation", "decision"] },
          excerpt: { type: Type.STRING },
          reason: { type: Type.STRING },
          question: { type: Type.STRING, nullable: true },
          rewrite: { type: Type.STRING, nullable: true },
        },
        required: ["kind", "excerpt", "reason"],
        propertyOrdering: ["kind", "excerpt", "reason", "question", "rewrite"],
      },
    },
  },
  required: ["verdict", "altitude", "findings"],
  propertyOrdering: ["verdict", "altitude", "findings"],
};

class HttpStatusError extends Error {
  constructor(
    public readonly status: number,
    detail: string,
  ) {
    super(`HTTP ${status}${detail.length > 0 ? `: ${detail}` : ""}`);
  }
}

class CancelledError extends Error {
  constructor() {
    super("中止しました。");
    this.name = "CancelledError";
  }
}

const REQUEST_TIMEOUT_MS = 120_000;

// 種別ごとに実行中の呼び出しを 1 つだけ持ち、ユーザー操作で中断できるようにする
const inflight = new Map<AssistKind, AbortController>();

export function cancelAssist(kind: AssistKind): void {
  inflight.get(kind)?.abort();
}

const KIND_LABEL: Record<AssistKind, string> = {
  review: "レビュー",
  audit: "深層検査",
  weave: "織り",
  warp: "整形",
  tailor: "仕立て",
};

function friendlyError(err: unknown): Error {
  if (err instanceof CancelledError) return err;
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return new Error("応答がタイムアウトしました。エンドポイントとモデルを確認して再試行してください。");
  }
  const status = err instanceof ApiError ? err.status : err instanceof HttpStatusError ? err.status : null;
  if (status !== null) {
    if (status === 401 || status === 403) {
      return new Error("API キーが拒否されました。設定でキーを確認してください。");
    }
    if (status === 404) {
      return new Error("モデルまたはエンドポイントが見つかりません。設定を確認してください。");
    }
    if (status === 400) {
      return new Error("リクエストが受け付けられませんでした。モデル名と API キーを確認してください。");
    }
    if (status === 429) {
      return new Error("レート上限に達しました。少し待ってから再試行してください。");
    }
    if (status >= 500) {
      return new Error("モデル提供側で障害が発生しています。時間をおいて再試行してください。");
    }
    return new Error(`API エラー (HTTP ${status})`);
  }
  if (err instanceof Error && /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network/i.test(err.message)) {
    return new Error("接続できません。エンドポイントとネットワークを確認してください。");
  }
  return err instanceof Error ? err : new Error(String(err));
}

function parseJsonResponse(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
    throw new Error("モデルの応答を解析できませんでした。再試行してください。");
  }
}

function geminiSchemaToJsonSchema(schema: Schema): Record<string, unknown> {
  const type = String(schema.type ?? Type.OBJECT).toLowerCase();
  const out: Record<string, unknown> = { type: schema.nullable ? [type, "null"] : type };
  if (schema.enum) out["enum"] = schema.enum;
  if (schema.properties) {
    out["properties"] = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [key, geminiSchemaToJsonSchema(value)]),
    );
  }
  if (schema.required) out["required"] = schema.required;
  if (schema.items) out["items"] = geminiSchemaToJsonSchema(schema.items);
  return out;
}

interface ProviderCall {
  profile: LlmProfile;
  settings: Settings;
  system: string;
  contents: string;
  schema: Schema;
  temperature: number;
  signal: AbortSignal;
}

async function callGemini(args: ProviderCall): Promise<unknown> {
  const apiKey = args.profile.apiKey ?? args.settings.geminiApiKey;
  if (apiKey === null) throw new Error("Gemini API キーが設定されていません。");
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: REQUEST_TIMEOUT_MS,
      ...(args.profile.baseUrl !== null ? { baseUrl: args.profile.baseUrl } : {}),
    },
  });
  const response = await ai.models.generateContent({
    model: args.profile.model,
    contents: args.contents,
    config: {
      systemInstruction: args.system,
      responseMimeType: "application/json",
      responseSchema: args.schema,
      temperature: args.temperature,
      abortSignal: args.signal,
    },
  });
  const text = response.text;
  if (text === undefined || text.trim().length === 0) {
    throw new Error("モデルから応答が得られませんでした。再試行してください。");
  }
  return parseJsonResponse(text);
}

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

async function postChatCompletions(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new HttpStatusError(response.status, detail.slice(0, 400));
  }
  return response.json();
}

async function callOpenAiCompatible(args: ProviderCall): Promise<unknown> {
  const baseUrl = (args.profile.baseUrl ?? OPENAI_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const url = `${baseUrl}/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (args.profile.apiKey !== null) headers["Authorization"] = `Bearer ${args.profile.apiKey}`;
  const jsonSchema = geminiSchemaToJsonSchema(args.schema);
  const system = `${args.system}\n\n出力規約: 応答は次の JSON Schema に厳密に従う、単一の JSON オブジェクトのみとする。説明文・前置き・コードフェンスを付けない。\n${JSON.stringify(jsonSchema)}`;
  const base: Record<string, unknown> = {
    model: args.profile.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: args.contents },
    ],
    stream: false,
  };
  const responseFormat = { response_format: { type: "json_object" } };
  const withTemperature = { ...base, temperature: args.temperature };
  // HTTP 400 を返すサーバー向けの後退順:
  // response_format 非対応の互換サーバー → response_format なし、
  // temperature 非対応の推論系モデル(o3 など、温度がプロファイル未指定のときのみ) → temperature なし
  const attempts: Record<string, unknown>[] = [{ ...withTemperature, ...responseFormat }, withTemperature];
  if (args.profile.temperature === null) {
    attempts.push({ ...base, ...responseFormat }, base);
  }
  let payload: unknown;
  let rejected: HttpStatusError | null = null;
  for (const body of attempts) {
    try {
      // eslint-disable-next-line no-await-in-loop -- 前段の 400 を確認してからパラメータを削って再試行する
      payload = await postChatCompletions(url, headers, body, args.signal);
      rejected = null;
      break;
    } catch (err) {
      if (err instanceof HttpStatusError && err.status === 400) {
        rejected = err;
        continue;
      }
      throw err;
    }
  }
  if (rejected !== null) throw rejected;
  const content = (payload as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("モデルから応答が得られませんでした。再試行してください。");
  }
  return parseJsonResponse(content);
}

interface StructuredTask<T> {
  system: string;
  contents: string;
  schema: Schema;
  defaultTemperature: number;
  parse: (raw: unknown) => T;
}

async function runStructured<T>(kind: AssistKind, task: StructuredTask<T>): Promise<{ value: T; model: string }> {
  if (inflight.has(kind)) throw new Error(`${KIND_LABEL[kind]}を実行中です。完了をお待ちください。`);
  const controller = new AbortController();
  inflight.set(kind, controller);
  try {
    const settings = readSettings();
    const routing = settingsLlmRouting(settings);
    const chain = [routing.main, ...routing.fallbacks];
    const failures: string[] = [];
    for (const profile of chain) {
      if (controller.signal.aborted) throw new CancelledError();
      const call: ProviderCall = {
        profile,
        settings,
        system: task.system,
        contents: task.contents,
        schema: task.schema,
        temperature: profile.temperature ?? task.defaultTemperature,
        signal: controller.signal,
      };
      try {
        // eslint-disable-next-line no-await-in-loop -- フォールバックは前段の失敗を確認してから順に試す
        const raw = profile.provider === "gemini" ? await callGemini(call) : await callOpenAiCompatible(call);
        let value: T;
        try {
          value = task.parse(raw);
        } catch {
          throw new Error("応答が想定する形式ではありませんでした。再試行してください。");
        }
        return { value, model: llmProfileDisplayName(profile) };
      } catch (err) {
        if (controller.signal.aborted) throw new CancelledError();
        const friendly = friendlyError(err);
        if (chain.length === 1) throw friendly;
        failures.push(`${llmProfileDisplayName(profile)}: ${friendly.message}`);
      }
    }
    throw new Error(`すべてのモデルで失敗しました — ${failures.join(" ／ ")}`);
  } finally {
    inflight.delete(kind);
  }
}

export async function reviewSpec(content: string): Promise<AssistReview> {
  if (content.trim().length === 0) throw new Error("仕様書が空です。本文を書いてからレビューしてください。");
  if (content.length > MAX_SPEC_CHARS) throw new Error("仕様書が大きすぎてレビューできません(約 24 万字まで)。");
  const { value, model } = await runStructured("review", {
    system: SYSTEM_PROMPT,
    contents: `レビュー対象の仕様書(Markdown)は以下のとおりです。\n\n${content}`,
    schema: RESPONSE_SCHEMA,
    defaultTemperature: 0.2,
    parse: parseLensReport,
  });
  return { report: value, model };
}

const AUDIT_SYSTEM_PROMPT = `あなたは仕様書(spec)の整合性監査人「Fray」です。布のほつれを探すように、一つの仕様書の内部で互いに衝突している記述だけを検出します。

前提となる思想:
- 仕様書が内部で矛盾していると、実装 AI はどちらかを黙って選び、誤った実装が確定する。
- あなたの仕事は矛盾の指摘だけである。どちらが正しいかを決めることも、書き直すことも、欠落を埋めることもしない。
- 文書の外の知識と照合しない。文書の中の記述同士の衝突だけを見る。

次の 3 種類だけを報告する:

1. kind="value"(値の食い違い)
   同じ対象に対して異なる数値・期限・上限・形式が書かれている。
   例: 3 章では「タイムアウトは 30 秒」、5 章では「60 秒以内に応答」。

2. kind="behavior"(振る舞いの衝突)
   同じ状況に対して両立しない動作・要求が書かれている。
   例: ある節では「確認なしで削除する」、別の節では「削除前に必ず確認する」。必須と任意の食い違いも含む。

3. kind="term"(用語の衝突)
   同じ名前が別の概念に使われている、または文脈から同一とわかる概念に別の名前が使われていて、読者が別物と誤解しうる。
   単なる表記ゆれ(全角半角、長音の有無)は対象外。意味の取り違えが起きるものだけを報告する。

報告の規律:
- 確信があるものだけを報告する。解釈次第で両立しうるものは報告しない。
- excerptA と excerptB は本文からの逐語的な引用(要約・改変・省略記号の挿入を禁止)。衝突する二つの記述をそれぞれ一意に特定できる最小限の長さにする。
- reason には、なぜ両立しないかを一文で書く。
- 全体で最大 8 件。影響が大きい順に並べる。矛盾がなければ findings は空配列でよい。
- 原文の引用を除き、すべて日本語で書く。

verdict には文書全体の整合性への一行の所見を書く(80 字以内、断定調)。`;

const AUDIT_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    verdict: { type: Type.STRING },
    findings: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          kind: { type: Type.STRING, enum: ["value", "behavior", "term"] },
          excerptA: { type: Type.STRING },
          excerptB: { type: Type.STRING },
          reason: { type: Type.STRING },
        },
        required: ["kind", "excerptA", "excerptB", "reason"],
        propertyOrdering: ["kind", "excerptA", "excerptB", "reason"],
      },
    },
  },
  required: ["verdict", "findings"],
  propertyOrdering: ["verdict", "findings"],
};

export async function auditSpec(content: string): Promise<AssistAudit> {
  if (content.trim().length === 0) throw new Error("仕様書が空です。本文を書いてから検査してください。");
  if (content.length > MAX_SPEC_CHARS) throw new Error("仕様書が大きすぎて検査できません(約 24 万字まで)。");
  const { value, model } = await runStructured("audit", {
    system: AUDIT_SYSTEM_PROMPT,
    contents: `検査対象の仕様書(Markdown)は以下のとおりです。\n\n${content}`,
    schema: AUDIT_RESPONSE_SCHEMA,
    defaultTemperature: 0.2,
    parse: parseAuditReport,
  });
  return { report: value, model };
}

const WEAVE_SYSTEM_PROMPT = `あなたは仕様書(spec)の織り手「Loom」です。AI 駆動開発のための仕様書を書く人間を補助します。

前提となる思想:
- 仕様書の著者は人間である。あなたは内容を発明しない。
- 従来の AI 仕様生成は、短い依頼から尤もらしい仕様を丸ごと書き、書き手の意図を薄め、根拠のない具体で埋める。あなたはその逆を行く。
- あなたの仕事は二つだけ:
  (1) 人間が出した素材を、構造の通った仕様文に織り上げること(woven)。
  (2) 素材が沈黙していて、実装者が勝手に決めると手戻りが大きい「人間が決めるべき問い」を返すこと(questions)。

織り(woven)の規律:
- 素材と人間の回答に含まれる情報だけを使う。新しい機能・ユーザーストーリー・数値・技術選定・画面・手順を加えない。
- 言い回しの整形、重複の統合、並べ替え、見出し付け、箇条書き化、Given/When/Then 化は自由に行う。それが織りである。
- 高度を保つ: なぜ(意図)と何が起きるべきか(振る舞い)を中心に書く。どう作るか(実装)は素材が明示しているときだけ書く。
- 節立ての参考順序: 意図/背景 → ユーザーストーリー(優先度順) → 受け入れ条件 → 成功基準 → 制約・前提。素材に対応する内容が無い節は作らない。空の節や placeholder を残さない。
- 素材が沈黙している重大事項のうち、その箇所を読む実装者が誤解しうるものは、該当位置に 【未決定: 短い問い】 と置く。値や選択を仮置きしてはならない。
- Markdown (GFM) で書く。見出しは ## 以下。H1 とフロントマターは書かない(ドキュメント側に既にある)。
- 素材の言語に合わせる(既定は日本語)。
- 素材が空(または題名のみ)の場合、woven は空文字列にして、問いだけを返す。

問い(questions)の規律:
- 実装者が勝手に決めると手戻りが大きい順に、最大 6 件。些末な問いでノイズを増やさない。
- question は一文の開いた問いにする(はい/いいえで答えさせない)。
- whyItMatters は、その決定が何を左右するかを一文で書く。
- options は「考えられる方向」の見本であり、推奨ではない。2〜4 個。方向が開いていて見本が役立たない場合は空配列にする。
- 人間の回答(qa)で既に決まったことを再度問わない。
- topic は 2〜6 字の短い名詞(例: スコープ、対象者、優先度、失敗時)。
- 問いの観点の参考: 誰のための何か、最優先のユーザーストーリー、受け入れの判定方法、測れる成功基準、スコープ外、前提・依存。

入力の読み方:
- 「素材」は人間の生の断片(メモ、箇条書き、貼り付け)、または前回の織り上がりを人間が手直ししたもの。
- 「人間の回答」が付いている場合、その決定を織りに反映し、対応する 【未決定】 を解消する。
- 「現在の本文(参考)」は文体と重複回避の参考にのみ使う。そこから内容を織り込まない。`;

const WEAVE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    woven: { type: Type.STRING },
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          topic: { type: Type.STRING },
          question: { type: Type.STRING },
          whyItMatters: { type: Type.STRING },
          options: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["topic", "question", "whyItMatters", "options"],
        propertyOrdering: ["topic", "question", "whyItMatters", "options"],
      },
    },
  },
  required: ["woven", "questions"],
  propertyOrdering: ["woven", "questions"],
};

function buildWeaveContents(input: WeaveSpecInput): string {
  const parts: string[] = [];
  if (input.title.trim().length > 0) parts.push(`# 仕様書の題名\n\n${input.title.trim()}`);
  parts.push(`# 素材\n\n${input.material.trim().length > 0 ? input.material : "(空)"}`);
  if (input.qa.length > 0) {
    const lines = input.qa.map((pair) => `- 問い: ${pair.question}\n  決定: ${pair.answer}`);
    parts.push(`# 人間の回答\n\n${lines.join("\n")}`);
  }
  if (input.context.trim().length > 0) parts.push(`# 現在の本文(参考)\n\n${input.context}`);
  return parts.join("\n\n");
}

export async function weaveSpec(input: WeaveSpecInput): Promise<AssistWeave> {
  if (input.material.trim().length === 0 && input.qa.length === 0 && input.title.trim().length === 0) {
    throw new Error("素材がありません。メモや箇条書きを入れてから織ってください。");
  }
  const { value, model } = await runStructured("weave", {
    system: WEAVE_SYSTEM_PROMPT,
    contents: buildWeaveContents(input),
    schema: WEAVE_RESPONSE_SCHEMA,
    defaultTemperature: 0.3,
    parse: parseWeaveResult,
  });
  return { result: value, model };
}

const WARP_EARS_SYSTEM_PROMPT = `あなたは仕様書(spec)の整経師「Warp」です。人間が書いた要件の断片を、ユーザーストーリーと EARS 記法の受け入れ基準に張り直します。

前提となる思想:
- 仕様書の著者は人間である。あなたは内容を発明しない。
- 構造化の価値は、散文に埋もれた要求を検証可能な文として固定し、実装 AI の誤読を防ぐことにある。
- 素材に書かれていることだけを使う。素材にない役割・数値・条件・振る舞いを補ってはならない。

出力(output)の形式 — Markdown 断片:

### 要件: <素材から読み取れる短い名前>

**ユーザーストーリー:** <役割> として、<機能> がほしい。それは <便益> のためだ。

#### 受け入れ基準

1. WHEN <イベント> THEN <システム> SHALL <応答>
2. IF <望ましくない状況> THEN <システム> SHALL <応答>

規律:
- EARS キーワード(WHEN / IF / WHILE / WHERE / THEN / SHALL / AND)は英語大文字のまま使い、それ以外の文は素材の言語で書く(既定は日本語)。
- パターンの使い分け:
  - 常時成り立つ性質: <システム> SHALL <応答>
  - イベント駆動: WHEN <イベント> THEN <システム> SHALL <応答>
  - 状態の継続中: WHILE <状態> THEN <システム> SHALL <応答>
  - 望ましくない状況への防御: IF <状況> THEN <システム> SHALL <応答>
  - 機能が有効な場合のみ: WHERE <機能> THEN <システム> SHALL <応答>
  - 必要なら WHEN <イベント> AND <条件> THEN のように組み合わせる。
- 受け入れ基準は一文一要求。検証できない形容(高速、使いやすい 等)を要求にしない。素材に根拠の値があればそれを使う。
- 素材が複数の独立した要件を含むときは「### 要件:」の節を要件ごとに分ける。
- 素材が沈黙している箇所を埋めない。役割が読み取れなければ 【未決定: 誰のための機能か】 のように、該当位置に 【未決定: 短い問い】 を置く。値や選択を仮置きしてはならない。
- 見出しは ### と #### のみを使う(H1・H2 は使わない)。
- 素材の文意を保つ。新しい要求を増やさず、書かれた要求を漏らさない。

notes の規律:
- 構造化して初めて見える欠落・曖昧さを、人間が確認すべき一行として書く(最大 6 件)。例: 「失敗時の振る舞いが書かれていません」。
- 問題がなければ空配列。
- すべて日本語で書く。`;

const WARP_MERMAID_SYSTEM_PROMPT = `あなたは仕様書(spec)の製図師「Warp」です。人間が書いた流れ・状態・構造の記述から、Mermaid の図を起こします。

前提となる思想:
- 図は読み手の理解を速めるためにある。素材に書かれた構造を写し取るのであって、設計を発明するのではない。
- 素材に Mermaid コードが含まれる場合は、その意図を保ったまま、構文エラーの修正・整理・読みやすい並べ替えを行う。

規律:
- output には Mermaid コードだけを入れる。コードフェンス(\`\`\`)や説明文を含めない。
- 図の種類: 指定があればそれに従う。指定がなければ素材に最も合う種類を選ぶ。
  - 手順・分岐の流れ → flowchart TD
  - 参加者間のやり取り → sequenceDiagram
  - 状態と遷移 → stateDiagram-v2
  - データの関係 → erDiagram
  - 型・構成要素の関係 → classDiagram
  - 日程・工程 → gantt
- ノードやメッセージの文言は素材の言葉をそのまま使う(既定は日本語)。意訳で内容を変えない。
- 素材にない手順・分岐・状態・関係を加えない。素材が曖昧で複数の読み方がありうる場合は、最も素直な読みで描き、その旨を notes に書く。
- ノード ID は半角英数にし、表示文言はラベルに書く(例: login["ログイン"])。Mermaid の予約語と衝突する ID(end, click, class, style 等)を避ける。
- ラベルや文言に二重引用符・バッククォート・改行を入れない。長い文言は意味を保って短く刈り込む。
- 構文の正しさを最優先する。レンダリングできない図は無価値である。
- 素材が大きすぎて一枚に収まらない場合は最重要の流れに絞り、省いた範囲を notes に書く。

notes の規律:
- 人間が確認すべき点を一行ずつ書く(最大 6 件)。例: 「タイムアウト時の分岐は素材に無いため描いていません」。
- 無ければ空配列。
- すべて日本語で書く。`;

const WARP_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    output: { type: Type.STRING },
    notes: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["output", "notes"],
  propertyOrdering: ["output", "notes"],
};

function stripMermaidFence(code: string): string {
  const trimmed = code.trim();
  const match = trimmed.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  return match ? match[1]!.trim() : trimmed;
}

function buildWarpContents(input: WarpSpecInput): string {
  const parts: string[] = [];
  if (input.title.trim().length > 0) parts.push(`# 仕様書の題名\n\n${input.title.trim()}`);
  if (input.form === "mermaid") {
    parts.push(`# 図の種類\n\n${input.diagram === "auto" ? "指定なし(素材に合う種類を選ぶ)" : input.diagram}`);
  }
  parts.push(`# 素材\n\n${input.material}`);
  return parts.join("\n\n");
}

const TAILOR_SYSTEM_PROMPT = `あなたは仕様書(spec)の仕立て屋「Tailor」です。人間が確定させた仕様書から、実装 AI に渡すための実装計画を裁断します。

前提となる思想:
- 仕様書は「何を作るか」を定める。計画は「どの順で、どう確かめながら作るか」を定める。どちらも新しい要求を発明しない。
- 計画の価値は、実装 AI が一度に抱える文脈を小さく保ち、検証可能な単位で前進させることにある。
- 仕様書が沈黙している実装詳細(ライブラリ、ファイル構成、内部設計)を計画で勝手に決めてはならない。それは実装者の領分である。

approach(方針)の規律:
- 仕様書の意図から導かれる進め方を 2〜4 文で書く。どの振る舞いから着手しなぜその順か、を中心に。
- 仕様書に書かれていない技術選定を含めない。

tasks(タスク)の規律:
- 仕様書に書かれた振る舞い・受け入れ条件だけをタスクへ割り付ける。仕様にない作業(CI 整備、リファクタリング、ドキュメント整備など)を加えない。
- 各タスクは完了が検証できる最小単位。1 タスク = 1 つの首尾一貫した振る舞い。書かれた要求を漏らさない。
- title は短い一文。summary はそのタスクで実現する振る舞いを 1〜2 文で。
- acceptance には、そのタスクが満たす受け入れ条件・要求を仕様書から逐語で引用する(要約・改変を禁止)。散文の中にあるなら一意に特定できる最小の断片でよい。対応する記述が無いタスクは作らない。
- verification は完了を確かめる具体的な手順を一文(例: 「○○を操作し、□□が表示されることを確認する」)。仕様書にある値・条件をそのまま使う。
- dependsOn は先行が必要なタスクの番号(1 始まり)の配列。順序に意味がなければ空配列。
- size は相対規模: S(小さな一歩)、M(まとまった作業)、L(複数の振る舞いに跨がる)。L ばかりなら分割し直す。
- 全体で最大 ${MAX_TAILOR_TASKS} 件。多すぎる計画は読まれない。重要な流れが通る順に並べる。

blockers(着手をふさぐ未決定)の規律:
- 本文中の 【未決定: …】、および仕様の沈黙のうち実装者が勝手に決めると手戻りが大きい事項を、人間が決めるべき問いとして一行ずつ書く。
- 答えを提案しない。最大 8 件。無ければ空配列。

notes の規律:
- 計画に裁って初めて見える注意点を一行ずつ(最大 6 件)。例: 「タスク 3 と 5 は同じ画面に触れるため、続けて実装すると手戻りが少ない」。無ければ空配列。
- 原文の引用を除き、すべて日本語で書く。`;

const TAILOR_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    approach: { type: Type.STRING },
    tasks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          summary: { type: Type.STRING },
          acceptance: { type: Type.ARRAY, items: { type: Type.STRING } },
          verification: { type: Type.STRING },
          dependsOn: { type: Type.ARRAY, items: { type: Type.INTEGER } },
          size: { type: Type.STRING, enum: ["S", "M", "L"] },
        },
        required: ["title", "summary", "acceptance", "verification", "dependsOn", "size"],
        propertyOrdering: ["title", "summary", "acceptance", "verification", "dependsOn", "size"],
      },
    },
    blockers: { type: Type.ARRAY, items: { type: Type.STRING } },
    notes: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["approach", "tasks", "blockers", "notes"],
  propertyOrdering: ["approach", "tasks", "blockers", "notes"],
};

export async function tailorSpec(content: string): Promise<AssistTailor> {
  if (content.trim().length === 0) throw new Error("仕様書が空です。本文を書いてから計画を裁ってください。");
  if (content.length > MAX_SPEC_CHARS) throw new Error("仕様書が大きすぎます(約 24 万字まで)。");
  const { value, model } = await runStructured("tailor", {
    system: TAILOR_SYSTEM_PROMPT,
    contents: `実装計画の元になる仕様書(Markdown)は以下のとおりです。\n\n${content}`,
    schema: TAILOR_RESPONSE_SCHEMA,
    defaultTemperature: 0.2,
    parse: parseTailorPlan,
  });
  if (value.tasks.length === 0) {
    throw new Error("タスクに裁ける記述が見つかりませんでした。振る舞いや受け入れ条件を書いてから再試行してください。");
  }
  return { plan: value, model };
}

export async function warpSpec(input: WarpSpecInput): Promise<AssistWarp> {
  if (input.material.trim().length === 0) {
    throw new Error("素材がありません。本文の選択範囲やメモを入れてから張ってください。");
  }
  const { value, model } = await runStructured("warp", {
    system: input.form === "ears" ? WARP_EARS_SYSTEM_PROMPT : WARP_MERMAID_SYSTEM_PROMPT,
    contents: buildWarpContents(input),
    schema: WARP_RESPONSE_SCHEMA,
    defaultTemperature: 0.2,
    parse: parseWarpResult,
  });
  const output = input.form === "mermaid" ? stripMermaidFence(value.output) : value.output;
  if (output.trim().length === 0) {
    throw new Error("出力が得られませんでした。素材を見直して再試行してください。");
  }
  return { result: { ...value, output }, model };
}
