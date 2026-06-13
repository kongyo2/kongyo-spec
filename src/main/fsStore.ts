import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

// 仕様書 ID・スナップショット ID に共通の安全性検査。パス区切りや親参照を弾き、
// userData 配下のファイル名として安全な文字だけを許す
export function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(id) && id !== "." && !id.includes("..");
}

// app.getPath は ready 後にしか呼べないため、最初のアクセスで解決して使い回す。
// セグメントの組み合わせごとにキャッシュする
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

// 一時ファイルへ書いてから rename する原子的な書き込み。途中で落ちても
// 既存ファイルが半端な内容へ置き換わらない
export async function atomicWrite(destination: string, contents: string): Promise<void> {
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, contents, "utf8");
  await fs.rename(temporary, destination);
}
