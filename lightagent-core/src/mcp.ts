import * as v from "valibot";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ToolResult } from "./events.ts";

const StdioMcpServerSchema = v.object({
  type: v.literal("stdio"),
  command: v.string(),
  args: v.optional(v.array(v.string())),
  environment: v.optional(v.record(v.string(), v.string())),
});

const HttpMcpServerSchema = v.object({
  type: v.literal("http"),
  url: v.string(),
  headers: v.optional(v.record(v.string(), v.string())),
});

export const McpServerSchema = v.union([
  StdioMcpServerSchema,
  HttpMcpServerSchema,
]);
export type McpServer = v.InferOutput<typeof McpServerSchema>;
export const McpServersDefinitionSchema = v.object({
  mcpServers: v.record(v.string(), McpServerSchema),
});

const CLIENT_NAME = "lightagent-cli";
const CLIENT_VERSION = "0.1.1";

function createTransport(server: McpServer) {
  switch (server.type) {
    case "stdio":
      return new StdioClientTransport({
        command: server.command,
        args: server.args,
        env: server.environment,
      });
    case "http": {
      const url = new URL(server.url);
      const opts: { requestInit?: RequestInit } = {};
      if (server.headers) {
        opts.requestInit = { headers: server.headers };
      }
      return new StreamableHTTPClientTransport(url, opts);
    }
  }
}

export class McpClient {
  servers: Record<string, McpServer>;
  private connections: Map<string, Client> = new Map();

  constructor(servers: Record<string, McpServer>) {
    this.servers = servers;
  }

  private async createConnection(serverName: string): Promise<Client> {
    const existing = this.connections.get(serverName);
    if (existing) {
      return existing;
    }
    if (!Object.keys(this.servers).includes(serverName)) {
      throw new Error(`Server ${serverName} is not a registered MCP server`);
    }
    const server = this.servers[serverName];
    const transport = createTransport(server);
    const client = new Client({
      name: CLIENT_NAME,
      version: CLIENT_VERSION,
    });
    await client.connect(transport);
    this.connections.set(serverName, client);
    return client;
  }

  async listTools(serverNames?: string[]): Promise<string> {
    const servers = serverNames ?? Object.keys(this.servers);
    const serverDesc = [];
    for (const serverName of servers) {
      const conn = await this.createConnection(serverName);
      const { tools } = await conn.listTools();
      let ls = `# ${serverName}\n`;
      for (const tool of tools) {
        ls += `## ${tool.name}\n### Description\n${
          tool.description ?? "no description"
        }\n### Input schema\n${JSON.stringify(tool.inputSchema, undefined, 2)}`;
      }
      serverDesc.push(ls);
    }
    return serverDesc.join("\n\n");
  }

  async callTool(
    serverName: string,
    toolName: string,
    toolInput: string,
  ): Promise<ToolResult> {
    const conn = await this.createConnection(serverName);
    const result = await conn.callTool({
      name: toolName,
      arguments: JSON.parse(toolInput),
    });
    // The SDK returns a union; the standard variant has `content`, the
    // compatibility variant has `toolResult`. Handle both.
    if ("toolResult" in result && !("content" in result)) {
      return { type: "success", result: JSON.stringify(result.toolResult) };
    }
    const content = (result as { content: unknown[] }).content;
    let textResult = "";
    for (const c of content) {
      const item = c as Record<string, unknown>;
      switch (item.type) {
        case "text":
          textResult += (item.text as string) + "\n";
          break;
        case "resource_link":
          textResult += `Link to resource ${item.name}: ${item.uri}\nDescription: ${
            (item.description as string) ?? "no description"
          }\nMimetype: ${(item.mimeType as string) ?? "unknown"}\nSize:${
            (item.size as number) ?? "unknown"
          }\n`;
          break;
        case "resource": {
          const resource = item.resource as Record<string, unknown>;
          textResult += `Link to resource: ${resource.uri}\nMimetype: ${
            resource.mimeType ?? "unknown"
          }`;
          break;
        }
        default:
          // image and audio are not supported
          continue;
      }
    }
    if ((result as { isError?: boolean }).isError) {
      return { type: "error", error: textResult };
    }
    return { type: "success", result: textResult };
  }
}
