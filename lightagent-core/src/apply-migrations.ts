import type { SqliteClient } from "./storage.ts";
import { migrations } from "./migrations/mod.ts";

export type BindType = "anonymous" | "named";

async function getCurrentMigration(db: SqliteClient): Promise<number> {
  const stmt = await db.prepare(
    "select name from sqlite_master where type='table' and name='_migrations'",
  );
  const exists = await stmt.get();
  if (typeof exists === "undefined") {
    return 0;
  }
  const versionStmt = await db.prepare<{ version: number; applied_at: number }>(
    "select version, applied_at from _migrations order by applied_at desc, version desc",
  );
  const version = await versionStmt.get();
  if (typeof version === "undefined") {
    return 0;
  }
  return version.version;
}

export async function applyMigrations(
  db: SqliteClient,
  bindType: BindType,
): Promise<void> {
  const currentVersion = await getCurrentMigration(db);
  const toApply = migrations.filter((m) => m.version > currentVersion);
  for (const m of toApply) {
    await db.exec(m.sql);
    const timestamp = new Date();
    let query =
      "insert into _migrations (version, applied_at) values (:version, :timestamp)";
    let binds: { version: number; timestamp: number } | [number, number] = {
      version: m.version,
      timestamp: Number(timestamp),
    };
    if (bindType === "anonymous") {
      query = "insert into _migrations (version, applied_at) values (?, ?)";
      binds = [m.version, Number(timestamp)];
    }
    await db.exec(query, binds);
  }
}
