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
