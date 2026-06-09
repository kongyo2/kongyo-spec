import { ApiError, GoogleGenAI, Type, type Schema } from "@google/genai";
import {
  parseLensReport,
  parseWeaveResult,
  type LensReport,
  type WeaveResult,
  type WeaveSpecInput,
} from "@shared/schemas/assist";
import type { GeminiModel } from "@shared/schemas/settings";
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

function friendlyError(err: unknown): Error {
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) {
      return new Error("Gemini API キーが拒否されました。設定でキーを確認してください。");
    }
    if (err.status === 400) {
      return new Error("Gemini API がリクエストを受け付けませんでした。API キーと本文を確認してください。");
    }
    if (err.status === 429) {
      return new Error("Gemini API のレート上限に達しました。少し待ってから再試行してください。");
    }
    if (err.status >= 500) {
      return new Error("Gemini 側で障害が発生しています。時間をおいて再試行してください。");
    }
    return new Error(`Gemini API エラー (HTTP ${err.status})`);
  }
  if (err instanceof Error && /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network/i.test(err.message)) {
    return new Error("ネットワークに接続できません。接続を確認して再試行してください。");
  }
  return err instanceof Error ? err : new Error(String(err));
}

async function generateStructured(args: {
  model: GeminiModel;
  system: string;
  contents: string;
  schema: Schema;
  temperature: number;
}): Promise<unknown> {
  const settings = readSettings();
  if (settings.geminiApiKey === null) throw new Error("Gemini API キーが設定されていません。");
  const ai = new GoogleGenAI({ apiKey: settings.geminiApiKey });
  const response = await ai.models.generateContent({
    model: args.model,
    contents: args.contents,
    config: {
      systemInstruction: args.system,
      responseMimeType: "application/json",
      responseSchema: args.schema,
      temperature: args.temperature,
    },
  });
  const text = response.text;
  if (text === undefined || text.trim().length === 0) {
    throw new Error("Gemini から応答が得られませんでした。再試行してください。");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Gemini の応答を解析できませんでした。再試行してください。");
  }
}

let reviewInflight = false;

export async function reviewSpec(content: string, model: GeminiModel): Promise<LensReport> {
  if (content.trim().length === 0) throw new Error("仕様書が空です。本文を書いてからレビューしてください。");
  if (content.length > MAX_SPEC_CHARS) throw new Error("仕様書が大きすぎてレビューできません(約 24 万字まで)。");
  if (reviewInflight) throw new Error("レビューを実行中です。完了をお待ちください。");
  reviewInflight = true;
  try {
    const raw = await generateStructured({
      model,
      system: SYSTEM_PROMPT,
      contents: `レビュー対象の仕様書(Markdown)は以下のとおりです。\n\n${content}`,
      schema: RESPONSE_SCHEMA,
      temperature: 0.2,
    });
    try {
      return parseLensReport(raw);
    } catch {
      throw new Error("Gemini の応答が想定する形式ではありませんでした。再試行してください。");
    }
  } catch (err) {
    throw friendlyError(err);
  } finally {
    reviewInflight = false;
  }
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

let weaveInflight = false;

export async function weaveSpec(input: WeaveSpecInput): Promise<WeaveResult> {
  if (input.material.trim().length === 0 && input.qa.length === 0 && input.title.trim().length === 0) {
    throw new Error("素材がありません。メモや箇条書きを入れてから織ってください。");
  }
  if (weaveInflight) throw new Error("織りを実行中です。完了をお待ちください。");
  weaveInflight = true;
  try {
    const raw = await generateStructured({
      model: input.model,
      system: WEAVE_SYSTEM_PROMPT,
      contents: buildWeaveContents(input),
      schema: WEAVE_RESPONSE_SCHEMA,
      temperature: 0.3,
    });
    try {
      return parseWeaveResult(raw);
    } catch {
      throw new Error("Gemini の応答が想定する形式ではありませんでした。再試行してください。");
    }
  } catch (err) {
    throw friendlyError(err);
  } finally {
    weaveInflight = false;
  }
}
