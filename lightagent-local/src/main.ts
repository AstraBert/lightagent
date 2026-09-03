import { LocalLightAgent } from "./agent.ts";
import { EventLogger } from "./logger.ts";
import { parseArgs } from "@std/cli";
import { isProvider, Provider } from "@cle-does-things/lightagent-core";
import {
  McpServer,
  McpServersDefinitionSchema,
} from "@cle-does-things/lightagent-core/mcp";
import * as v from "valibot";

const VERSION = "0.1.2";

const HELP_MESSAGE = `
\x1b[1;36mLightAgent CLI v${VERSION}\x1b[0m

A lightweight CLI agent built on Deno.

\x1b[1mUSAGE:\x1b[0m
    lightagent-cli --model <MODEL> [OPTIONS]

\x1b[1mREQUIRED:\x1b[0m
    --model <MODEL>           The model to use (e.g., gpt-4, claude-3-opus)

\x1b[1mPROVIDER OPTIONS:\x1b[0m
    --provider <PROVIDER>     LLM provider: openai, anthropic (default: auto-detect)
    --api-key <KEY>           API key for the provider
    --base-url <URL>          Custom base URL for the API

\x1b[1mAGENT OPTIONS:\x1b[0m
    --system <PROMPT>         Custom system prompt
    --append-system           Append to default system prompt instead of replacing
    --parallel-tool-calls     Enable parallel tool calls (default: false)
    --no-prompt-caching       Disable prompt caching (default: enabled)

\x1b[1mSKILLS & MCP:\x1b[0m
    --skill <SKILL>           Add a skill (can be used multiple times)
    --no-discover-skills      Disable automatic skill discovery (default: enabled)
    --mcps-file <FILE>        Path to MCP servers configuration JSON file

\x1b[1mSESSION OPTIONS:\x1b[0m
    --session-id <ID>         Resume an existing session
    --prompt <PROMPT>         Run in headless mode with the given prompt
    --json                    Output events as JSON (useful for scripting)

\x1b[1mGENERAL:\x1b[0m
    -h, --help                Show this help message
    -v, --version             Show version

\x1b[1mEXAMPLES:\x1b[0m
    # Interactive mode
    lightagent-cli --model gpt-5.6-terra

    # Headless mode with a specific prompt
    lightagent-cli --model claude-sonnet-5 --prompt "Hello, world!"

    # With custom system prompt and skills
    lightagent-cli --model gpt-5.6-terra --system "You are a helpful assistant" --skill web-search

    # Resume a previous session
    lightagent-cli --model gpt-5.6-terra --session-id abc123

\x1b[2mNote: This is alpha software. Expect changes and bugs!\x1b[0m
`;

const encoder = new TextEncoder();
const stdinReader = Deno.stdin.readable.getReader();
Deno.stdin.setRaw(true);

async function readByte(): Promise<number> {
  const { value, done } = await stdinReader.read();
  if (done || !value || value.length === 0) return -1;
  return value[0]; // one byte at a time keeps this simple
}

async function readLine(promptStr: string): Promise<string | null> {
  await Deno.stdout.write(encoder.encode(promptStr));
  const chars: string[] = [];
  while (true) {
    const byte = await readByte();
    if (byte === -1) return null;
    if (byte === 0x04 && chars.length === 0) return null; // Ctrl+D on empty line = exit
    if (byte === 0x0d || byte === 0x0a) { // Enter
      await Deno.stdout.write(encoder.encode("\r\n"));
      return chars.join("");
    }
    if (byte === 0x7f || byte === 0x08) { // Backspace
      if (chars.length) {
        chars.pop();
        await Deno.stdout.write(encoder.encode("\b \b"));
      }
      continue;
    }
    if (byte === 0x03) { // Ctrl+C
      Deno.stdin.setRaw(false);
      Deno.exit(0);
    }
    if (byte >= 0x20) {
      const ch = String.fromCharCode(byte);
      chars.push(ch);
      await Deno.stdout.write(encoder.encode(ch));
    }
  }
}

async function runTurn(
  promptText: string,
  sessionId: string | undefined,
  agent: LocalLightAgent,
  logger: EventLogger,
): Promise<string | undefined> {
  const controller = new AbortController();
  const signal = controller.signal;

  let done = false;
  const _watcher = (async () => {
    while (!done) {
      const byte = await readByte();
      if (byte === 0x1b) {
        controller.abort();
        return;
      }
      if (byte === -1) return;
    }
  })();

  try {
    for await (const event of agent.run(promptText, { sessionId, abortSignal: signal })) {
      await logger.log(event);
      if (event.type === "session.init") {
        sessionId = event.sessionId;
      }
    }
  } catch (err) {
    if (signal.aborted) {
      console.log();
    } else {
      throw err;
    }
  } finally {
    done = true;
    controller.abort(); // no-op if already aborted, just guarantees the watcher's loop condition is false next check
  }

  return sessionId;
}

