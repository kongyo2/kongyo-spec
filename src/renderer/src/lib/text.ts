/** content 内で line 行目(0 始まり)が始まる文字オフセット。範囲外なら末尾を返す */
export function lineStartOffset(content: string, line: number): number {
  let offset = 0;
  for (let current = 0; current < line; current++) {
    const newline = content.indexOf("\n", offset);
    if (newline === -1) return content.length;
    offset = newline + 1;
  }
  return offset;
}
