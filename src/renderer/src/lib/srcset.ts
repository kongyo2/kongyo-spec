export interface SrcsetUrlToken {
  url: string;
  start: number;
  end: number;
}

function isWhitespace(char: string | undefined): boolean {
  return char !== undefined && /\s/.test(char);
}

// Splits a srcset value into its candidate URL tokens (with offsets), following the
// HTML candidate grammar: commas separate candidates, but commas inside a data: URL
// belong to the URL and must be preserved.
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
    while (end > start && value[end - 1] === ",") end--;
    if (end > start) tokens.push({ url: value.slice(start, end), start, end });
    while (i < n && isWhitespace(value[i])) i++;
    while (i < n && value[i] !== ",") i++;
  }
  return tokens;
}
