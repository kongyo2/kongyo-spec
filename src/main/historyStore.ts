import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { parseFile, stringifyFile } from "@shared/frontmatter";
import {
  byTakenAtDesc,
  parseSnapshotFrontmatter,
  type SnapshotDocument,
  type SnapshotKind,
  type SnapshotMeta,
} from "@shared/schemas/history";
import { readSettings } from "./settingsStore";

// 自動スナップショットの最小間隔。最新の自動版がこれより新しい間は撮らない。
// 編集の最終状態は本体ファイルに常にあるため、ここで失われるものはない
function autoSnapshotIntervalMs(): number {
  return readSettings().autoSnapshotMinutes * 60 * 1000;
}
// 仕様書ごとの保持上限。超過時は自動・復元前の古い版から削り、手動版は最後まで
// 残す。ピン留めされた版は種別を問わず削除対象にしない
function maxSnapshotsPerSpec(): number {
  return readSettings().maxSnapshotsPerSpec;
}
// frontmatter は短い行が 8 つだけ(label も 120 字上限)で、この先頭チャンクに必ず収まる
const META_READ_BYTES = 4096;

let cachedDir: string | null = null;

// 仕様書ごとの最新スナップショット。保存のたびに走る自動スナップショットの間引き
// 判定が履歴ディレクトリを総なめしないための、main プロセス内キャッシュ。
// null は「スナップショットが 1 つもない」ことの確認済みを表す
const latestCache = new Map<string, { meta: SnapshotMeta; content: string } | null>();

function getHistoryDir(): string {
  if (cachedDir === null) {
    cachedDir = join(app.getPath("userData"), "specs", "history");
  }
  return cachedDir;
}

function dirFor(specId: string): string {
  return join(getHistoryDir(), specId);
}

function fileFor(specId: string, snapshotId: string): string {
  return join(dirFor(specId), `${snapshotId}.md`);
}

function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(id) && id !== "." && !id.includes("..");
}

function assertSafe(specId: string, snapshotId?: string): void {
  if (!isSafeId(specId)) throw new Error(`invalid spec id: ${specId}`);
  if (snapshotId !== undefined && !isSafeId(snapshotId)) throw new Error(`invalid snapshot id: ${snapshotId}`);
}

function isENOENT(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

// POSIX 流(末尾改行は行の終端であって空行ではない)。renderer の差分表示の
// 行数とここで保存する行数が一致するよう、定義を揃えている
function countLines(content: string): number {
  if (content.length === 0) return 0;
  let lines = 0;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) lines += 1;
  }
  if (!content.endsWith("\n")) lines += 1;
  return lines;
}

/** ディレクトリ内のスナップショット id を列挙。ディレクトリ未作成のみ空として扱う */
async function listSnapshotIds(specId: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dirFor(specId));
  } catch (err) {
    if (isENOENT(err)) return [];
    throw err;
  }
  return entries
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => entry.slice(0, -3))
    .filter(isSafeId);
}

/** 先頭チャンクだけ読んで frontmatter をパースする。閉じ区切りがチャンク外なら全読みへ */
async function readSnapshotMeta(specId: string, snapshotId: string): Promise<SnapshotMeta> {
  const handle = await fs.open(fileFor(specId, snapshotId), "r");
  let head: string;
  try {
    const buffer = Buffer.alloc(META_READ_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, META_READ_BYTES, 0);
    head = buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
  try {
    return { ...parseSnapshotFrontmatter(parseFile(head).data), id: snapshotId, specId };
  } catch {
    const raw = await fs.readFile(fileFor(specId, snapshotId), "utf8");
    return { ...parseSnapshotFrontmatter(parseFile(raw).data), id: snapshotId, specId };
  }
}

function newestIdByFilename(ids: string[]): string | null {
  let best: string | null = null;
  let bestStamp = -1;
  for (const id of ids) {
    const match = /^(\d+)-/.exec(id);
    if (!match) continue;
    const stamp = Number(match[1]);
    if (stamp > bestStamp || (stamp === bestStamp && (best === null || id > best))) {
      best = id;
      bestStamp = stamp;
    }
  }
  return best;
}

async function getLatestSnapshot(specId: string): Promise<{ meta: SnapshotMeta; content: string } | null> {
  const cached = latestCache.get(specId);
  if (cached !== undefined) return cached;
  const newestId = newestIdByFilename(await listSnapshotIds(specId));
  const entry = newestId === null ? null : await readSnapshot(specId, newestId);
  latestCache.set(specId, entry);
  return entry;
}

function invalidateIfLatest(specId: string, snapshotId: string): void {
  const cached = latestCache.get(specId);
  if (cached != null && cached.meta.id === snapshotId) latestCache.delete(specId);
}

async function writeSnapshot(meta: SnapshotMeta, content: string): Promise<void> {
  const serialized = stringifyFile(
    {
      id: meta.id,
      specId: meta.specId,
      takenAt: meta.takenAt,
      kind: meta.kind,
      label: meta.label ?? "",
      lines: String(meta.lines),
      chars: String(meta.chars),
      pinned: meta.pinned ? "true" : "",
    },
    content,
  );
  const destination = fileFor(meta.specId, meta.id);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, serialized, "utf8");
  await fs.rename(temporary, destination);
}

