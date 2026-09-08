// A minimal stdio MCP server used as a test fixture for McpClient tests.
// It exposes a single `echo` tool that returns its input text, and an
// `explode` tool that always returns an error result.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "fixture", version: "0.0.1" });

server.registerTool(
  "echo",
  {
    description: "Echoes the input text back",
    inputSchema: { text: z.string() },
  },
  ({ text }: { text: string }) => ({
    content: [{ type: "text" as const, text }],
  }),
);

server.registerTool(
  "explode",
  {
    description: "Always fails",
    inputSchema: {},
  },
  () => ({
    isError: true,
    content: [{ type: "text" as const, text: "kaboom" }],
  }),
);

await server.connect(new StdioServerTransport());
