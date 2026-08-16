import { Database } from "@db/sqlite";

async function getMigrations(): Promise<{ version: number; sql: string }[]> {
  const migrations: { version: number; sql: string }[] = [];
  const migrationsDir = new URL("./migrations/", import.meta.url);
  for await (const entry of Deno.readDir(migrationsDir)) {
    if (entry.name.endsWith(".sql")) {
      const sql = await Deno.readTextFile(new URL(entry.name, migrationsDir));
      const version = parseInt(entry.name.split("_")[0]!);
      migrations.push({ sql, version });
    }
  }
  migrations.sort((m, n) => m.version - n.version);
  return migrations;
}

function getCurrentMigration(db: Database): number {
  const stmt = db.prepare(
    "select name from sqlite_master where type='table' and name='_migrations'",
  );
  const exists = stmt.get();
  if (typeof exists === "undefined") {
    return 0;
  }
  const versionStmt = db.prepare(
    "select version, applied_at from _migrations order by applied_at desc, version desc",
  );
  const version = versionStmt.get<{ version: number; applied_at: number }>();
  if (typeof version === "undefined") {
    return 0;
  }
  return version.version;
}

export async function applyMigrations(db: Database): Promise<void> {
  const migrations = await getMigrations();
  const currentVersion = getCurrentMigration(db);
  const toApply = migrations.filter((m) => m.version > currentVersion);
  for (const m of toApply) {
    db.exec(m.sql);
    const timestamp = new Date();
    db.exec(
      "insert into _migrations (version, applied_at) values (:version, :timestamp)",
      { version: m.version, timestamp: Number(timestamp) },
    );
  }
}
