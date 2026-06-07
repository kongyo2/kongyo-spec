import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { parseFrontmatter, type SpecDocument, type SpecMeta } from "@shared/schemas/spec";
import { parseFile, stringifyFile } from "./frontmatter";
import mdxgSeed from "./seeds/mdxg-notes.md?raw";
import welcomeSeed from "./seeds/welcome.md?raw";

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

async function writeSpec(meta: SpecMeta, content: string): Promise<void> {
  const serialized = stringifyFile(
    { id: meta.id, title: meta.title, createdAt: meta.createdAt, updatedAt: meta.updatedAt },
    content,
  );
  await fs.writeFile(fileFor(meta.id), serialized, "utf8");
}

async function seedIfEmpty(): Promise<void> {
  const entries = await fs.readdir(getSpecsDir());
  if (entries.some((entry) => entry.endsWith(".md"))) return;
  const stamp = nowIso();
  await writeSpec({ id: "welcome", title: "Kongyo Spec へようこそ", createdAt: stamp, updatedAt: stamp }, welcomeSeed);
  await writeSpec({ id: "mdxg-notes", title: "MDXG 準拠ノート", createdAt: stamp, updatedAt: stamp }, mdxgSeed);
}

export async function initStore(): Promise<void> {
  await ensureDir();
  await seedIfEmpty();
}

export async function listSpecs(): Promise<SpecMeta[]> {
  await ensureDir();
  const entries = await fs.readdir(getSpecsDir());
  const metas: SpecMeta[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    try {
      const raw = await fs.readFile(join(getSpecsDir(), entry), "utf8");
      metas.push(parseFrontmatter(parseFile(raw).data));
    } catch (err) {
      console.warn(`[specsStore] skipping ${entry}:`, err);
    }
  }
  metas.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return metas;
}

export async function readSpec(id: string): Promise<SpecDocument> {
  if (!isSafeId(id)) throw new Error(`invalid spec id: ${id}`);
  const raw = await fs.readFile(fileFor(id), "utf8");
  const parsed = parseFile(raw);
  return { meta: parseFrontmatter(parsed.data), content: parsed.content };
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
  const existing = await readSpec(id);
  const meta: SpecMeta = { ...existing.meta, updatedAt: nowIso() };
  await writeSpec(meta, content);
  return meta;
}

export async function renameSpec(id: string, title: string): Promise<SpecMeta> {
  if (!isSafeId(id)) throw new Error(`invalid spec id: ${id}`);
  const existing = await readSpec(id);
  const meta: SpecMeta = { ...existing.meta, title, updatedAt: nowIso() };
  await writeSpec(meta, existing.content);
  return meta;
}

export async function deleteSpec(id: string): Promise<void> {
  if (!isSafeId(id)) throw new Error(`invalid spec id: ${id}`);
  await fs.rm(fileFor(id), { force: true });
}
