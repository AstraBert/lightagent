import { assert, assertEquals, assertRejects } from "@std/assert";
import * as path from "@std/path";
import {
  type AgentEvent,
  AgentStorage,
} from "@cle-does-things/lightagent-core";
import {
  getDbPath,
  LIGHTAGENT_DB_PATH,
  LocalSqliteClient,
} from "../src/storage.ts";
import { LocalFileSystem } from "../src/fs.ts";

async function withTempDir(
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "lightagent_storage_test_" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
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

Deno.test("LocalSqliteClient - exec creates the database file and parent directories", async () => {
  await withTempDir(async (dir) => {
    const dbPath = path.join(dir, "nested", "deeply", "test.sqlite");
    const client = new LocalSqliteClient(dbPath);
    await client.exec("create table t (id integer)");
    const stat = await Deno.stat(dbPath);
    assert(stat.isFile);
  });
});

Deno.test("LocalSqliteClient - exec and prepare round-trip", async () => {
  await withTempDir(async (dir) => {
    const client = new LocalSqliteClient(path.join(dir, "test.sqlite"));
    await client.exec("create table items (id integer primary key, name text)");
    await client.exec("insert into items (name) values (?)", ["alpha"]);
    await client.exec("insert into items (name) values (?)", ["beta"]);

    const stmt = await client.prepare<{ id: number; name: string }>(
      "select id, name from items order by id",
    );
    const rows = await stmt.all();
    assertEquals(rows, [
      { id: 1, name: "alpha" },
      { id: 2, name: "beta" },
    ]);
  });
});

Deno.test("LocalSqliteClient - prepare.get returns the first row or undefined", async () => {
  await withTempDir(async (dir) => {
    const client = new LocalSqliteClient(path.join(dir, "test.sqlite"));
    await client.exec("create table items (id integer primary key, name text)");
    await client.exec("insert into items (name) values (?)", ["alpha"]);

    const stmt = await client.prepare<{ id: number; name: string }>(
      "select id, name from items where name = ?",
    );
    assertEquals(await stmt.get(["alpha"]), { id: 1, name: "alpha" });
    assertEquals(await stmt.get(["missing"]), undefined);
  });
});

Deno.test("LocalSqliteClient - supports named bind parameters", async () => {
  await withTempDir(async (dir) => {
    const client = new LocalSqliteClient(path.join(dir, "test.sqlite"));
    await client.exec("create table items (id integer primary key, name text)");
    await client.exec("insert into items (name) values (:name)", {
      name: "named",
    } as unknown as string[]);

    const stmt = await client.prepare<{ id: number; name: string }>(
      "select id, name from items where name = :name",
    );
    const row = await stmt.get({ name: "named" } as unknown as string[]);
    assertEquals(row, { id: 1, name: "named" });
  });
});

Deno.test("LocalSqliteClient - exec without parameters works", async () => {
  await withTempDir(async (dir) => {
    const client = new LocalSqliteClient(path.join(dir, "test.sqlite"));
    await client.exec("create table t (id integer)");
    await client.exec("insert into t (id) values (42)");
    const stmt = await client.prepare<{ id: number }>("select id from t");
    assertEquals(await stmt.get(), { id: 42 });
  });
});

Deno.test("LocalSqliteClient - initDb is idempotent", async () => {
  await withTempDir(async (dir) => {
    const client = new LocalSqliteClient(path.join(dir, "test.sqlite"));
    const fs = new LocalFileSystem();
    await client.initDb(fs);
    await client.initDb(fs); // second call must not throw or reopen
    await client.exec("create table t (id integer)");
  });
});

Deno.test("LocalSqliteClient - integrates with AgentStorage using anonymous binds", async () => {
  await withTempDir(async (dir) => {
    const client = new LocalSqliteClient(path.join(dir, "sessions.sqlite"));
    const storage = new AgentStorage(client, "anonymous");

    await storage.store(promptEvent("s1", "hello", 1000));
    await storage.store(promptEvent("s1", "world", 2000));
    await storage.store(promptEvent("s2", "other", 1500));

    const events = await storage.getSessionEvents("s1");
    assertEquals(events.length, 2);
    assertEquals((events[0] as { prompt: string }).prompt, "hello");
    assertEquals((events[1] as { prompt: string }).prompt, "world");
    assert(events[0].timestamp instanceof Date);

    const recent = await storage.getSessionEvents("s1", 1500);
    assertEquals(recent.length, 1);
    assertEquals((recent[0] as { prompt: string }).prompt, "world");
  });
});

Deno.test("LocalSqliteClient - integrates with AgentStorage using named binds", async () => {
  await withTempDir(async (dir) => {
    const client = new LocalSqliteClient(path.join(dir, "sessions.sqlite"));
    const storage = new AgentStorage(client, "named");

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
});

Deno.test("LocalSqliteClient - data persists across client instances", async () => {
  await withTempDir(async (dir) => {
    const dbPath = path.join(dir, "sessions.sqlite");
    const first = new LocalSqliteClient(dbPath);
    const firstStorage = new AgentStorage(first, "named");
    await firstStorage.store(promptEvent("s1", "persisted", 1000));

    // A new client over the same file sees the previously stored events.
    const second = new LocalSqliteClient(dbPath);
    const secondStorage = new AgentStorage(second, "named");
    const events = await secondStorage.getSessionEvents("s1");
    assertEquals(events.length, 1);
    assertEquals((events[0] as { prompt: string }).prompt, "persisted");
  });
});

Deno.test("LocalSqliteClient - prepare rejects invalid SQL", async () => {
  await withTempDir(async (dir) => {
    const client = new LocalSqliteClient(path.join(dir, "test.sqlite"));
    await assertRejects(() => client.prepare("this is not sql"));
  });
});

Deno.test("getDbPath - appends the db path to the home directory", () => {
  const fs = new LocalFileSystem();
  const home = fs.homeDir();
  if (typeof home === "undefined") {
    // Without a home directory getDbPath must throw.
    let threw = false;
    try {
      getDbPath(fs);
    } catch {
      threw = true;
    }
    assert(threw);
    return;
  }
  const result = getDbPath(fs);
  const expectedBase = home.endsWith("/") ? home.slice(0, -1) : home;
  assertEquals(result, `${expectedBase}/${LIGHTAGENT_DB_PATH}`);
});

Deno.test("getDbPath - strips a trailing slash from the home directory", () => {
  const fs = new LocalFileSystem();
  const originalHome = Deno.env.get("HOME");
  try {
    Deno.env.set("HOME", "/fake/home/");
    const result = getDbPath(fs);
    assertEquals(result, `/fake/home/${LIGHTAGENT_DB_PATH}`);
  } finally {
    if (typeof originalHome === "undefined") {
      Deno.env.delete("HOME");
    } else {
      Deno.env.set("HOME", originalHome);
    }
  }
});

Deno.test("getDbPath - throws when no home directory can be determined", () => {
  const fs = new LocalFileSystem();
  const originalHome = Deno.env.get("HOME");
  const originalUserProfile = Deno.env.get("USERPROFILE");
  try {
    Deno.env.delete("HOME");
    Deno.env.delete("USERPROFILE");
    let threw = false;
    try {
      getDbPath(fs);
    } catch (e) {
      threw = true;
      assert((e as Error).message.includes("home directory"));
    }
    assert(threw, "expected getDbPath to throw without a home directory");
  } finally {
    if (typeof originalHome !== "undefined") {
      Deno.env.set("HOME", originalHome);
    }
    if (typeof originalUserProfile !== "undefined") {
      Deno.env.set("USERPROFILE", originalUserProfile);
    }
  }
});
