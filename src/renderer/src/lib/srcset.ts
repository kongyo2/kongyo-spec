export interface SrcsetUrlToken {
  url: string;
  start: number;
  end: number;
}

function isWhitespace(char: string | undefined): boolean {
  return char !== undefined && /\s/.test(char);
}

export function srcsetUrlTokens(value: string): SrcsetUrlToken[] {
  const tokens: SrcsetUrlToken[] = [];
  const n = value.length;
  let i = 0;
  while (i < n) {
    while (i < n && (isWhitespace(value[i]) || value[i] === ",")) i++;
    if (i >= n) break;
    const start = i;
    const isData = value.slice(i, i + 5).toLowerCase() === "data:";
    if (isData) {
      while (i < n && !isWhitespace(value[i])) i++;
    } else {
      while (i < n && !isWhitespace(value[i]) && value[i] !== ",") i++;
    }
    let end = i;
    let sawComma = false;
    while (end > start && value[end - 1] === ",") {
      end--;
      sawComma = true;
    }
    if (end > start) tokens.push({ url: value.slice(start, end), start, end });
    if (!sawComma) {
      while (i < n && isWhitespace(value[i])) i++;
      while (i < n && value[i] !== ",") i++;
    }
  }
  return tokens;
}
