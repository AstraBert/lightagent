import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import * as path from "@std/path";
import { LocalLightAgent } from "../src/agent.ts";
import type { AgentEvent } from "@cle-does-things/lightagent-core";

/** Sets HOME to a temp directory so the agent's sqlite database is created
 * in an isolated location, and returns a cleanup function. */
async function withTempHome(
  fn: (home: string) => void | Promise<void>,
): Promise<void> {
  const home = await Deno.makeTempDir({ prefix: "lightagent_agent_test_" });
  const originalHome = Deno.env.get("HOME");
  const originalUserProfile = Deno.env.get("USERPROFILE");
  Deno.env.set("HOME", home);
  Deno.env.delete("USERPROFILE");
  try {
    await fn(home);
  } finally {
    if (typeof originalHome === "undefined") {
      Deno.env.delete("HOME");
    } else {
      Deno.env.set("HOME", originalHome);
    }
    if (typeof originalUserProfile !== "undefined") {
      Deno.env.set("USERPROFILE", originalUserProfile);
    }
    await Deno.remove(home, { recursive: true });
  }
}

/** Runs `fn` with the provider API key environment variables saved and
 * cleared, restoring them afterwards. */
async function withoutApiKeys(
  fn: () => void | Promise<void>,
): Promise<void> {
  const openai = Deno.env.get("OPENAI_API_KEY");
  const anthropic = Deno.env.get("ANTHROPIC_API_KEY");
  Deno.env.delete("OPENAI_API_KEY");
  Deno.env.delete("ANTHROPIC_API_KEY");
  try {
    await fn();
  } finally {
    if (typeof openai !== "undefined") Deno.env.set("OPENAI_API_KEY", openai);
    if (typeof anthropic !== "undefined") {
      Deno.env.set("ANTHROPIC_API_KEY", anthropic);
    }
  }
}

Deno.test("LocalLightAgent - explicit provider and apiKey are used as-is", async () => {
  await withTempHome(() => {
    const agent = new LocalLightAgent({
      model: "gpt-5",
      provider: "openai",
      apiKey: "sk-explicit",
    });
    assertEquals(agent.provider, "openai");
    assertEquals(agent.apiKey, "sk-explicit");
  });
});

Deno.test("LocalLightAgent - provider without apiKey reads the key from the environment", async () => {
  await withTempHome(() => {
    Deno.env.set("ANTHROPIC_API_KEY", "sk-ant-env");
    try {
      const agent = new LocalLightAgent({
        model: "claude",
        provider: "anthropic",
      });
      assertEquals(agent.provider, "anthropic");
      assertEquals(agent.apiKey, "sk-ant-env");
    } finally {
      Deno.env.delete("ANTHROPIC_API_KEY");
    }
  });
});

Deno.test("LocalLightAgent - provider without apiKey throws when the env var is missing", async () => {
  await withTempHome(async () => {
    await withoutApiKeys(() => {
      let threw = false;
      try {
        new LocalLightAgent({ model: "claude", provider: "anthropic" });
      } catch (e) {
        threw = true;
        assertStringIncludes(
          (e as Error).message,
          "ANTHROPIC_API_KEY",
        );
      }
      assert(threw, "expected constructor to throw");
    });
  });
});

Deno.test("LocalLightAgent - infers openai from OPENAI_API_KEY", async () => {
  await withTempHome(async () => {
    await withoutApiKeys(() => {
      Deno.env.set("OPENAI_API_KEY", "sk-openai-env");
      const agent = new LocalLightAgent({ model: "gpt-5" });
      assertEquals(agent.provider, "openai");
      assertEquals(agent.apiKey, "sk-openai-env");
    });
  });
});

Deno.test("LocalLightAgent - infers anthropic from ANTHROPIC_API_KEY when openai is absent", async () => {
  await withTempHome(async () => {
    await withoutApiKeys(() => {
      Deno.env.set("ANTHROPIC_API_KEY", "sk-ant-env");
      const agent = new LocalLightAgent({ model: "claude" });
      assertEquals(agent.provider, "anthropic");
      assertEquals(agent.apiKey, "sk-ant-env");
    });
  });
});