export async function listSnapshots(specId: string): Promise<SnapshotMeta[]> {
  assertSafe(specId);
  const ids = await listSnapshotIds(specId);
  const metas: SnapshotMeta[] = [];
  for (const snapshotId of ids) {
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential reads avoid exhausting the file-descriptor limit
      metas.push(await readSnapshotMeta(specId, snapshotId));
    } catch (err) {
      // 1 ファイルの破損で履歴全体が見えなくなるよりはスキップして残りを出す
      console.warn(`[historyStore] skipping ${specId}/${snapshotId}.md:`, err);
    }
  }
  metas.sort(byTakenAtDesc);
  return metas;
}

export async function readSnapshot(specId: string, snapshotId: string): Promise<SnapshotDocument> {
  assertSafe(specId, snapshotId);
  const raw = await fs.readFile(fileFor(specId, snapshotId), "utf8");
  const parsed = parseFile(raw);
  return { meta: { ...parseSnapshotFrontmatter(parsed.data), id: snapshotId, specId }, content: parsed.content };
}

async function pruneSnapshots(specId: string): Promise<void> {
  const limit = maxSnapshotsPerSpec();
  // 上限内なら readdir(ファイル名のみ)で済ませ、超過したときだけメタを読む
  const ids = await listSnapshotIds(specId);
  if (ids.length <= limit) return;
  const metas = await listSnapshots(specId);
  // ピン留めはユーザーが「消さない」と宣言した版。上限超過の犠牲にしない
  const oldestFirst = [...metas].reverse().filter((meta) => !meta.pinned);
  // ピン留めだけで上限が埋まっていても、直近の非ピン版は必ず 1 つ残す。撮った直後の
  // 版 (手動・安全網) をその場で消して「留めた」と偽らないため、総数の超過を許す
  const keepUnpinned = Math.max(limit - (metas.length - oldestFirst.length), 1);
  const excess = oldestFirst.length - keepUnpinned;
  if (excess <= 0) return;
  const expendable = [
    ...oldestFirst.filter((meta) => meta.kind !== "manual"),
    ...oldestFirst.filter((meta) => meta.kind === "manual"),
  ];
  for (const target of expendable.slice(0, excess)) {
    // eslint-disable-next-line no-await-in-loop -- removes a handful of files sequentially
    await fs.rm(fileFor(specId, target.id), { force: true }).catch(() => undefined);
    invalidateIfLatest(specId, target.id);
  }
}

/**
 * 全仕様書の履歴へ保持上限を適用する。上限を下げた直後に呼ばれ、次のスナップショット
 * を待たずに既存の超過分を間引く。管理操作であり本流を妨げないため、失敗はログに留める。
 */
async function pruneAllHistories(shouldYield: () => boolean): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(getHistoryDir());
  } catch (err) {
    if (!isENOENT(err)) console.warn("[historyStore] prune-all failed to list histories:", err);
    return;
  }
  for (const entry of entries) {
    // 走行中に上限が変わって再予約された場合は途中でやめ、新しい設定での再実行へ譲る
    if (shouldYield()) return;
    if (!isSafeId(entry)) continue;
    // eslint-disable-next-line no-await-in-loop -- 仕様書ごとに順へ間引いて FD と I/O を抑える
    await pruneSnapshots(entry).catch((err: unknown) => {
      console.warn(`[historyStore] prune failed for ${entry}:`, err);
    });
  }
}

// 保持上限の連続変更 (プリセットの選び直し) で、低い上限の間引きが高い上限への訂正後も
// 削除を続けないための予約機構。落ち着くまで待ってから最終値で 1 回だけ走らせる
const PRUNE_ALL_DEBOUNCE_MS = 3000;
let pruneAllTimer: ReturnType<typeof setTimeout> | null = null;
let pruneAllRunning = false;
let pruneAllRerun = false;

