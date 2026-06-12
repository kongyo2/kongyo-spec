export type DiffOpKind = "same" | "add" | "del";

export interface DiffOp {
  kind: DiffOpKind;
  text: string;
}

export interface DiffSkipRow {
  kind: "skip";
  count: number;
}

export type DiffRow = DiffOp | DiffSkipRow;

export interface DiffStats {
  added: number;
  removed: number;
}

// 編集距離の探索上限。普通の編集では共通部の剥離後の D は小さく、
// これを超えるのは全面書き換えに近いケースなので粗い差分へ切り替える
const MAX_EDIT_DISTANCE = 1200;
// 折りたたみ行 1 行に満たない節約しかできない省略はしない
const MIN_FOLD_RUN = 4;
// 両文書の合計がこれを超えたら diffLines を呼ばない(粗い差分でも全行を
// オブジェクト化して走査するため、超巨大入力では renderer が固まる)
export const MAX_DIFF_TOTAL_LINES = 30_000;

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

// 配列を作らずに行数だけ数える(POSIX 流: 末尾改行は行終端)
function countTextLines(text: string): number {
  if (text.length === 0) return 0;
  let lines = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lines += 1;
  }
  if (!text.endsWith("\n")) lines += 1;
  return lines;
}

export interface DiffSizes {
  oldLines: number;
  newLines: number;
  tooLarge: boolean;
}

/** diffLines を呼ぶ前の軽量な規模チェック。tooLarge なら差分計算を諦めること */
export function diffSizes(oldText: string, newText: string): DiffSizes {
  const oldLines = countTextLines(oldText);
  const newLines = countTextLines(newText);
  return { oldLines, newLines, tooLarge: oldLines + newLines > MAX_DIFF_TOTAL_LINES };
}

function coarseDiff(a: string[], b: string[]): DiffOp[] {
  return [...a.map((text): DiffOp => ({ kind: "del", text })), ...b.map((text): DiffOp => ({ kind: "add", text }))];
}

// Myers O((N+M)D) 差分。trace は各ステップの k 範囲 [-d, d] のみ保持して
// メモリを D^2 に抑える。D が上限を超えたら null(呼び出し側でフォールバック)
function myers(a: string[], b: string[]): DiffOp[] | null {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((text): DiffOp => ({ kind: "add", text }));
  if (m === 0) return a.map((text): DiffOp => ({ kind: "del", text }));
  const max = Math.min(n + m, MAX_EDIT_DISTANCE);
  const offset = max;
  const v = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice(Math.max(0, offset - d), offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) {
        x = v[offset + k + 1]!;
      } else {
        x = v[offset + k - 1]! + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  if (!found) return null;

  const ops: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const prev = trace[d]!;
    const prevOffset = d; // trace[d] は k ∈ [-d, d] を [0, 2d] に詰めたもの
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && prev[prevOffset + k - 1]! < prev[prevOffset + k + 1]!)) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = prev[prevOffset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      ops.push({ kind: "same", text: a[x]! });
    }
    if (prevK === k + 1) {
      y -= 1;
      ops.push({ kind: "add", text: b[y]! });
    } else {
      x -= 1;
      ops.push({ kind: "del", text: a[x]! });
    }
  }
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    ops.push({ kind: "same", text: a[x]! });
  }
  ops.reverse();
  return ops;
}

/** 行単位の差分。old → new へ何が起きたかを上から順の行列で返す */
export function diffLines(oldText: string, newText: string): DiffOp[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const headA = a.slice(start, endA);
  const headB = b.slice(start, endB);
  const core = myers(headA, headB) ?? coarseDiff(headA, headB);
  return [
    ...a.slice(0, start).map((text): DiffOp => ({ kind: "same", text })),
    ...core,
    ...a.slice(endA).map((text): DiffOp => ({ kind: "same", text })),
  ];
}

export function diffStats(ops: DiffOp[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.kind === "add") added += 1;
    else if (op.kind === "del") removed += 1;
  }
  return { added, removed };
}

/** 変更から離れた無変更行を「… n 行 …」へ折りたたみ、文脈 context 行を残す */
export function foldContext(ops: DiffOp[], context = 3): DiffRow[] {
  const rows: DiffRow[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i]!.kind !== "same") {
      rows.push(ops[i]!);
      i += 1;
      continue;
    }
    let j = i;
    while (j < ops.length && ops[j]!.kind === "same") j += 1;
    const keepBefore = i === 0 ? 0 : context;
    const keepAfter = j === ops.length ? 0 : context;
    if (j - i > keepBefore + keepAfter + MIN_FOLD_RUN) {
      for (let k = i; k < i + keepBefore; k++) rows.push(ops[k]!);
      rows.push({ kind: "skip", count: j - i - keepBefore - keepAfter });
      for (let k = j - keepAfter; k < j; k++) rows.push(ops[k]!);
    } else {
      for (let k = i; k < j; k++) rows.push(ops[k]!);
    }
    i = j;
  }
  return rows;
}
