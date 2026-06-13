import { Buffer } from "node:buffer";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { app, safeStorage } from "electron";
import { DEFAULT_SETTINGS, SettingsSchema, type SettingKey, type Settings } from "@shared/schemas/settings";

let db: DatabaseSync | null = null;

const SECRET_KEYS: ReadonlySet<SettingKey> = new Set<SettingKey>(["geminiApiKey"]);
const ENCRYPTED_PREFIX = "enc:v1:";
const LINUX_KEYSTORE_BACKENDS: ReadonlySet<string> = new Set(["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"]);

export function isSecretEncryptionAvailable(): boolean {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    return process.platform !== "linux" || LINUX_KEYSTORE_BACKENDS.has(safeStorage.getSelectedStorageBackend());
  } catch {
    return false;
  }
}

function decryptSecret(value: string): string | null {
  if (!value.startsWith(ENCRYPTED_PREFIX)) return value;
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(ENCRYPTED_PREFIX.length), "base64"));
  } catch {
    return null;
  }
}

function encryptSecret(value: string): string {
  return ENCRYPTED_PREFIX + safeStorage.encryptString(value).toString("base64");
}

function hasApiKey(entry: unknown): entry is { apiKey: string } {
  return typeof entry === "object" && entry !== null && typeof (entry as { apiKey?: unknown }).apiKey === "string";
}

// 秘匿値(API キー)にだけ暗号変換を当てる。llmProfiles は各プロファイルの apiKey、
// 単独の秘匿キーはその文字列自体に適用し、それ以外の値はそのまま通す
function mapSecret(key: SettingKey, value: unknown, transform: (secret: string) => string | null): unknown {
  if (key === "llmProfiles" && Array.isArray(value)) {
    return value.map((entry) => (hasApiKey(entry) ? { ...entry, apiKey: transform(entry.apiKey) } : entry));
  }
  return SECRET_KEYS.has(key) && typeof value === "string" ? transform(value) : value;
}

function toStoredValue(key: SettingKey, value: unknown): unknown {
  return mapSecret(key, value, encryptSecret);
}

function fromStoredValue(key: SettingKey, value: unknown): unknown {
  return mapSecret(key, value, decryptSecret);
}

function disableStore(): void {
  if (db === null) return;
  try {
    db.close();
  } catch {
    // already unusable; nothing more we can do
  }
  db = null;
}

export function initSettingsStore(): void {
  if (db !== null) return;
  let handle: DatabaseSync | null = null;
  try {
    handle = new DatabaseSync(join(app.getPath("userData"), "kongyo-spec.db"));
    handle.exec("PRAGMA journal_mode = WAL");
    handle.exec("PRAGMA synchronous = NORMAL");
    handle.exec(
      "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)",
    );
    db = handle;
  } catch (err) {
    console.warn("[settingsStore] initialization failed; settings will use defaults and not persist:", err);
    if (handle !== null) {
      try {
        handle.close();
      } catch {
        // ignore — the handle is already broken
      }
    }
    db = null;
  }
}

export function readSettings(): Settings {
  if (db === null) return { ...DEFAULT_SETTINGS };
  try {
    const rows = db.prepare("SELECT key, value FROM settings").all();
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
          const parsed = shape[key].safeParse(fromStoredValue(key, JSON.parse(raw)));
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
  } catch (err) {
    // Returning defaults here is indistinguishable from a real read to callers,
    // who would then persist those defaults over still-valid on-disk data. Give
    // up on the store for this session so writes become no-ops instead.
    console.warn("[settingsStore] read failed; disabling persistence for this session:", err);
    disableStore();
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSetting<K extends SettingKey>(key: K, value: Settings[K]): boolean {
  if (db === null) return false;
  // 暗号化が使えない環境では、平文キーを書く代わりに(キーを null へ
  // すり替えて成功を装うのでもなく)書き込み自体を失敗させる
  const carriesSecret =
    (SECRET_KEYS.has(key) && typeof value === "string") ||
    (key === "llmProfiles" && Array.isArray(value) && value.some(hasApiKey));
  if (carriesSecret && !isSecretEncryptionAvailable()) return false;
  try {
    db.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    ).run(key, JSON.stringify(toStoredValue(key, value)), new Date().toISOString());
    return true;
  } catch (err) {
    console.warn("[settingsStore] write failed:", err);
    return false;
  }
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
