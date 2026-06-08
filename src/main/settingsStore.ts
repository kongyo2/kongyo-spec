import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { app } from "electron";
import { DEFAULT_SETTINGS, SettingsSchema, type SettingKey, type Settings } from "@shared/schemas/settings";

let db: DatabaseSync | null = null;

function database(): DatabaseSync {
  if (db === null) throw new Error("settings store not initialized");
  return db;
}

export function initSettingsStore(): void {
  if (db !== null) return;
  const handle = new DatabaseSync(join(app.getPath("userData"), "kongyo-spec.db"));
  handle.exec("PRAGMA journal_mode = WAL");
  handle.exec("PRAGMA synchronous = NORMAL");
  handle.exec(
    "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)",
  );
  db = handle;
}

export function readSettings(): Settings {
  const rows = database().prepare("SELECT key, value FROM settings").all();
  const stored = new Map<string, string>();
  for (const row of rows) {
    const key = row["key"];
    const value = row["value"];
    if (typeof key === "string" && typeof value === "string") stored.set(key, value);
  }

  const shape = SettingsSchema.shape;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(shape) as SettingKey[]) {
    const raw = stored.get(key);
    if (raw !== undefined) {
      try {
        const parsed = shape[key].safeParse(JSON.parse(raw));
        if (parsed.success) {
          result[key] = parsed.data;
          continue;
        }
      } catch {
        // corrupt JSON falls through to the default
      }
    }
    result[key] = DEFAULT_SETTINGS[key];
  }
  return result as Settings;
}

export function writeSetting<K extends SettingKey>(key: K, value: Settings[K]): void {
  database()
    .prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .run(key, JSON.stringify(value), new Date().toISOString());
}

export function closeSettingsStore(): void {
  if (db === null) return;
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch {
    // best-effort checkpoint; closing still flushes the WAL
  }
  db.close();
  db = null;
}
