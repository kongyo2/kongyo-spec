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

// 自動スナップショットの最小間隔。最新の自動版がこれより新しい間は撮らない。
// 編集の最終状態は本体ファイルに常にあるため、ここで失われるものはない
const AUTO_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
// 仕様書ごとの保持上限。超過時は自動・復元前の古い版から削り、手動版は最後まで残す
const MAX_SNAPSHOTS_PER_SPEC = 80;

let cachedDir: string | null = null;

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
  let entries: string[];
  try {
    entries = await fs.readdir(dirFor(specId));
  } catch {
    return [];
  }
  const metas: SnapshotMeta[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const snapshotId = entry.replace(/\.md$/, "");
    if (!isSafeId(snapshotId)) continue;
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential reads avoid exhausting the file-descriptor limit
      const raw = await fs.readFile(fileFor(specId, snapshotId), "utf8");
      metas.push({ ...parseSnapshotFrontmatter(parseFile(raw).data), id: snapshotId, specId });
    } catch (err) {
      console.warn(`[historyStore] skipping ${specId}/${entry}:`, err);
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
  const metas = await listSnapshots(specId);
  if (metas.length <= MAX_SNAPSHOTS_PER_SPEC) return;
  const excess = metas.length - MAX_SNAPSHOTS_PER_SPEC;
  const oldestFirst = [...metas].reverse();
  const expendable = [
    ...oldestFirst.filter((meta) => meta.kind !== "manual"),
    ...oldestFirst.filter((meta) => meta.kind === "manual"),
  ];
  for (const target of expendable.slice(0, excess)) {
    // eslint-disable-next-line no-await-in-loop -- removes a handful of files sequentially
    await fs.rm(fileFor(specId, target.id), { force: true }).catch(() => undefined);
  }
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
  };
  await writeSnapshot(meta, content);
  await pruneSnapshots(specId).catch((err: unknown) => {
    console.warn(`[historyStore] prune failed for ${specId}:`, err);
  });
  return meta;
}

export async function deleteSnapshot(specId: string, snapshotId: string): Promise<void> {
  assertSafe(specId, snapshotId);
  await fs.rm(fileFor(specId, snapshotId), { force: true });
}

export async function deleteHistory(specId: string): Promise<void> {
  assertSafe(specId);
  await fs.rm(dirFor(specId), { recursive: true, force: true });
}

/**
 * 保存パイプラインから呼ばれる自動スナップショット。上書きで失われる直前の内容を、
 * 間引きしながら留める。履歴は安全網であり本流の保存を妨げてはならないため、
 * 失敗はログに留めて握りつぶす。
 */
export async function recordAutoSnapshot(specId: string, prevContent: string): Promise<void> {
  try {
    const metas = await listSnapshots(specId);
    const latest = metas[0];
    if (!latest) {
      if (prevContent.trim().length === 0) return;
      await takeSnapshot(specId, prevContent, "auto", null);
      return;
    }
    if (latest.kind === "auto" && Date.now() - Date.parse(latest.takenAt) < AUTO_SNAPSHOT_INTERVAL_MS) return;
    const latestDoc = await readSnapshot(specId, latest.id);
    if (latestDoc.content === prevContent) return;
    await takeSnapshot(specId, prevContent, "auto", null);
  } catch (err) {
    console.warn(`[historyStore] auto snapshot failed for ${specId}:`, err);
  }
}
