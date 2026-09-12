import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { LocalShell } from "../src/shell.ts";

Deno.test("LocalShell - runs a command and captures stdout", async () => {
  const shell = new LocalShell();
  const result = await shell.exec("echo", 10, {
    args: ["hello"],
    stdout: "piped",
    stderr: "piped",
    stdin: "null",
  });
  assertEquals(result.success, true);
  assertEquals(result.code, 0);
  assertEquals(result.timedOut, false);
  assertStringIncludes(result.stdout, "hello");
});

Deno.test("LocalShell - reports non-zero exit codes as failures", async () => {
  const shell = new LocalShell();
  // `deno eval` with a failing exit code keeps this cross-platform.
  const result = await shell.exec("deno", 30, {
    args: ["eval", "Deno.exit(3)"],
    stdout: "piped",
    stderr: "piped",
    stdin: "null",
  });
  assertEquals(result.success, false);
  assertEquals(result.code, 3);
  assertEquals(result.timedOut, false);
});

Deno.test("LocalShell - captures stderr separately from stdout", async () => {
  const shell = new LocalShell();
  const result = await shell.exec("deno", 30, {
    args: ["eval", "console.log('out'); console.error('err')"],
    stdout: "piped",
    stderr: "piped",
    stdin: "null",
  });
  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "out");
  assertStringIncludes(result.stderr, "err");
  assertEquals(result.stdout.includes("err"), false);
});

Deno.test("LocalShell - kills the process when the timeout elapses", async () => {
  const shell = new LocalShell();
  const start = Date.now();
  const result = await shell.exec("deno", 1, {
    // Sleeps for 60s without spinning the event loop.
    args: ["eval", "await new Promise((r) => setTimeout(r, 60_000))"],
    stdout: "piped",
    stderr: "piped",
    stdin: "null",
  });
  const elapsed = Date.now() - start;
  assertEquals(result.timedOut, true);
  assertEquals(result.success, false);
  // The command should have been killed shortly after the 1s timeout,
  // well before the 60s sleep completes.
  assert(elapsed < 30_000, `took too long: ${elapsed}ms`);
});

Deno.test("LocalShell - does not report a timeout for fast commands", async () => {
  const shell = new LocalShell();
  const result = await shell.exec("deno", 30, {
    args: ["eval", "console.log('quick')"],
    stdout: "piped",
    stderr: "piped",
    stdin: "null",
  });
  assertEquals(result.timedOut, false);
  assertEquals(result.success, true);
});

Deno.test("LocalShell - rejects when the command does not exist", async () => {
  const shell = new LocalShell();
  let threw = false;
  try {
    await shell.exec("definitely-not-a-real-command-xyz", 5, {
      stdout: "piped",
      stderr: "piped",
      stdin: "null",
    });
  } catch (e) {
    threw = true;
    assert(e instanceof Deno.errors.NotFound);
  }
  assert(threw, "expected exec to reject for a missing command");
});
