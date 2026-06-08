import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { app } from "electron";
import { parseFile, stringifyFile } from "@shared/frontmatter";
import { byUpdatedDesc, parseFrontmatter, type SpecDocument, type SpecMeta } from "@shared/schemas/spec";

export interface ImportSpecEntry {
  id: string;
  title: string;
  content: string;
}

export interface ImportAssetOp {
  srcFile: string;
  url: string;
  dest: string;
}

export interface ImportBatch {
  specs: ImportSpecEntry[];
  assets: ImportAssetOp[];
}

const MAX_ASSET_BYTES = 25 * 1024 * 1024;

let cachedDir: string | null = null;

export function getSpecsDir(): string {
  if (cachedDir === null) {
    cachedDir = join(app.getPath("userData"), "specs");
  }
  return cachedDir;
}

function fileFor(id: string): string {
  return join(getSpecsDir(), `${id}.md`);
}

function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(id) && !id.includes("..");
}

function nowIso(): string {
  return new Date().toISOString();
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(getSpecsDir(), { recursive: true });
}

const locks = new Map<string, Promise<unknown>>();

function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  locks.set(
    id,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

async function writeSpec(meta: SpecMeta, content: string): Promise<void> {
  const serialized = stringifyFile(
    { id: meta.id, title: meta.title, createdAt: meta.createdAt, updatedAt: meta.updatedAt },
    content,
  );
  const destination = fileFor(meta.id);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, serialized, "utf8");
  await fs.rename(temporary, destination);
}

export async function initStore(): Promise<void> {
  await ensureDir();
}

export async function listSpecs(): Promise<SpecMeta[]> {
  await ensureDir();
  const entries = await fs.readdir(getSpecsDir());
  const metas: SpecMeta[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const id = entry.replace(/\.md$/, "");
    if (!isSafeId(id)) continue;
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential reads avoid exhausting the file-descriptor limit
      const raw = await fs.readFile(join(getSpecsDir(), entry), "utf8");
      metas.push({ ...parseFrontmatter(parseFile(raw).data), id });
    } catch (err) {
      console.warn(`[specsStore] skipping ${entry}:`, err);
    }
  }
  metas.sort(byUpdatedDesc);
  return metas;
}

export async function readSpec(id: string): Promise<SpecDocument> {
  if (!isSafeId(id)) throw new Error(`invalid spec id: ${id}`);
  const raw = await fs.readFile(fileFor(id), "utf8");
  const parsed = parseFile(raw);
  return { meta: { ...parseFrontmatter(parsed.data), id }, content: parsed.content };
}

export async function createSpec(title: string): Promise<SpecMeta> {
  await ensureDir();
  const stamp = nowIso();
  const meta: SpecMeta = { id: randomUUID(), title, createdAt: stamp, updatedAt: stamp };
  await writeSpec(meta, `# ${title}\n\nここに仕様を書きます。\n`);
  return meta;
}

function assetsDirFor(id: string): string {
  return join(getSpecsDir(), "assets", id);
}

async function copyImportedAsset(specsDir: string, op: ImportAssetOp): Promise<void> {
  const destination = join(specsDir, op.dest);
  if (destination !== specsDir && !destination.startsWith(specsDir + sep)) return;
  let source: string;
  try {
    source = decodeURIComponent(op.url);
  } catch {
    source = op.url;
  }
  const absolute = resolve(dirname(op.srcFile), source);
  try {
    const stat = await fs.stat(absolute);
    if (!stat.isFile() || stat.size > MAX_ASSET_BYTES) return;
    await fs.mkdir(dirname(destination), { recursive: true });
    await fs.copyFile(absolute, destination);
  } catch (err) {
    console.warn(`[specsStore] skipping asset ${op.url}:`, err);
  }
}

export async function importSpecs(batch: ImportBatch): Promise<SpecMeta[]> {
  await ensureDir();
  const specsDir = getSpecsDir();
  for (const op of batch.assets) {
    // eslint-disable-next-line no-await-in-loop -- sequential copies keep the file-descriptor count bounded
    await copyImportedAsset(specsDir, op);
  }
  const stamp = nowIso();
  const metas: SpecMeta[] = [];
  for (const entry of batch.specs) {
    if (!isSafeId(entry.id)) throw new Error(`invalid import id: ${entry.id}`);
    const meta: SpecMeta = {
      id: entry.id,
      title: entry.title.length > 200 ? entry.title.slice(0, 200) : entry.title,
      createdAt: stamp,
      updatedAt: stamp,
    };
    // eslint-disable-next-line no-await-in-loop -- sequential writes keep the file-descriptor count bounded
    await writeSpec(meta, entry.content);
    metas.push(meta);
  }
  return metas;
}

export async function saveSpec(id: string, content: string): Promise<SpecMeta> {
  if (!isSafeId(id)) throw new Error(`invalid spec id: ${id}`);
  return withLock(id, async () => {
    const existing = await readSpec(id);
    const meta: SpecMeta = { ...existing.meta, updatedAt: nowIso() };
    await writeSpec(meta, content);
    return meta;
  });
}

export async function renameSpec(id: string, title: string): Promise<SpecMeta> {
  if (!isSafeId(id)) throw new Error(`invalid spec id: ${id}`);
  return withLock(id, async () => {
    const existing = await readSpec(id);
    const meta: SpecMeta = { ...existing.meta, title, updatedAt: nowIso() };
    await writeSpec(meta, existing.content);
    return meta;
  });
}

export async function deleteSpec(id: string): Promise<void> {
  if (!isSafeId(id)) throw new Error(`invalid spec id: ${id}`);
  await withLock(id, async () => {
    await fs.rm(fileFor(id), { force: true });
    await fs.rm(assetsDirFor(id), { recursive: true, force: true });
  });
}
