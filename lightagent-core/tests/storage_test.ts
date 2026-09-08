import { assert, assertEquals, assertRejects } from "@std/assert";
import { AgentStorage } from "../src/storage.ts";
import type {
  SqlBindParameters,
  SqliteClient,
  SqlStatement,
} from "../src/storage.ts";
import type { AgentEvent } from "../src/events.ts";

/** An in-memory SqliteClient that simulates the schema created by the
 * migrations (an `events` table and a `_migrations` table), without parsing
 * arbitrary SQL. It recognizes only the statements issued by AgentStorage
 * and applyMigrations. */
class FakeSqliteClient implements SqliteClient {
  tables: Set<string> = new Set();
  migrationRows: { version: number; applied_at: number }[] = [];
  eventRows: {
    id: number;
    session_id: string;
    payload: string;
    created_at: number;
  }[] = [];
  /** All exec calls, for query-shape assertions. */
  execCalls: { sql: string; parameters?: SqlBindParameters }[] = [];
  /** All prepare calls, for query-shape assertions. */
  prepareCalls: string[] = [];
  private nextId = 1;

  exec(sql: string, parameters?: SqlBindParameters): Promise<void> {
    this.execCalls.push({ sql, parameters });

    for (const match of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)) {
      this.tables.add(match[1]);
    }

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

    if (sql.startsWith("insert into events")) {
      let sessionId: string;
      let payload: string;
      let createdAt: number;
      if (Array.isArray(parameters)) {
        [sessionId, payload, createdAt] = parameters as [
          string,
          string,
          number,
        ];
      } else {
        const binds = parameters as unknown as {
          sessionId: string;
          payload: string;
          createdAt: number;
        };
        ({ sessionId, payload, createdAt } = binds);
      }
      this.eventRows.push({
        id: this.nextId++,
        session_id: sessionId,
        payload,
        created_at: createdAt,
      });
    }
    return Promise.resolve();
  }

  prepare<T extends object>(sql: string): Promise<SqlStatement<T>> {
    this.prepareCalls.push(sql);

    if (sql.includes("sqlite_master")) {
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

    if (sql.includes("from events")) {
      const hasTimestampFilter = sql.includes("created_at >");
      return Promise.resolve({
        all: (parameters?: SqlBindParameters) => {
          let sessionId: string;
          let afterTimestamp: number | undefined;
          if (Array.isArray(parameters)) {
            sessionId = parameters[0] as string;
            afterTimestamp = hasTimestampFilter
              ? parameters[1] as number
              : undefined;
          } else {
            const binds = parameters as unknown as {
              sessionId: string;
              timestamp?: number;
            };
            sessionId = binds.sessionId;
            afterTimestamp = hasTimestampFilter ? binds.timestamp : undefined;
          }
          let rows = this.eventRows.filter((r) => r.session_id === sessionId);
          if (typeof afterTimestamp !== "undefined") {
            rows = rows.filter((r) => r.created_at > afterTimestamp);
          }
          rows = [...rows].sort((a, b) =>
            a.id - b.id || a.created_at - b.created_at
          );
          return Promise.resolve(
            rows.map((r) => ({ payload: r.payload }) as T),
          );
        },
        get: () => Promise.resolve(undefined),
      });
    }

    throw new Error(`Unexpected prepare: ${sql}`);
  }
}

function promptEvent(
  sessionId: string,
  prompt: string,
  timestamp: number,
): AgentEvent {
  return {
    type: "user.prompt_submit",
    sessionId,
    turnId: "t1",
    prompt,
    timestamp: new Date(timestamp),
  };
}

Deno.test("AgentStorage.store - persists an event as JSON payload (anonymous binds)", async () => {
  const db = new FakeSqliteClient();
  const storage = new AgentStorage(db, "anonymous");

  await storage.store(promptEvent("s1", "hello", 1000));

  assertEquals(db.eventRows.length, 1);
  const row = db.eventRows[0];
  assertEquals(row.session_id, "s1");
  assertEquals(row.created_at, 1000);
  const payload = JSON.parse(row.payload);
  assertEquals(payload.type, "user.prompt_submit");
  assertEquals(payload.prompt, "hello");
});

Deno.test("AgentStorage.store - uses positional placeholders for anonymous binds", async () => {
  const db = new FakeSqliteClient();
  const storage = new AgentStorage(db, "anonymous");
  await storage.store(promptEvent("s1", "hi", 1000));

  const insert = db.execCalls.find((c) =>
    c.sql.startsWith("insert into events")
  );
  assert(insert);
  assert(insert.sql.includes("?"));
  assert(!insert.sql.includes(":sessionId"));
  assert(Array.isArray(insert.parameters));
});

