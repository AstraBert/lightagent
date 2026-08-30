import { FileSystem, ToolFunction, JsonValue, ToolResult, assertOnlyOneDefined } from "@cle-does-things/lightagent-core";
import * as v from "valibot"
import * as path from "@std/path"
import * as diff from "@libs/diff"

export class GrepTool extends ToolFunction<FileSystem> {
  readonly name: string = "grep"
  readonly description: string = "Perform grep operations on a file"
  readonly inputSchema = v.object({
    path: v.pipe(v.string(), v.description("Path to the file to pipe")),
    pattern: v.pipe(v.string(), v.description("Regex pattern to grep the file for")),
    matches: v.pipe(v.optional(v.number()), v.description("Number of matches to return. Defaults to returning all found matches.")),
    context: v.pipe(v.optional(v.number()), v.description("Number of characthers to preserve before and after the match, for context. Defaults to 0."))
  })

  constructor(ctx: FileSystem) {
    super(ctx)
  }

  async execute(input: JsonValue): Promise<ToolResult> {
    try {
      const validated = v.parse(this.inputSchema, input)
      const re = new RegExp(validated.pattern, "ge")
      const content = await this.ctx.readToString(validated.path)
      let matches = [...content.matchAll(re)]
      if (matches.length) {
        return { type: "success", result: `No match was found for \`${validated.pattern}\` in ${validated.path}`}
      }
      if (typeof validated.matches !== "undefined") {
        matches = matches.slice(0, Math.max(matches.length, validated.matches))
      }
      let toReturn = ""
      let i = 0
      for (const m of matches) {
        i += 1
        let baseMatch = m[0]
        let start = m.index
        let end = m.index + baseMatch.length
        if (typeof validated.context !== "undefined") {
          start = Math.min(0, start - validated.context)
          end = Math.max(content.length, end + validated.context)
          baseMatch = content.slice(start, end)
        }
        toReturn += `Match ${i}:\n${baseMatch}\n(${start}-${end})\n\n---\n\n`
      }
      return { type: "success", result: toReturn }
    } catch (e) {
      return { type: "error", error: `An error occurred while running the \`grep\` tool: ${e}` }
    }
  }
}

export class ReadDirTool extends ToolFunction<FileSystem> {
  readonly name: string = "read_dir"
  readonly description: string = "Read a directory and get its children (files and sub-directories)"
  readonly inputSchema = v.object({
    directory: v.pipe(v.string(), v.description("Path of the directory to read")),
    recursive: v.pipe(v.optional(v.boolean()), v.description("Whether or not to recursively read the directory. Defaults to false."))
  })

  constructor(ctx: FileSystem) {
    super(ctx)
  }

  async execute(input: JsonValue): Promise<ToolResult> {
    try {
      const validated = v.parse(this.inputSchema, input)
      const readDir = async (directory: string, recursive: boolean): Promise<string[]> => {
        const entries = []
        for await (const entry of this.ctx.readDir(directory)) {
          if (entry.isFile) {
            entries.push(`Path: ${path.join(directory, entry.name)} - Type: file`)
          } else if (entry.isDirectory) {
            if (recursive) {
              const newEntries = await readDir(path.join(directory, entry.name), recursive)
              entries.push(...newEntries)
            } else {
              entries.push(`Path: ${path.join(directory, entry.name)} - Type: directory`)
            }
          }
        }
        return entries
      }
      const entries = await readDir(validated.directory, validated.recursive ?? false)
      return { type: "success", result: entries.join("\n") }
    } catch (e) {
      return { type: "error", error: `An error occurred while running the \`read_dir\` tool: ${e}` }
    }
  }
}

export class UnixTool extends ToolFunction<FileSystem> {
  readonly name: string = "unix_tools"
  readonly description: string = "Tool to execute a small group of readonly unix tools: pwd, cat, head, date, diff."
  readonly inputSchema = v.object({
    pwd: v.pipe(v.optional(v.object({})), v.description("Execute `pwd`")),
    cat: v.pipe(v.optional(v.object({
      file: v.pipe(v.string(), v.description("File to cat"))
    })), v.description("Execute `cat <file>`")),
    head: v.pipe(v.optional(v.object({
      n: v.pipe(v.number(), v.description("Number of lines to read from the head of the file")),
      file: v.pipe(v.string(), v.description("File whose head to read"))
    })), v.description("Execute `head -n <n> <file>")),
    date: v.pipe(v.optional(v.object({})), v.description("Execute `date`")),
    diff: v.pipe(v.optional(v.object({
      file1: v.pipe(v.string(), v.description("First file to diff against")),
      file2: v.pipe(v.string(), v.description("Second file to diff against"))
    })), v.description("Execute `diff <file1> <file2>`")),
  })

  constructor(ctx: FileSystem) {
    super(ctx)
  }

  async execute(input: JsonValue): Promise<ToolResult> {
    try {
      const validated = v.parse(this.inputSchema, input)
      const { excess, none } = assertOnlyOneDefined([validated.cat, validated.date, validated.diff, validated.head, validated.pwd])
      if (excess) {
        return {
          type: "error",
          error:
            "You can only request one of the available commands, the others must stay unset.",
        };
      }
      if (none) {
        return {
          type: "error",
          error:
            "You did not request any command from this tool, and you need to request exactly one.",
        };
      }
      if (typeof validated.cat !== "undefined") {
        const content = await this.ctx.readToString(validated.cat.file)
        return { type: "success", result: content }
      } else if (typeof validated.date !== "undefined") {
        const currentDate = new Date()
        return { type: "success", result: currentDate.toISOString() }
      } else if (typeof validated.pwd !== "undefined") {
        return { type: "success", result: this.ctx.cwd() }
      } else if (typeof validated.diff !== "undefined") {
        const content1 = await this.ctx.readToString(validated.diff.file1)
        const content2 = await this.ctx.readToString(validated.diff.file2)
        const d = diff.diff(content1, content2)
        return { type: "success", result: d}
      } else {
        const lines = await this.ctx.readLines(validated.head!.file, validated.head!.n)
        return { type: "success", result: lines.join("\n") }
      }
    } catch (e) {
      return { type: "error", error: `An error occurred while running the \`unix_tools\` tool: ${e}` }
    }
  }
}
