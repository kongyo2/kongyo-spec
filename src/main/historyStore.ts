import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { parseFile, stringifyFile } from "@shared/frontmatter";
import {
  byTakenAtDesc,
  parseSnapshotFrontmatter,
  type SnapshotDocument,
  type SnapshotKind,
  type SnapshotMeta,
} from "@shared/schemas/history";
import { countLines } from "@shared/text";
import { atomicWrite, isSafeId, userDataPath } from "./fsStore";
import { readSettings } from "./settingsStore";

function autoSnapshotIntervalMs(): number {
  return readSettings().autoSnapshotMinutes * 60 * 1000;
}
function maxSnapshotsPerSpec(): number {
  return readSettings().maxSnapshotsPerSpec;
}
const META_READ_BYTES = 4096;

const latestCache = new Map<string, { meta: SnapshotMeta; content: string } | null>();

function getHistoryDir(): string {
  return userDataPath("specs", "history");
}

function dirFor(specId: string): string {
  return join(getHistoryDir(), specId);
}

function fileFor(specId: string, snapshotId: string): string {
  return join(dirFor(specId), `${snapshotId}.md`);
}

function assertSafe(specId: string, snapshotId?: string): void {
  if (!isSafeId(specId)) throw new Error(`invalid spec id: ${specId}`);
  if (snapshotId !== undefined && !isSafeId(snapshotId)) throw new Error(`invalid snapshot id: ${snapshotId}`);
}

function isENOENT(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

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
  await atomicWrite(fileFor(meta.specId, meta.id), serialized);
}

export async function listSnapshots(specId: string): Promise<SnapshotMeta[]> {
  assertSafe(specId);
  const ids = await listSnapshotIds(specId);
  const metas: SnapshotMeta[] = [];
  for (const snapshotId of ids) {
    try {
      // eslint-disable-next-line no-await-in-loop
      metas.push(await readSnapshotMeta(specId, snapshotId));
    } catch (err) {
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
  const ids = await listSnapshotIds(specId);
  if (ids.length <= limit) return;
  const metas = await listSnapshots(specId);
  const oldestFirst = [...metas].reverse().filter((meta) => !meta.pinned);
  const keepUnpinned = Math.max(limit - (metas.length - oldestFirst.length), 1);
  const excess = oldestFirst.length - keepUnpinned;
  if (excess <= 0) return;
  const expendable = [
    ...oldestFirst.filter((meta) => meta.kind !== "manual"),
    ...oldestFirst.filter((meta) => meta.kind === "manual"),
  ];
  for (const target of expendable.slice(0, excess)) {
    // eslint-disable-next-line no-await-in-loop
    await fs.rm(fileFor(specId, target.id), { force: true }).catch(() => undefined);
    invalidateIfLatest(specId, target.id);
  }
}

async function pruneAllHistories(shouldYield: () => boolean): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(getHistoryDir());
  } catch (err) {
    if (!isENOENT(err)) console.warn("[historyStore] prune-all failed to list histories:", err);
    return;
  }
  for (const entry of entries) {
    if (shouldYield()) return;
    if (!isSafeId(entry)) continue;
    // eslint-disable-next-line no-await-in-loop
    await pruneSnapshots(entry).catch((err: unknown) => {
      console.warn(`[historyStore] prune failed for ${entry}:`, err);
    });
  }
}

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

export async function recordAutoSnapshot(specId: string, prevContent: string, prevUpdatedAt: string): Promise<void> {
  try {
    const latest = await getLatestSnapshot(specId);
    if (latest === null) {
      if (prevContent.trim().length === 0) return;
      await takeSnapshot(specId, prevContent, "auto", null);
      return;
    }
    if (latest.content === prevContent) return;
    const prevPredatesLatest = Date.parse(prevUpdatedAt) < Date.parse(latest.meta.takenAt);
    if (!prevPredatesLatest && Date.now() - Date.parse(latest.meta.takenAt) < autoSnapshotIntervalMs()) {
      return;
    }
    await takeSnapshot(specId, prevContent, "auto", null);
  } catch (err) {
    console.warn(`[historyStore] auto snapshot failed for ${specId}:`, err);
  }
}
