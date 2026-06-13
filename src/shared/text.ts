export function countLines(text: string): number {
  if (text.length === 0) return 0;
  let lines = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lines += 1;
  }
  if (!text.endsWith("\n")) lines += 1;
  return lines;
}
