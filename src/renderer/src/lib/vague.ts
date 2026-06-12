// 検証できない曖昧な形容・副詞の辞書。要求文に現れたら、測定可能な
// 値・条件への置き換えを促す(Fray のローカル検査と Warp の EARS 検証で共有)。
// 誤検知がノイズになる語(「安定」「最適化」「多くの」等)は意図して載せていない

const JP_VAGUE_TERMS: readonly string[] = [
  "高速",
  "高性能",
  "速やかに",
  "即座に",
  "できるだけ",
  "可能な限り",
  "なるべく",
  "適切に",
  "適宜",
  "十分",
  "簡単に",
  "容易に",
  "使いやすい",
  "わかりやすい",
  "分かりやすい",
  "直感的",
  "大量",
  "柔軟",
  "効率的",
  "効率よく",
  "最適な",
  "必要に応じて",
  "快適に",
  "堅牢",
];

const EN_VAGUE_RE =
  /\b(?:fast|quickly|easily|user-friendly|appropriately|sufficient|flexible|efficient|intuitive|robust|as soon as possible)\b/gi;

export interface VagueHit {
  term: string;
  index: number;
}

/** テキスト中の曖昧語の出現を位置つきで列挙する(出現順) */
export function findVagueTerms(text: string): VagueHit[] {
  const hits: VagueHit[] = [];
  for (const term of JP_VAGUE_TERMS) {
    let from = 0;
    while (from < text.length) {
      const index = text.indexOf(term, from);
      if (index === -1) break;
      hits.push({ term, index });
      from = index + term.length;
    }
  }
  for (const match of text.matchAll(EN_VAGUE_RE)) {
    hits.push({ term: match[0], index: match.index });
  }
  return hits.sort((a, b) => a.index - b.index);
}