Deno.test("AgentStorage.store - uses named placeholders for named binds", async () => {
  const db = new FakeSqliteClient();
  const storage = new AgentStorage(db, "named");
  await storage.store(promptEvent("s1", "hi", 1000));

  const insert = db.execCalls.find((c) =>
    c.sql.startsWith("insert into events")
  );
  assert(insert);
  assert(insert.sql.includes(":sessionId"));
  assert(insert.sql.includes(":payload"));
  assert(insert.sql.includes(":createdAt"));
  assert(!Array.isArray(insert.parameters));
});

Deno.test("AgentStorage.store - runs migrations exactly once across multiple stores", async () => {
  const db = new FakeSqliteClient();
  const storage = new AgentStorage(db, "anonymous");

  await storage.store(promptEvent("s1", "one", 1000));
  const migrationInserts = () =>
    db.execCalls.filter((c) => c.sql.startsWith("insert into _migrations"))
      .length;
  assertEquals(migrationInserts(), 1);

  await storage.store(promptEvent("s1", "two", 2000));
  await storage.store(promptEvent("s1", "three", 3000));
  // Still only the initial migration bookkeeping row.
  assertEquals(migrationInserts(), 1);
  assertEquals(db.eventRows.length, 3);
});

Deno.test("AgentStorage.getSessionEvents - round-trips stored events", async () => {
  const db = new FakeSqliteClient();
  const storage = new AgentStorage(db, "anonymous");

  const events = [
    promptEvent("s1", "first", 1000),
    promptEvent("s1", "second", 2000),
    promptEvent("s2", "other session", 1500),
  ];
  for (const e of events) {
    await storage.store(e);
  }

  const s1Events = await storage.getSessionEvents("s1");
  assertEquals(s1Events.length, 2);
  assertEquals(s1Events[0].type, "user.prompt_submit");
  assertEquals(
    (s1Events[0] as { prompt: string }).prompt,
    "first",
  );
  assertEquals(
    (s1Events[1] as { prompt: string }).prompt,
    "second",
  );
  // Timestamps are revived as Date instances.
  assert(s1Events[0].timestamp instanceof Date);
  assertEquals(Number(s1Events[0].timestamp), 1000);
});

Deno.test("AgentStorage.getSessionEvents - returns an empty list for unknown sessions", async () => {
  const db = new FakeSqliteClient();
  const storage = new AgentStorage(db, "anonymous");
  await storage.store(promptEvent("s1", "hi", 1000));

  assertEquals(await storage.getSessionEvents("nope"), []);
});

Deno.test("AgentStorage.getSessionEvents - filters by afterTimestamp", async () => {
  const db = new FakeSqliteClient();
  const storage = new AgentStorage(db, "anonymous");

  await storage.store(promptEvent("s1", "old", 1000));
  await storage.store(promptEvent("s1", "new", 2000));

  const events = await storage.getSessionEvents("s1", 1500);
  assertEquals(events.length, 1);
  assertEquals((events[0] as { prompt: string }).prompt, "new");
});

Deno.test("AgentStorage.getSessionEvents - afterTimestamp is exclusive", async () => {
  const db = new FakeSqliteClient();
  const storage = new AgentStorage(db, "anonymous");

  await storage.store(promptEvent("s1", "exact", 1000));

  assertEquals(await storage.getSessionEvents("s1", 1000), []);
  assertEquals((await storage.getSessionEvents("s1", 999)).length, 1);
});

Deno.test("AgentStorage.getSessionEvents - issues named-bind queries when bindType is named", async () => {
  const db = new FakeSqliteClient();
  const storage = new AgentStorage(db, "named");

  await storage.store(promptEvent("s1", "hi", 1000));
  await storage.getSessionEvents("s1", 500);

  const eventsQuery = db.prepareCalls.find((q) => q.includes("from events"));
  assert(eventsQuery);
  assert(eventsQuery.includes(":sessionId"));
  assert(eventsQuery.includes(":timestamp"));
});

Deno.test("AgentStorage.getSessionEvents - rejects payloads that fail schema validation", async () => {
  const db = new FakeSqliteClient();
  const storage = new AgentStorage(db, "anonymous");
  await storage.store(promptEvent("s1", "hi", 1000));

  // Corrupt the stored payload.
  db.eventRows[0].payload = JSON.stringify({ type: "bogus.event" });

  await assertRejects(() => storage.getSessionEvents("s1"));
});

Deno.test("AgentStorage - full round-trip with named binds", async () => {
  const db = new FakeSqliteClient();
  const storage = new AgentStorage(db, "named");

  const original: AgentEvent = {
    type: "tool.result",
    sessionId: "s1",
    turnId: "t1",
    toolCallId: "c1",
    result: { type: "success", result: "ok" },
    timestamp: new Date(1735689600000),
  };
  await storage.store(original);

  const events = await storage.getSessionEvents("s1");
  assertEquals(events.length, 1);
  assertEquals(events[0], original);
});
