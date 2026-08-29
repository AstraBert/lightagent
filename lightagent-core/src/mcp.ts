import * as v from "valibot"
import { MCPClient as InternalClient, type MCPConnection } from "@mcp-use/client"
import type { ToolResult } from "./events.ts"

const StdioMcpServerSchema = v.object({
  type: v.literal("stdio"),
  command: v.string(),
  args: v.optional(v.array(v.string())),
  environment: v.optional(v.record(v.string(), v.string()))
})

const HttpMcpServerSchema = v.object({
  type: v.literal("http"),
  url: v.string(),
  headers: v.optional(v.record(v.string(), v.string()))
})

export const McpServerSchema = v.union([StdioMcpServerSchema, HttpMcpServerSchema])
export type McpServer = v.InferOutput<typeof McpServerSchema>
export const McpServersDefinitionSchema = v.object({
  mcpServers: v.record(v.string(), McpServerSchema)
})

export class McpClient {
  servers: Record<string, McpServer>
  private client: InternalClient

  constructor(servers: Record<string, McpServer>) {
    this.servers = servers
    this.client = new InternalClient({
      mcpServers: this.servers,
    })
  }

  private async createConnection(serverName: string): Promise<MCPConnection> {
    if (!Object.keys(this.servers).includes(serverName)) {
      throw new Error(`Server ${serverName} is not a registered MCP server`)
    }
    return await this.client.connect(serverName)
  }

  async listTools(serverNames?: string[]): Promise<string> {
    const servers = serverNames ?? Object.keys(this.servers)
    const serverDesc = []
    for (const serverName of servers) {
      const conn = await this.createConnection(serverName)
      const tools = await conn.listTools()
      let ls = `# ${serverName}\n`
      for (const tool of tools) {
        ls += `## ${tool.name}\n### Description\n${tool.description ?? 'no description'}\n### Input schema\n${JSON.stringify(tool.inputSchema, undefined, 2)}`
      }
      serverDesc.push(ls)
    }
    return serverDesc.join("\n\n")
  }

  async callTool(serverName: string, toolName: string, toolInput: string): Promise<ToolResult> {
    const conn = await this.createConnection(serverName)
    const result = await conn.callTool(toolName, JSON.parse(toolInput))
    let textResult = ""
    for (const c of result.content) {
      switch (c.type) {
        case "text":
          textResult += c.text + "\n"
          break
        case "resource_link":
          textResult += `Link to resource ${c.name}: ${c.uri}\nDescription: ${c.description ?? 'no description'}\nMimetype: ${c.mimeType ?? 'unknown'}\nSize:${c.size ?? 'unknown'}\n`
          break
        case "resource":
          textResult += `Link to resource: ${c.resource.uri}\nMimetype: ${c.resource.mimeType ?? 'unknown'}`
          break
        default:
          // image and audio are not supported
          continue
      }
    }
    if (result.isError) {
      return { type: "error", error: textResult }
    }
    return { type: "success", result: textResult }
  }
}
