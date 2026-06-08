import { randomUUID } from "node:crypto";
import { type Dirent, promises as fs } from "node:fs";
import { basename, join } from "node:path";
import { app } from "electron";
import { byUpdatedDesc, parseFrontmatter, type SpecDocument, type SpecMeta } from "@shared/schemas/spec";
import { parseFile, stringifyFile } from "./frontmatter";

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
  });
}

const MARKDOWN_RE = /\.(?:md|markdown|mdx)$/i;
const SKIP_DIRS = new Set(["node_modules", ".git"]);
const MAX_IMPORT_FILES = 500;
const MAX_IMPORT_DEPTH = 8;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

function byName(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function firstHeadingTitle(content: string): string | null {
  let open: { char: string; len: number } | null = null;
  for (const line of content.split(/\r?\n/)) {
    if (open) {
      const marker = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1];
      if (marker && marker[0] === open.char && marker.length >= open.len) open = null;
      continue;
    }
    const fence = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      const char = fence[0];
      if (char) open = { char, len: fence.length };
      continue;
    }
    const heading = /^[ \t]{0,3}#[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
    if (isNonEmptyString(heading?.[1])) return heading[1].trim();
  }
  return null;
}

function resolveImportTitle(data: Record<string, unknown>, content: string, filePath: string): string {
  if (isNonEmptyString(data["title"])) return data["title"].trim();
  const heading = firstHeadingTitle(content);
  if (heading) return heading;
  const name = basename(filePath).replace(MARKDOWN_RE, "");
  return name.length > 0 ? name : "Untitled";
}

function resolveImportCreatedAt(data: Record<string, unknown>, fallback: string): string {
  const value = data["createdAt"];
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

async function readDirSafe(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`[specsStore] skipping ${dir}:`, err);
    return [];
  }
}

async function collectMarkdownFiles(dir: string, depth: number, seen: Set<string>, out: string[]): Promise<void> {
  if (out.length >= MAX_IMPORT_FILES) return;
  const entries = await readDirSafe(dir);
  entries.sort(byName);
  for (const entry of entries) {
    if (out.length >= MAX_IMPORT_FILES) break;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < MAX_IMPORT_DEPTH && !SKIP_DIRS.has(entry.name)) {
        // eslint-disable-next-line no-await-in-loop -- sequential traversal avoids exhausting the file-descriptor limit
        await collectMarkdownFiles(full, depth + 1, seen, out);
      }
    } else if (entry.isFile() && MARKDOWN_RE.test(entry.name) && !seen.has(full)) {
      seen.add(full);
      out.push(full);
    }
  }
}

export async function importSpecs(paths: string[]): Promise<SpecMeta[]> {
  await ensureDir();
  const seen = new Set<string>();
  const files: string[] = [];
  for (const path of paths) {
    if (files.length >= MAX_IMPORT_FILES) break;
    let stats;
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential stats avoid exhausting the file-descriptor limit
      stats = await fs.stat(path);
    } catch (err) {
      console.warn(`[specsStore] cannot import ${path}:`, err);
      continue;
    }
    if (stats.isDirectory()) {
      // eslint-disable-next-line no-await-in-loop -- sequential traversal avoids exhausting the file-descriptor limit
      await collectMarkdownFiles(path, 0, seen, files);
    } else if (stats.isFile() && MARKDOWN_RE.test(path) && !seen.has(path)) {
      seen.add(path);
      files.push(path);
    }
  }

  const created: SpecMeta[] = [];
  for (const file of files) {
    let raw: string;
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential stats avoid exhausting the file-descriptor limit
      const stats = await fs.stat(file);
      if (stats.size > MAX_IMPORT_BYTES) {
        console.warn(`[specsStore] skipping ${file}: exceeds ${MAX_IMPORT_BYTES} byte import limit`);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop -- sequential reads avoid exhausting the file-descriptor limit
      raw = await fs.readFile(file, "utf8");
    } catch (err) {
      console.warn(`[specsStore] failed to read ${file}:`, err);
      continue;
    }
    const parsed = parseFile(raw);
    const stamp = nowIso();
    const meta: SpecMeta = {
      id: randomUUID(),
      title: resolveImportTitle(parsed.data, parsed.content, file),
      createdAt: resolveImportCreatedAt(parsed.data, stamp),
      updatedAt: stamp,
    };
    try {
      // eslint-disable-next-line no-await-in-loop -- specs are written one at a time to bound open descriptors
      await writeSpec(meta, parsed.content);
    } catch (err) {
      console.warn(`[specsStore] failed to import ${file}:`, err);
      continue;
    }
    created.push(meta);
  }
  created.sort(byUpdatedDesc);
  return created;
}