async function runPruneAll(): Promise<void> {
  if (pruneAllRunning) {
    pruneAllRerun = true;
    return;
  }
  pruneAllRunning = true;
  try {
    await pruneAllHistories(() => pruneAllRerun);
  } finally {
    pruneAllRunning = false;
    if (pruneAllRerun) {
      pruneAllRerun = false;
      void runPruneAll();
    }
  }
}

/** 保持上限の変更後に全履歴の間引きを予約する。各仕様書の間引きは実行時点の設定を読む */
export function schedulePruneAllHistories(): void {
  if (pruneAllTimer !== null) clearTimeout(pruneAllTimer);
  if (pruneAllRunning) pruneAllRerun = true;
  pruneAllTimer = setTimeout(() => {
    pruneAllTimer = null;
    void runPruneAll();
  }, PRUNE_ALL_DEBOUNCE_MS);
}

export async function takeSnapshot(
  specId: string,
  content: string,
  kind: SnapshotKind,
  label: string | null,
): Promise<SnapshotMeta> {
  assertSafe(specId);
  await fs.mkdir(dirFor(specId), { recursive: true });
  const meta: SnapshotMeta = {
    id: `${Date.now()}-${randomUUID().slice(0, 8)}`,
    specId,
    takenAt: new Date().toISOString(),
    kind,
    label,
    lines: countLines(content),
    chars: content.length,
    pinned: false,
  };
  await writeSnapshot(meta, content);
  latestCache.set(specId, { meta, content });
  await pruneSnapshots(specId).catch((err: unknown) => {
    console.warn(`[historyStore] prune failed for ${specId}:`, err);
  });
  return meta;
}

export async function deleteSnapshot(specId: string, snapshotId: string): Promise<void> {
  assertSafe(specId, snapshotId);
  await fs.rm(fileFor(specId, snapshotId), { force: true });
  invalidateIfLatest(specId, snapshotId);
}

/** ピン留めの切り替え。frontmatter を書き換えた新しいメタを返す */
export async function setSnapshotPinned(specId: string, snapshotId: string, pinned: boolean): Promise<SnapshotMeta> {
  assertSafe(specId, snapshotId);
  const snapshot = await readSnapshot(specId, snapshotId);
  if (snapshot.meta.pinned === pinned) return snapshot.meta;
  const meta: SnapshotMeta = { ...snapshot.meta, pinned };
  await writeSnapshot(meta, snapshot.content);
  const cached = latestCache.get(specId);
  if (cached != null && cached.meta.id === snapshotId) {
    latestCache.set(specId, { meta, content: snapshot.content });
  }
  return meta;
}

export async function deleteHistory(specId: string): Promise<void> {
  assertSafe(specId);
  await fs.rm(dirFor(specId), { recursive: true, force: true });
  latestCache.set(specId, null);
}

/**
 * 保存パイプラインから呼ばれる自動スナップショット。上書きで失われる直前の内容を、
 * 間引きしながら留める。定常時はキャッシュ済みの最新版との比較だけで済み、ディスク
 * には触れない。履歴は安全網であり本流の保存を妨げてはならないため、失敗はログに
 * 留めて握りつぶす。
 */
export async function recordAutoSnapshot(specId: string, prevContent: string, prevUpdatedAt: string): Promise<void> {
  try {
    const latest = await getLatestSnapshot(specId);
    if (latest === null) {
      if (prevContent.trim().length === 0) return;
      await takeSnapshot(specId, prevContent, "auto", null);
      return;
    }
    if (latest.content === prevContent) return;
    // 種別を問わず、最新版から設定間隔が明けるまでは自動版を増やさない (途中経過の
    // 間引き)。ただし、上書きされる内容が最新版の撮影より前にディスクへ書かれたもの
    // なら話が別で、それはどの版にも含まれていない (版を撮った時点で未保存の編集が
    // あった場合に起きる)。間引くと永久に失われるため、間隔に関わらず留める
    const prevPredatesLatest = Date.parse(prevUpdatedAt) < Date.parse(latest.meta.takenAt);
    if (!prevPredatesLatest && Date.now() - Date.parse(latest.meta.takenAt) < autoSnapshotIntervalMs()) {
      return;
    }
    await takeSnapshot(specId, prevContent, "auto", null);
  } catch (err) {
    console.warn(`[historyStore] auto snapshot failed for ${specId}:`, err);
  }
}
