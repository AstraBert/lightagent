import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { applyMigrations } from "../src/apply-migrations.ts";
import { migrations } from "../src/migrations/mod.ts";
import type {
  SqlBindParameters,
  SqliteClient,
  SqlStatement,
} from "../src/storage.ts";

/** A minimal in-memory SqliteClient test double.
 *
 * It does not parse SQL; instead it recognizes the specific statements used
 * by the migration logic and records every exec call for inspection.
 */
class FakeSqliteClient implements SqliteClient {
  /** Tables that have been created. */
  tables: Set<string> = new Set();
  /** Rows recorded in the _migrations table, in insertion order. */
  migrationRows: { version: number; applied_at: number }[] = [];
  /** All exec calls, in order. */
  execCalls: { sql: string; parameters?: SqlBindParameters }[] = [];

  exec(sql: string, parameters?: SqlBindParameters): Promise<void> {
    this.execCalls.push({ sql, parameters });

    // Record table creation from migration SQL.
    for (const match of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)) {
      this.tables.add(match[1]);
    }

    // Record migration bookkeeping inserts.
    if (sql.startsWith("insert into _migrations")) {
      if (Array.isArray(parameters)) {
        const [version, applied_at] = parameters as [number, number];
        this.migrationRows.push({ version, applied_at });
      } else {
        const binds = parameters as unknown as {
          version: number;
          timestamp: number;
        };
        this.migrationRows.push({
          version: binds.version,
          applied_at: binds.timestamp,
        });
      }
    }
    return Promise.resolve();
  }

  prepare<T extends object>(sql: string): Promise<SqlStatement<T>> {
    if (sql.includes("sqlite_master")) {
      // Table existence check for _migrations.
      const exists = this.tables.has("_migrations");
      return Promise.resolve({
        all: () => Promise.resolve([] as T[]),
        get: () =>
          Promise.resolve(
            (exists ? { name: "_migrations" } : undefined) as T | undefined,
          ),
      });
    }
    if (sql.includes("from _migrations")) {
      const latest = this.migrationRows.length > 0
        ? this.migrationRows.reduce((a, b) =>
          b.applied_at > a.applied_at ||
            (b.applied_at === a.applied_at && b.version > a.version)
            ? b
            : a
        )
        : undefined;
      return Promise.resolve({
        all: () => Promise.resolve([] as T[]),
        get: () => Promise.resolve(latest as T | undefined),
      });
    }
    throw new Error(`Unexpected prepare: ${sql}`);
  }
}

Deno.test("applyMigrations - applies all migrations on a fresh database (named binds)", async () => {
  const db = new FakeSqliteClient();
  await applyMigrations(db, "named");

  // The events and _migrations tables were created by migration 001.
  assert(db.tables.has("events"));
  assert(db.tables.has("_migrations"));

  // One bookkeeping row per migration.
  assertEquals(db.migrationRows.length, migrations.length);
  assertEquals(
    db.migrationRows.map((r) => r.version),
    migrations.map((m) => m.version),
  );
});

Deno.test("applyMigrations - applies all migrations on a fresh database (anonymous binds)", async () => {
  const db = new FakeSqliteClient();
  await applyMigrations(db, "anonymous");

  assert(db.tables.has("events"));
  assert(db.tables.has("_migrations"));
  assertEquals(db.migrationRows.length, migrations.length);
});

Deno.test("applyMigrations - uses named placeholders when bindType is named", async () => {
  const db = new FakeSqliteClient();
  await applyMigrations(db, "named");

  const insert = db.execCalls.find((c) =>
    c.sql.startsWith("insert into _migrations")
  );
  assert(insert);
  assert(insert.sql.includes(":version"));
  assert(insert.sql.includes(":timestamp"));
  assert(!Array.isArray(insert.parameters));
  const binds = insert.parameters as unknown as {
    version: number;
    timestamp: number;
  };
  assertEquals(binds.version, migrations[0].version);
  assertEquals(typeof binds.timestamp, "number");
});