if (import.meta.main) {
  const cmdOptions = parseArgs(Deno.args, {
    string: [
      "model",
      "provider",
      "api-key",
      "base-url",
      "system",
      "prompt",
      "session-id",
      "skill",
      "mcps-file",
    ],
    boolean: [
      "parallel-tool-calls",
      "append-system",
      "prompt-caching",
      "discover-skills",
      "json",
      "help",
      "version",
    ],
    alias: {
      help: "h",
      version: "v",
    },
    negatable: ["prompt-caching", "discover-skills"],
    collect: ["skill"],
    default: {
      provider: undefined,
      "api-key": undefined,
      "base-url": undefined,
      system: undefined,
      "parallel-tool-calls": false,
      "append-system": false,
      "prompt-caching": true,
      skill: undefined,
      prompt: undefined,
      "mcps-file": undefined,
      "session-id": undefined,
      "discover-skills": true,
      json: false,
      help: false,
      version: false,
    },
  });

  // Handle --help and --version
  if (cmdOptions.help) {
    console.log(HELP_MESSAGE);
    Deno.exit(0);
  }

  if (cmdOptions.version) {
    console.log(`lightagent-cli v${VERSION}`);
    Deno.exit(0);
  }

  if (!cmdOptions.model) {
    console.error(
      "\x1b[1;31mERROR! Missing required option `--model`\x1b[1;39m\n",
    );
    console.error("Run with --help for usage information.");
    Deno.exit(1);
  }

  let system = undefined;
  if (cmdOptions.system) {
    system = {
      content: cmdOptions.system,
      append: cmdOptions["append-system"],
    };
  }
  let mcpServers: Record<string, McpServer> | undefined = undefined;
  if (cmdOptions["mcps-file"]) {
    const content = await Deno.readTextFile(cmdOptions["mcps-file"]);
    const servers = v.parse(McpServersDefinitionSchema, JSON.parse(content));
    mcpServers = servers.mcpServers;
  }

  if (cmdOptions.provider) {
    if (!isProvider(cmdOptions.provider)) {
      console.error(
        "\x1b[1;31mERROR! Unsupported provider. The only supported providers are: openai, anthropic\x1b[1;39m",
      );
      Deno.exit(1);
    }
  }

  const agent = new LocalLightAgent({
    model: cmdOptions.model,
    mcpServers,
    system,
    skillsList: cmdOptions.skill,
    apiKey: cmdOptions["api-key"],
    provider: cmdOptions.provider as Provider | undefined,
    promptCaching: cmdOptions["prompt-caching"],
    parallelToolCalls: cmdOptions["parallel-tool-calls"],
    baseUrl: cmdOptions["base-url"],
    autoSkillDiscovery: cmdOptions["discover-skills"],
  });

  await agent.initWasm();

  await agent.checkForMigrations();

  const logger = new EventLogger(cmdOptions.json);

  // Interactive CLI mode
  if (!cmdOptions.prompt) {
    console.log(`\x1b[1;36mLightAgent v${VERSION}\x1b[0m`);
    console.log(
      "\x1b[2mType your prompt and press Enter. Use Ctrl+C/Ctrl+D or type 'exit' to quit. Use Esc to stop a running session.\x1b[0m\n",
    );
  }

  // When resuming a session, replay its past events so the user can see
  // the conversation so far before continuing it.
  if (cmdOptions["session-id"]) {
    try {
      const replayEvents = await agent.getSessionReplay(
        cmdOptions["session-id"],
      );
      await logger.logReplay(replayEvents);
    } catch (e) {
      console.error(
        `\x1b[1;31mERROR! Could not replay session ${
          cmdOptions["session-id"]
        }: ${e}\x1b[1;39m`,
      );
      Deno.exit(1);
    }
  }

  // Headless mode: --prompt provided
  if (cmdOptions.prompt) {
    await runTurn(cmdOptions.prompt, cmdOptions["session-id"], agent, logger);
    Deno.exit(0);
  }

  let sessionId: string | undefined = cmdOptions["session-id"];

  while (true) {
    const promptText = await readLine("\x1b[1;32m>\x1b[0m ");
    if (promptText === null || promptText.trim().toLowerCase() === "exit") {
      console.log("\x1b[2mGoodbye!\x1b[0m");
      if (sessionId) {
        console.log(
          `\x1b[2mResume this session with: \`lightagent-cli --session-id ${sessionId}\`\x1b[0m`,
        );
      }
      break;
    }
    if (!promptText.trim()) continue;

    sessionId = await runTurn(promptText, sessionId, agent, logger);
    console.log();
  }

  Deno.stdin.setRaw(false);
}
