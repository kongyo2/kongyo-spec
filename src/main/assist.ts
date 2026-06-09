import { ApiError, GoogleGenAI, Type, type Schema } from "@google/genai";
import { parseLensReport, type LensReport } from "@shared/schemas/assist";
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

let inflight = false;

export async function reviewSpec(content: string): Promise<LensReport> {
  if (content.trim().length === 0) throw new Error("仕様書が空です。本文を書いてからレビューしてください。");
  if (content.length > MAX_SPEC_CHARS) throw new Error("仕様書が大きすぎてレビューできません(約 24 万字まで)。");
  const settings = readSettings();
  if (settings.geminiApiKey === null) throw new Error("Gemini API キーが設定されていません。");
  if (inflight) throw new Error("レビューを実行中です。完了をお待ちください。");
  inflight = true;
  try {
    const ai = new GoogleGenAI({ apiKey: settings.geminiApiKey });
    const response = await ai.models.generateContent({
      model: settings.geminiModel,
      contents: `レビュー対象の仕様書(Markdown)は以下のとおりです。\n\n${content}`,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.2,
      },
    });
    const text = response.text;
    if (text === undefined || text.trim().length === 0) {
      throw new Error("Gemini から応答が得られませんでした。再試行してください。");
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error("Gemini の応答を解析できませんでした。再試行してください。");
    }
    try {
      return parseLensReport(raw);
    } catch {
      throw new Error("Gemini の応答が想定する形式ではありませんでした。再試行してください。");
    }
  } catch (err) {
    throw friendlyError(err);
  } finally {
    inflight = false;
  }
}
