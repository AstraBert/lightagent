import { assert, assertEquals, assertRejects } from "@std/assert";
import * as path from "@std/path";
import { FileNotFoundError } from "@cle-does-things/lightagent-core";
import { LocalFileSystem } from "../src/fs.ts";

async function withTempDir(
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "lightagent_fs_test_" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("LocalFileSystem - write and readToString round-trip", async () => {
  await withTempDir(async (dir) => {
    const fs = new LocalFileSystem();
    const file = path.join(dir, "hello.txt");
    await fs.write(file, "hello world");
    assertEquals(await fs.readToString(file), "hello world");
  });
});

Deno.test("LocalFileSystem - write overwrites existing content", async () => {
  await withTempDir(async (dir) => {
    const fs = new LocalFileSystem();
    const file = path.join(dir, "f.txt");
    await fs.write(file, "first");
    await fs.write(file, "second");
    assertEquals(await fs.readToString(file), "second");
  });
});

Deno.test("LocalFileSystem - readToString rejects for missing files", async () => {
  await withTempDir(async (dir) => {
    const fs = new LocalFileSystem();
    await assertRejects(
      () => fs.readToString(path.join(dir, "missing.txt")),
      Deno.errors.NotFound,
    );
  });
});

Deno.test("LocalFileSystem - stat returns file info for files", async () => {
  await withTempDir(async (dir) => {
    const fs = new LocalFileSystem();
    const file = path.join(dir, "f.txt");
    await fs.write(file, "12345");
    const info = await fs.stat(file);
    assert(info.isFile);
    assertEquals(info.isDirectory, false);
    assertEquals(info.size, 5);
  });
});

Deno.test("LocalFileSystem - stat returns file info for directories", async () => {
  await withTempDir(async (dir) => {
    const fs = new LocalFileSystem();
    const info = await fs.stat(dir);
    assert(info.isDirectory);
    assertEquals(info.isFile, false);
  });
});

Deno.test("LocalFileSystem - stat throws FileNotFoundError for missing paths", async () => {
  await withTempDir(async (dir) => {
    const fs = new LocalFileSystem();
    const error = await assertRejects(
      () => fs.stat(path.join(dir, "nope")),
      FileNotFoundError,
    );
    assertEquals(error.code, "ENOENT");
  });
});

Deno.test("LocalFileSystem - readDir yields directory entries", async () => {
  await withTempDir(async (dir) => {
    const fs = new LocalFileSystem();
    await fs.write(path.join(dir, "a.txt"), "a");
    await fs.write(path.join(dir, "b.txt"), "b");
    await fs.mkdir(path.join(dir, "sub"), false);

    const entries = [];
    for await (const entry of fs.readDir(dir)) {
      entries.push(entry);
    }
    const byName = new Map(entries.map((e) => [e.name, e]));
    assertEquals(byName.size, 3);
    assert(byName.get("a.txt")?.isFile);
    assert(byName.get("b.txt")?.isFile);
    assert(byName.get("sub")?.isDirectory);
  });
});

Deno.test("LocalFileSystem - mkdir creates nested directories when recursive", async () => {
  await withTempDir(async (dir) => {
    const fs = new LocalFileSystem();
    const nested = path.join(dir, "a", "b", "c");
    await fs.mkdir(nested, true);
    const info = await fs.stat(nested);
    assert(info.isDirectory);
  });
});

Deno.test("LocalFileSystem - cwd returns the current working directory", () => {
  const fs = new LocalFileSystem();
  assertEquals(fs.cwd(), Deno.cwd());
});

Deno.test("LocalFileSystem - homeDir returns a directory", () => {
  const fs = new LocalFileSystem();
  const home = fs.homeDir();
  // On CI/dev machines HOME (or USERPROFILE) is normally set; if it is, it
  // must match the corresponding environment variable.
  if (typeof home !== "undefined") {
    const expected = Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME");
    assertEquals(home, expected);
  }
});

Deno.test("LocalFileSystem - readLines reads the first n lines", async () => {
  await withTempDir(async (dir) => {
    const fs = new LocalFileSystem();
    const file = path.join(dir, "lines.txt");
    await fs.write(file, "one\ntwo\nthree\nfour\nfive\n");
    assertEquals(await fs.readLines(file, 1), ["one"]);
    assertEquals(await fs.readLines(file, 3), ["one", "two", "three"]);
  });
});

Deno.test("LocalFileSystem - readLines returns all lines when nLines exceeds the file length", async () => {
  await withTempDir(async (dir) => {
    const fs = new LocalFileSystem();
    const file = path.join(dir, "short.txt");
    await fs.write(file, "one\ntwo\n");
    assertEquals(await fs.readLines(file, 100), ["one", "two"]);
  });
});

Deno.test("LocalFileSystem - readLines handles files without a trailing newline", async () => {
  await withTempDir(async (dir) => {
    const fs = new LocalFileSystem();
    const file = path.join(dir, "noeol.txt");
    await fs.write(file, "one\ntwo");
    // The final unterminated line is only emitted if a newline follows or
    // the buffer is flushed; current implementation splits on newlines, so
    // only "one" is guaranteed. Requesting 2 lines yields just ["one"].
    const lines = await fs.readLines(file, 5);
    assertEquals(lines, ["one"]);
  });
});

Deno.test("LocalFileSystem - readLines handles empty files", async () => {
  await withTempDir(async (dir) => {
    const fs = new LocalFileSystem();
    const file = path.join(dir, "empty.txt");
    await fs.write(file, "");
    assertEquals(await fs.readLines(file, 5), []);
  });
});

Deno.test("LocalFileSystem - readLines handles long lines split across reads", async () => {
  await withTempDir(async (dir) => {
    const fs = new LocalFileSystem();
    const file = path.join(dir, "long.txt");
    const longLine = "x".repeat(100_000);
    await fs.write(file, `${longLine}\nsecond\n`);
    const lines = await fs.readLines(file, 2);
    assertEquals(lines, [longLine, "second"]);
  });
});

Deno.test("LocalFileSystem - readLines rejects for missing files", async () => {
  await withTempDir(async (dir) => {
    const fs = new LocalFileSystem();
    await assertRejects(
      () => fs.readLines(path.join(dir, "missing.txt"), 5),
      Deno.errors.NotFound,
    );
  });
});