Deno.test("LocalLightAgent - prefers OPENAI_API_KEY when both keys are present", async () => {
  await withTempHome(async () => {
    await withoutApiKeys(() => {
      Deno.env.set("OPENAI_API_KEY", "sk-openai-env");
      Deno.env.set("ANTHROPIC_API_KEY", "sk-ant-env");
      const agent = new LocalLightAgent({ model: "gpt-5" });
      assertEquals(agent.provider, "openai");
    });
  });
});

Deno.test("LocalLightAgent - throws when no credentials are available at all", async () => {
  await withTempHome(async () => {
    await withoutApiKeys(() => {
      let threw = false;
      try {
        new LocalLightAgent({ model: "gpt-5" });
      } catch (e) {
        threw = true;
        assertStringIncludes((e as Error).message, "could not infer provider");
      }
      assert(threw, "expected constructor to throw");
    });
  });
});

Deno.test("LocalLightAgent - throws when only an apiKey is given without a provider", async () => {
  await withTempHome(async () => {
    await withoutApiKeys(() => {
      let threw = false;
      try {
        new LocalLightAgent({ model: "gpt-5", apiKey: "sk-lonely" });
      } catch (e) {
        threw = true;
        assertStringIncludes(
          (e as Error).message,
          "Cannot infer provider from the API key only",
        );
      }
      assert(threw, "expected constructor to throw");
    });
  });
});

Deno.test("LocalLightAgent - default base URLs depend on the provider", async () => {
  await withTempHome(() => {
    const openai = new LocalLightAgent({
      model: "gpt-5",
      provider: "openai",
      apiKey: "k",
    });
    assertEquals(openai.baseUrl, "https://api.openai.com/v1");

    const anthropic = new LocalLightAgent({
      model: "claude",
      provider: "anthropic",
      apiKey: "k",
    });
    assertEquals(anthropic.baseUrl, "https://api.anthropic.com/v1");
  });
});

Deno.test("LocalLightAgent - custom baseUrl overrides the default", async () => {
  await withTempHome(() => {
    const agent = new LocalLightAgent({
      model: "gpt-5",
      provider: "openai",
      apiKey: "k",
      baseUrl: "http://localhost:1234/v1",
    });
    assertEquals(agent.baseUrl, "http://localhost:1234/v1");
  });
});

Deno.test("LocalLightAgent - default system prompt is the built-in identity prompt", async () => {
  await withTempHome(() => {
    const agent = new LocalLightAgent({
      model: "gpt-5",
      provider: "openai",
      apiKey: "k",
    });
    assertStringIncludes(agent.system, "You are LightAgent");
    assertStringIncludes(agent.system, "Zen of Python");
  });
});

Deno.test("LocalLightAgent - custom system prompt replaces the default when append is false", async () => {
  await withTempHome(() => {
    const agent = new LocalLightAgent({
      model: "gpt-5",
      provider: "openai",
      apiKey: "k",
      system: { content: "custom prompt", append: false },
    });
    assertEquals(agent.system, "custom prompt");
  });
});

Deno.test("LocalLightAgent - custom system prompt is appended to the default when append is true", async () => {
  await withTempHome(() => {
    const agent = new LocalLightAgent({
      model: "gpt-5",
      provider: "openai",
      apiKey: "k",
      system: { content: "extra instructions", append: true },
    });
    assertStringIncludes(agent.system, "You are LightAgent");
    assertStringIncludes(agent.system, "extra instructions");
    // The custom content comes after the default prompt.
    assert(
      agent.system.indexOf("You are LightAgent") <
        agent.system.indexOf("extra instructions"),
    );
  });
});

Deno.test("LocalLightAgent - option defaults", async () => {
  await withTempHome(() => {
    const agent = new LocalLightAgent({
      model: "gpt-5",
      provider: "openai",
      apiKey: "k",
    });
    assertEquals(agent.promptCaching, true);
    assertEquals(agent.parallelToolCalls, false);
    assertEquals(agent.autoSkillDiscovery, true);
    assertEquals(agent.skillsList, []);
  });
});

