import { assert, assertEquals, assertStringIncludes } from "@std/assert";

const FIXTURE_PATH = new URL(
  "./fixtures/logger_fixture.ts",
  import.meta.url,
).pathname;

async function runFixture(...args: string[]): Promise<string> {
  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", FIXTURE_PATH, ...args],
    stdout: "piped",
    stderr: "piped",
    stdin: "null",
  });
  const { code, stdout, stderr } = await cmd.output();
  assertEquals(
    code,
    0,
    `fixture failed: ${new TextDecoder().decode(stderr)}`,
  );
  return new TextDecoder().decode(stdout);
}

Deno.test("EventLogger json mode - emits one JSON object per line", async () => {
  const out = await runFixture("json");
  const lines = out.trim().split("\n");
  // 11 events logged in the fixture.
  assertEquals(lines.length, 11);
  for (const line of lines) {
    const parsed = JSON.parse(line);
    assert(typeof parsed.type === "string");
    assert(typeof parsed.sessionId === "string");
  }
  // Spot-check specific events.
  assertEquals(JSON.parse(lines[0]).type, "session.init");
  assertEquals(JSON.parse(lines[2]).deltaType, "thinking");
  assertEquals(JSON.parse(lines[4]).type, "tool.call");
  assertEquals(JSON.parse(lines[9]).success, true);
  assertEquals(JSON.parse(lines[10]).error, "fatal");
});

Deno.test("EventLogger json mode - replay logs every event as JSON", async () => {
  const out = await runFixture("json", "replay");
  const lines = out.trim().split("\n");
  // 11 direct + 11 replayed.
  assertEquals(lines.length, 22);
  for (const line of lines) {
    JSON.parse(line); // must not throw
  }
});

Deno.test("EventLogger pretty mode - prints session lifecycle information", async () => {
  const out = await runFixture("pretty");
  assertStringIncludes(out, "Starting session sid-1");
  assertStringIncludes(out, "was interrupted");
  assertStringIncludes(out, "toks in: 12");
  assertStringIncludes(out, "toks out: 34");
  assertStringIncludes(out, "ERROR!");
  assertStringIncludes(out, "fatal");
});

Deno.test("EventLogger pretty mode - prints tool calls and results", async () => {
  const out = await runFixture("pretty");
  assertStringIncludes(out, "Calling tool read with arguments:");
  assertStringIncludes(out, "file_path");
  assertStringIncludes(out, "Tool Result for c1");
  assertStringIncludes(out, "file contents");
  assertStringIncludes(out, "boom");
});

Deno.test("EventLogger pretty mode - prints skill loads and deltas", async () => {
  const out = await runFixture("pretty");
  assertStringIncludes(out, "Loaded skill:");
  assertStringIncludes(out, "pdf");
  assertStringIncludes(out, "thinking...");
  assertStringIncludes(out, "answer");
});

Deno.test("EventLogger pretty mode - replay frames user prompts", async () => {
  const out = await runFixture("pretty", "replay");
  // The replayed section re-prints the user prompt with the ">" marker.
  const promptOccurrences = out.split("hello agent").length - 1;
  // Once from... actually the pretty logger does not print user prompts
  // during normal logging, so all occurrences come from the replay.
  assert(promptOccurrences >= 1, "expected the replayed prompt in output");
  assertStringIncludes(out, ">");
});
