import { assert, assertEquals } from "@std/assert";
import * as path from "@std/path";
import {
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  LocalLightAgent,
} from "../src/agent.ts";
import {
  type AgentEvent,
  AgentStorage,
} from "@cle-does-things/lightagent-core";
import { getDbPath, LocalSqliteClient } from "../src/storage.ts";
import { LocalFileSystem } from "../src/fs.ts";

/* End-to-end tests for LocalLightAgent against real provider APIs.
 *
 * Each test gives the agent a simple task ("read this file", "run this
 * command", "write this file") and asserts on the events stored in the
 * session database that the expected tool was called and succeeded.
 *
 * Tests are skipped when the corresponding API key is not present in the
 * environment. They run sequentially because they mutate process-global
 * state (HOME and the current working directory). */

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const OPENAI_BASE_URL = Deno.env.get("OPENAI_BASE_URL") ??
  DEFAULT_OPENAI_BASE_URL;
const ANTHROPIC_BASE_URL = Deno.env.get("ANTHROPIC_BASE_URL") ??
  DEFAULT_ANTHROPIC_BASE_URL;

const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5";
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-5.4-mini";

type Provider = "openai" | "anthropic";

interface Task {
  /* Prepare the working directory before the agent runs. */
  setup: (workDir: string) => Promise<void>;
  /* The prompt handed to the agent. */
  prompt: string;
  /* The tool the agent is expected to call. */
  toolName: string;
  /* Extra assertions on the stored events and/or the working directory. */
  verify?: (events: AgentEvent[], workDir: string) => Promise<void>;
}

/** Sets up an isolated environment: a temp HOME (for the session database)
 * and a temp working directory (for file tool operations), and switches the
 * process into it. Returns a restore function. */
async function setupEnv(): Promise<() => Promise<void>> {
  const homeDir = await Deno.makeTempDir({ prefix: "lightagent_e2e_home_" });
  const workDir = await Deno.makeTempDir({ prefix: "lightagent_e2e_work_" });
  const originalHome = Deno.env.get("HOME");
  const originalUserProfile = Deno.env.get("USERPROFILE");
  const originalCwd = Deno.cwd();

  Deno.env.set("HOME", homeDir);
  Deno.env.delete("USERPROFILE");
  Deno.chdir(workDir);

  return async () => {
    Deno.chdir(originalCwd);
    if (typeof originalHome === "undefined") {
      Deno.env.delete("HOME");
    } else {
      Deno.env.set("HOME", originalHome);
    }
    if (typeof originalUserProfile !== "undefined") {
      Deno.env.set("USERPROFILE", originalUserProfile);
    }
    await Deno.remove(homeDir, { recursive: true });
    await Deno.remove(workDir, { recursive: true });
  };
}

/** Runs the agent to completion (or abort after 2 minutes), collecting all
 * emitted events. Returns the captured session id. */
