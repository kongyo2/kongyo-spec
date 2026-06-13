// POSIX 流の行数計算(末尾改行は行の終端であって空行ではない)。main が履歴に記録する
// 行数と renderer の差分表示の行数を一致させるため、両プロセスがこの 1 つを使う
export function countLines(text: string): number {
  if (text.length === 0) return 0;
  let lines = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lines += 1;
  }
  if (!text.endsWith("\n")) lines += 1;
  return lines;
}
