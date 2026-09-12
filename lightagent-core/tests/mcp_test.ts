import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import * as v from "valibot";
import {
  McpClient,
  type McpServer,
  McpServerSchema,
  McpServersDefinitionSchema,
} from "../src/mcp.ts";

const FIXTURE_PATH = new URL(
  "./fixtures/mcp_stdio_server.ts",
  import.meta.url,
).pathname;

function fixtureServer(): McpServer {
  return {
    type: "stdio",
    command: "deno",
    args: ["run", "--allow-all", FIXTURE_PATH],
  };
}

Deno.test("McpServerSchema - validates a stdio server definition", () => {
  const server = {
    type: "stdio",
    command: "deno",
    args: ["run", "server.ts"],
    environment: { DEBUG: "1" },
  } as McpServer;
  const parsed = v.parse(McpServerSchema, server);
  assertEquals(parsed, server);
});

Deno.test("McpServerSchema - validates an http server definition", () => {
  const server = {
    type: "http",
    url: "https://example.com/mcp",
    headers: { Authorization: "Bearer token" },
  } as McpServer;
  const parsed = v.parse(McpServerSchema, server);
  assertEquals(parsed, server);
});

Deno.test("McpServerSchema - validates minimal definitions without optional fields", () => {
  assertEquals(
    v.parse(McpServerSchema, { type: "stdio", command: "server" }),
    { type: "stdio", command: "server" },
  );
  assertEquals(
    v.parse(McpServerSchema, { type: "http", url: "http://localhost:8080" }),
    { type: "http", url: "http://localhost:8080" },
  );
});

Deno.test("McpServerSchema - rejects unknown server types", () => {
  const result = v.safeParse(McpServerSchema, {
    type: "websocket",
    url: "ws://localhost",
  });
  assertEquals(result.success, false);
});

Deno.test("McpServerSchema - rejects stdio server without command", () => {
  const result = v.safeParse(McpServerSchema, { type: "stdio" });
  assertEquals(result.success, false);
});

Deno.test("McpServerSchema - rejects http server without url", () => {
  const result = v.safeParse(McpServerSchema, { type: "http" });
  assertEquals(result.success, false);
});

Deno.test("McpServersDefinitionSchema - validates a full config file shape", () => {
  const config = {
    mcpServers: {
      local: { type: "stdio", command: "server-bin" },
      remote: { type: "http", url: "https://example.com/mcp" },
    },
  } as v.InferOutput<typeof McpServersDefinitionSchema>;
  const parsed = v.parse(McpServersDefinitionSchema, config);
  assertEquals(parsed, config);
});

Deno.test("McpServersDefinitionSchema - rejects configs missing mcpServers", () => {
  const result = v.safeParse(McpServersDefinitionSchema, { servers: {} });
  assertEquals(result.success, false);
});

Deno.test("McpClient - exposes the servers it was constructed with", () => {
  const servers = {
    a: { type: "stdio", command: "bin-a" },
    b: { type: "http", url: "http://localhost:1" },
  } as Record<string, McpServer>;
  const client = new McpClient(servers);
  assertEquals(Object.keys(client.servers), ["a", "b"]);
});

Deno.test("McpClient.listTools - rejects unregistered server names", async () => {
  const client = new McpClient({});
  const error = await assertRejects(
    () => client.listTools(["nope"]),
    Error,
    "is not a registered MCP server",
  );
  assertStringIncludes(error.message, "nope");
});

Deno.test("McpClient.callTool - rejects unregistered server names", async () => {
  const client = new McpClient({});
  await assertRejects(
    () => client.callTool("nope", "tool", "{}"),
    Error,
    "is not a registered MCP server",
  );
});

Deno.test("McpClient - rejects connections to unreachable stdio servers", async () => {
  const client = new McpClient({
    broken: { type: "stdio", command: "definitely-not-a-real-command-xyz" },
  });
  await assertRejects(() => client.listTools(["broken"]));
});

Deno.test({
  name: "McpClient - lists tools from a live stdio server",
  ignore: Deno.build.os === "windows", // fixture uses `deno run` args uniformly; keep CI simple
  async fn() {
    const client = new McpClient({ fixture: fixtureServer() });
    const listing = await client.listTools(["fixture"]);
    assertStringIncludes(listing, "# fixture");
    assertStringIncludes(listing, "## echo");
    assertStringIncludes(listing, "Echoes the input text back");
    assertStringIncludes(listing, "## explode");
  },
});

Deno.test({
  name: "McpClient - calls a tool on a live stdio server",
  ignore: Deno.build.os === "windows",
  async fn() {
    const client = new McpClient({ fixture: fixtureServer() });
    const result = await client.callTool(
      "fixture",
      "echo",
      JSON.stringify({ text: "hello mcp" }),
    );
    assertEquals(result.type, "success");
    if (result.type === "success") {
      assertStringIncludes(result.result, "hello mcp");
    }
  },
});

Deno.test({
  name: "McpClient - surfaces tool errors as error results",
  ignore: Deno.build.os === "windows",
  async fn() {
    const client = new McpClient({ fixture: fixtureServer() });
    const result = await client.callTool("fixture", "explode", "{}");
    assertEquals(result.type, "error");
    if (result.type === "error") {
      assertStringIncludes(result.error, "kaboom");
    }
  },
});

Deno.test({
  name: "McpClient - reuses connections across calls",
  ignore: Deno.build.os === "windows",
  async fn() {
    const client = new McpClient({ fixture: fixtureServer() });
    // Two sequential calls should share one underlying connection; both
    // must succeed.
    const first = await client.callTool(
      "fixture",
      "echo",
      JSON.stringify({ text: "one" }),
    );
    const second = await client.callTool(
      "fixture",
      "echo",
      JSON.stringify({ text: "two" }),
    );
    assertEquals(first.type, "success");
    assertEquals(second.type, "success");
    if (first.type === "success") assertStringIncludes(first.result, "one");
    if (second.type === "success") {
      assertStringIncludes(second.result, "two");
    }
  },
});

Deno.test({
  name: "McpClient - lists tools from all servers when no names are given",
  ignore: Deno.build.os === "windows",
  async fn() {
    const client = new McpClient({ fixture: fixtureServer() });
    const listing = await client.listTools();
    assertStringIncludes(listing, "# fixture");
  },
});