async function runAgent(
  agent: LocalLightAgent,
  prompt: string,
): Promise<string> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 120_000);
  let sessionId = "";
  try {
    for await (
      const event of agent.run(prompt, { abortSignal: abort.signal })
    ) {
      if (event.type === "session.init") {
        sessionId = event.sessionId;
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return sessionId;
}

/** Reads the events persisted in the session database. */
async function storedEvents(sessionId: string): Promise<AgentEvent[]> {
  const fs = new LocalFileSystem();
  const db = new LocalSqliteClient(getDbPath(fs));
  const storage = new AgentStorage(db, "named");
  const events = await storage.getSessionEvents(sessionId);
  assert(events.length > 0, "expected stored events for the session");
  return events;
}

/** Asserts that the stored events show a successful session in which the
 * given tool was called and returned a successful result. */
function assertSuccessfulToolSession(
  events: AgentEvent[],
  toolName: string,
): void {
  const types = events.map((e) => e.type);
  assert(types.includes("session.init"), `missing session.init in ${types}`);
  assert(
    types.includes("user.prompt_submit"),
    `missing user.prompt_submit in ${types}`,
  );

  const toolCalls = events.filter(
    (e) => e.type === "tool.call_any" && e.name === toolName,
  );
  assert(
    toolCalls.length > 0,
    `expected a tool.call_any for "${toolName}", got events: ${
      types.join(", ")
    }`,
  );

  const toolCallIds = new Set(
    toolCalls.map((e) => (e as { toolCallId: string }).toolCallId),
  );
  const results = events.filter(
    (e) =>
      e.type === "tool.result" &&
      toolCallIds.has((e as { toolCallId: string }).toolCallId),
  );
  assert(results.length > 0, `expected a tool.result for the ${toolName} call`);
  for (const result of results) {
    const r = (result as { result: { type: string; error?: string } }).result;
    assertEquals(
      r.type,
      "success",
      `expected ${toolName} to succeed, got error: ${r.error}`,
    );
  }

  const stop = events.find((e) => e.type === "session.stop");
  assert(stop, "missing session.stop");
  assertEquals(
    (stop as { success: boolean }).success,
    true,
    `session failed: ${(stop as { error?: string }).error}`,
  );
}

/** Drives one full e2e scenario in an isolated environment. */
async function runTask(provider: Provider, task: Task): Promise<void> {
  const restore = await setupEnv();
  try {
    const agent = new LocalLightAgent({
      model: provider === "openai" ? OPENAI_MODEL : ANTHROPIC_MODEL,
      provider,
      baseUrl: provider === "openai" ? OPENAI_BASE_URL : ANTHROPIC_BASE_URL,
      promptCaching: false,
    });
    await agent.initWasm();
    const workDir = Deno.cwd();
    await task.setup(workDir);
    const sessionId = await runAgent(agent, task.prompt);
    assert(sessionId, "no session id captured");
    const events = await storedEvents(sessionId);
    assertSuccessfulToolSession(events, task.toolName);
    if (task.verify) {
      await task.verify(events, workDir);
    }
  } finally {
    await restore();
  }
}

const readTask: Task = {
  setup: async (workDir) => {
    await Deno.writeTextFile(
      path.join(workDir, "notes.txt"),
      "The secret code word is pineapple.",
    );
  },
  prompt:
    `Read the file "notes.txt" using the read tool and tell me the secret code word.`,
  toolName: "read",
};

const shellTask: Task = {
  setup: () => Promise.resolve(),
  prompt:
    `Run the command "echo lightagent-e2e-marker" using the shell tool and tell me what it printed.`,
  toolName: "shell",
  verify: (events) => {
    // The echoed marker should appear in the tool result payload.
    const result = events.find((e) => e.type === "tool.result");
    assert(result);
    const payload = JSON.stringify(result);
    assert(
      payload.includes("lightagent-e2e-marker"),
      `expected marker in tool result: ${payload}`,
    );
    return Promise.resolve();
  },
};

const writeTask: Task = {
  setup: () => Promise.resolve(),
  prompt:
    `Write the text "hello from lightagent e2e" into a file named "output.txt" using the write tool.`,
  toolName: "write",
  verify: async (_events, workDir) => {
    const written = await Deno.readTextFile(path.join(workDir, "output.txt"));
    assert(
      written.includes("hello from lightagent e2e"),
      `unexpected file content: ${written}`,
    );
  },
};

Deno.test({
  name: "e2e (anthropic) - read this file",
  ignore: !ANTHROPIC_API_KEY,
  fn: () => runTask("anthropic", readTask),
});

Deno.test({
  name: "e2e (anthropic) - run this command",
  ignore: !ANTHROPIC_API_KEY,
  fn: () => runTask("anthropic", shellTask),
});

Deno.test({
  name: "e2e (anthropic) - write this file",
  ignore: !ANTHROPIC_API_KEY,
  fn: () => runTask("anthropic", writeTask),
});

Deno.test({
  name: "e2e (openai) - read this file",
  ignore: !OPENAI_API_KEY,
  fn: () => runTask("openai", readTask),
});

Deno.test({
  name: "e2e (openai) - run this command",
  ignore: !OPENAI_API_KEY,
  fn: () => runTask("openai", shellTask),
});

Deno.test({
  name: "e2e (openai) - write this file",
  ignore: !OPENAI_API_KEY,
  fn: () => runTask("openai", writeTask),
});
