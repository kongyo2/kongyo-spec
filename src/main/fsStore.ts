import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

export function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(id) && id !== "." && !id.includes("..");
}

const cachedPaths = new Map<string, string>();

export function userDataPath(...segments: string[]): string {
  const key = JSON.stringify(segments);
  let path = cachedPaths.get(key);
  if (path === undefined) {
    path = join(app.getPath("userData"), ...segments);
    cachedPaths.set(key, path);
  }
  return path;
}

export async function atomicWrite(destination: string, contents: string): Promise<void> {
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, contents, "utf8");
  await fs.rename(temporary, destination);
}
