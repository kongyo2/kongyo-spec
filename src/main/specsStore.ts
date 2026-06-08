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

export interface ImportResult {
  metas: SpecMeta[];
  skippedAssets: number;
}

const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES = 128 * 1024 * 1024;

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
  return /^[A-Za-z0-9._-]+$/.test(id) && id !== "." && !id.includes("..");
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

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

const IMAGE_SNIFF_BYTES = 256;

function looksLikeImage(buf: Buffer): boolean {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true; // PNG
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true; // JPEG
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return true; // BMP
  if (buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return true; // ICO
  const ascii = buf.toString("latin1");
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) return true; // GIF
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return true; // WebP
  if (buf.length >= 12 && ascii.slice(4, 8) === "ftyp") return true; // AVIF / HEIF
  const text = buf.toString("utf8").replace(/^﻿/, "").trimStart().toLowerCase();
  const xmlish =
    text.startsWith("<?xml") || text.startsWith("<svg") || text.startsWith("<!--") || text.startsWith("<!doctype");
  return xmlish && text.includes("<svg"); // SVG, possibly after an XML prolog or comment
}

function destWithinImportAssets(dest: string, allowedIds: Set<string>): boolean {
  const segments = dest.split(/[\\/]/);
  if (segments.length < 3 || segments[0] !== "assets" || !allowedIds.has(segments[1] ?? "")) return false;
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

type CopyOutcome = "copied" | "skipped-size" | "skipped-missing";

async function copyImportedAsset(
  specsDir: string,
  op: ImportAssetOp,
  budget: { remaining: number },
): Promise<CopyOutcome> {
  const destination = join(specsDir, op.dest);
  if (destination !== specsDir && !destination.startsWith(specsDir + sep)) return "skipped-missing";
  let source: string;
  try {
    source = decodeURIComponent(op.url);
  } catch {
    source = op.url;
  }
  const absolute = resolve(dirname(op.srcFile), source);
  try {
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) return "skipped-missing";
    if (stat.size > MAX_ASSET_BYTES || stat.size > budget.remaining) return "skipped-size";
    const handle = await fs.open(absolute, "r");
    try {
      const head = Buffer.alloc(Math.min(IMAGE_SNIFF_BYTES, stat.size));
      if (head.length > 0) await handle.read(head, 0, head.length, 0);
      if (!looksLikeImage(head)) return "skipped-missing";
    } finally {
      await handle.close();
    }
    await fs.mkdir(dirname(destination), { recursive: true });
    await fs.copyFile(absolute, destination);
    budget.remaining -= stat.size;
    return "copied";
  } catch (err) {
    console.warn(`[specsStore] skipping asset ${op.url}:`, err);
    return "skipped-missing";
  }
}

export async function importSpecs(batch: ImportBatch): Promise<ImportResult> {
  await ensureDir();
  const specsDir = getSpecsDir();
  const stamp = nowIso();

  const accepted: { content: string; meta: SpecMeta }[] = [];
  const acceptedIds = new Set<string>();
  for (const entry of batch.specs) {
    if (!isSafeId(entry.id) || acceptedIds.has(entry.id)) {
      console.warn(`[specsStore] skipping import with invalid or duplicate id: ${entry.id}`);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- sequential existence checks avoid clobbering existing specs
    if (await pathExists(fileFor(entry.id))) {
      console.warn(`[specsStore] refusing to overwrite existing spec: ${entry.id}`);
      continue;
    }
    acceptedIds.add(entry.id);
    accepted.push({
      content: entry.content,
      meta: {
        id: entry.id,
        title: entry.title.length > 200 ? entry.title.slice(0, 200) : entry.title,
        createdAt: stamp,
        updatedAt: stamp,
      },
    });
  }

  const budget = { remaining: MAX_TOTAL_ASSET_BYTES };
  let skippedAssets = 0;
  for (const op of batch.assets) {
    if (!destWithinImportAssets(op.dest, acceptedIds)) {
      skippedAssets += 1;
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- sequential copies keep the file-descriptor count bounded
    const outcome = await copyImportedAsset(specsDir, op, budget);
    if (outcome !== "copied") skippedAssets += 1;
  }

  const metas: SpecMeta[] = [];
  for (const { content, meta } of accepted) {
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential writes keep the file-descriptor count bounded
      await writeSpec(meta, content);
      metas.push(meta);
    } catch (err) {
      console.warn(`[specsStore] failed to import ${meta.id}:`, err);
      // eslint-disable-next-line no-await-in-loop -- drop the orphaned assets for a spec that failed to write
      await fs.rm(assetsDirFor(meta.id), { recursive: true, force: true }).catch(() => undefined);
    }
  }
  return { metas, skippedAssets };
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