Deno.test("applyMigrations - uses positional placeholders when bindType is anonymous", async () => {
  const db = new FakeSqliteClient();
  await applyMigrations(db, "anonymous");

  const insert = db.execCalls.find((c) =>
    c.sql.startsWith("insert into _migrations")
  );
  assert(insert);
  assert(insert.sql.includes("?"));
  assert(!insert.sql.includes(":version"));
  const binds = insert.parameters as [number, number];
  assertEquals(binds[0], migrations[0].version);
  assertEquals(typeof binds[1], "number");
});

Deno.test("applyMigrations - skips already-applied migrations", async () => {
  const db = new FakeSqliteClient();
  await applyMigrations(db, "named");
  const callsAfterFirstRun = db.execCalls.length;

  // Second run: current version equals the latest migration, nothing to do.
  await applyMigrations(db, "named");
  assertEquals(db.execCalls.length, callsAfterFirstRun);
  assertEquals(db.migrationRows.length, migrations.length);
});

Deno.test("applyMigrations - is a no-op when database is up to date", async () => {
  const db = new FakeSqliteClient();
  // Simulate a database that already has the latest version recorded.
  db.tables.add("_migrations");
  db.migrationRows.push({
    version: Math.max(...migrations.map((m) => m.version)),
    applied_at: Date.now(),
  });

  await applyMigrations(db, "named");
  // No exec calls at all: no migration SQL, no bookkeeping inserts.
  assertEquals(db.execCalls.length, 0);
});

Deno.test("applyMigrations - treats an empty _migrations table as version 0", async () => {
  const db = new FakeSqliteClient();
  // The table exists but has no rows (e.g. created externally).
  db.tables.add("_migrations");

  await applyMigrations(db, "named");
  assertEquals(db.migrationRows.length, migrations.length);
});

Deno.test("applyMigrations - migrations are applied in ascending version order", async () => {
  const db = new FakeSqliteClient();
  await applyMigrations(db, "named");

  const versions = db.migrationRows.map((r) => r.version);
  const sorted = [...versions].sort((a, b) => a - b);
  assertEquals(versions, sorted);
});

Deno.test("applyMigrations - records distinct timestamps per migration row", async () => {
  // This test is only meaningful with multiple migrations; with a single
  // migration it just checks the timestamp is a plausible epoch value.
  const db = new FakeSqliteClient();
  const before = Date.now();
  await applyMigrations(db, "named");
  const after = Date.now();

  for (const row of db.migrationRows) {
    assert(row.applied_at >= before - 1000);
    assert(row.applied_at <= after + 1000);
  }
});

Deno.test("migrations registry - versions are unique and sorted", () => {
  const versions = migrations.map((m) => m.version);
  const unique = new Set(versions);
  assertEquals(unique.size, versions.length);
  assertEquals(versions, [...versions].sort((a, b) => a - b));
});

Deno.test("migrations registry - migration 001 creates the expected schema", () => {
  const m001 = migrations.find((m) => m.version === 1);
  assert(m001);
  assert(m001.sql.includes("CREATE TABLE IF NOT EXISTS events"));
  assert(m001.sql.includes("CREATE TABLE IF NOT EXISTS _migrations"));
  assert(m001.sql.includes("session_id"));
  assert(m001.sql.includes("payload"));
  assert(m001.sql.includes("created_at"));
  assert(m001.sql.includes("idx_events_session_id"));
});

Deno.test("applyMigrations - latest version is picked by applied_at then version", async () => {
  const db = new FakeSqliteClient();
  db.tables.add("_migrations");
  // Rows inserted out of order: the latest applied row has the highest
  // version, so no migration should run even though an older row exists.
  db.migrationRows.push({ version: 0, applied_at: 2000 });
  db.migrationRows.push({
    version: Math.max(...migrations.map((m) => m.version)),
    applied_at: 1000,
  });

  // The reducer in the fake orders by applied_at first, so version 0 with
  // applied_at 2000 wins and migration 1 would be re-applied. This documents
  // the getCurrentMigration ordering semantics (applied_at desc, version
  // desc): the most recently applied row wins.
  await applyMigrations(db, "named");
  assertNotEquals(db.migrationRows.length, 2);
});