Deno.test("LocalLightAgent - autoSkillDiscovery defaults to false when a skillsList is provided", async () => {
  await withTempHome(() => {
    const agent = new LocalLightAgent({
      model: "gpt-5",
      provider: "openai",
      apiKey: "k",
      skillsList: ["pdf"],
    });
    assertEquals(agent.autoSkillDiscovery, false);
    assertEquals(agent.skillsList, ["pdf"]);
  });
});

Deno.test("LocalLightAgent - explicit autoSkillDiscovery wins over skillsList inference", async () => {
  await withTempHome(() => {
    const agent = new LocalLightAgent({
      model: "gpt-5",
      provider: "openai",
      apiKey: "k",
      skillsList: ["pdf"],
      autoSkillDiscovery: true,
    });
    assertEquals(agent.autoSkillDiscovery, true);
  });
});

Deno.test("LocalLightAgent.checkForMigrations - initializes the database", async () => {
  await withTempHome(async (home) => {
    const agent = new LocalLightAgent({
      model: "gpt-5",
      provider: "openai",
      apiKey: "k",
    });
    await agent.checkForMigrations();
    // The sqlite file now exists under the temp home.
    const dbPath = path.join(home, "lightagent", "sessions.sqlite");
    const stat = await Deno.stat(dbPath);
    assert(stat.isFile);
  });
});

Deno.test("LocalLightAgent.getSessionReplay - filters out init, stop and tool.call_any events", async () => {
  await withTempHome(async () => {
    const agent = new LocalLightAgent({
      model: "gpt-5",
      provider: "openai",
      apiKey: "k",
    });

    // Run a minimal session by hand: write events directly through the
    // agent's storage via checkForMigrations + a second agent sharing the
    // same database.
    await agent.checkForMigrations();

    // Store events through another agent instance (same DB path).
    const writer = new LocalLightAgent({
      model: "gpt-5",
      provider: "openai",
      apiKey: "k",
    });
    // Access the private storage via a run-less path: use the public
    // getSessionReplay after inserting events through the storage of a
    // fresh AgentStorage pointed at the same file. Instead, we use the
    // writer agent's storage indirectly: checkForMigrations initializes,
    // then we store via the storage exposed on the object.
    await writer.checkForMigrations();

    const usage = {
      latency: 1,
      inputTokens: 1,
      outputTokens: 1,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    };
    const events: AgentEvent[] = [
      {
        type: "session.init",
        sessionId: "sid",
        initType: "new",
        provider: "openai",
        model: "gpt-5",
        system: "sys",
        timestamp: new Date(1000),
      },
      {
        type: "user.prompt_submit",
        sessionId: "sid",
        turnId: "t1",
        prompt: "hi",
        timestamp: new Date(2000),
      },
      {
        type: "tool.call_any",
        sessionId: "sid",
        turnId: "t1",
        name: "read",
        toolCallId: "c1",
        input: {},
        timestamp: new Date(3000),
      },
      {
        type: "tool.call",
        sessionId: "sid",
        turnId: "t1",
        name: "read",
        toolCallId: "c1",
        input: {},
        timestamp: new Date(3500),
      },
      {
        type: "session.stop",
        sessionId: "sid",
        success: true,
        timestamp: new Date(4000),
        usage,
      },
    ];

    // deno-lint-ignore no-explicit-any
    const storage = (writer as any).storage;
    for (const event of events) {
      await storage.store(event);
    }

    const replay = await agent.getSessionReplay("sid");
    assertEquals(replay.map((e) => e.type), [
      "user.prompt_submit",
      "tool.call",
    ]);
  });
});

Deno.test("LocalLightAgent.getSessionReplay - returns an empty list for unknown sessions", async () => {
  await withTempHome(async () => {
    const agent = new LocalLightAgent({
      model: "gpt-5",
      provider: "openai",
      apiKey: "k",
    });
    assertEquals(await agent.getSessionReplay("nope"), []);
  });
});
