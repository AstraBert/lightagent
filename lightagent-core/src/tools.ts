import * as v from "valibot";
import { toJsonSchema } from "@valibot/to-json-schema";

import type { Tool } from "@cle-does-things/llms-sdk";
import type { JsonValue, ToolResult } from "./events.ts";
import type { SkillsClient } from "./skills.ts";
import { assertFileWithinWorkspace, assertUniqueString } from "./assertions.ts";
import type { FileSystem } from "./fs.ts";
import type { Shell } from "./shell.ts";

type ToolParametersSchema = v.ObjectSchema<
  v.ObjectEntries,
  v.ErrorMessage<v.ObjectIssue> | undefined
>;

/* A callable tool that the agent can invoke.

Implementors define the JSON schema, description, and execution logic.
The agent automatically serialises the LLM's arguments and validates them
against `inputSchema` before calling `execute`. */
export abstract class ToolFunction<Ctx> {
  /*  Unique tool name exposed to the LLM. */
  abstract name: string;
  /* Human-readable description exposed to the LLM. */
  abstract description: string;
  /* JSON Schema describing the arguments this tool accepts. */
  abstract inputSchema: ToolParametersSchema;
  /* Context for tool execution */
  ctx: Ctx;
  /* Run the tool with the validated arguments. */
  abstract execute(input: JsonValue): Promise<ToolResult>;
  /* Convert this tool into the SDK representation used for chat requests. */
  toSdkTool(): Tool {
    return {
      name: this.name,
      description: this.description,
      parameters: toJsonSchema(this.inputSchema),
    };
  }

  constructor(ctx: Ctx) {
    this.ctx = ctx
  }
}

export class SkillsTool extends ToolFunction<SkillsClient> {
  readonly name: string = "skills";
  readonly description: string =
    "Call this tool to load a skill, providing the name of the skill you are invoking";
  readonly inputSchema = v.object({
    skill_name: v.pipe(v.string(), v.description("Name of the skill to load")),
  });

  constructor(ctx: SkillsClient) {
    super(ctx)
  }

  async execute(input: JsonValue): Promise<ToolResult> {
    try {
      const validated = v.parse(this.inputSchema, input);
      const skillPath = await this.ctx.getSkillPath(validated.skill_name);
      const content = (await this.ctx.parseSkill(skillPath)).content;
      return { type: "success", result: content };
    } catch (e) {
      return {
        type: "error",
        error: `An error occurred while executing the \`skills\` tool: ${e}`,
      };
    }
  }
}

export class ReadTool extends ToolFunction<FileSystem> {
  readonly name: string = "read";
  readonly description: string =
    "Call this tool to read a text-based file, optionally with an offset and maximum number of characters to read";
  readonly inputSchema = v.object({
    file_path: v.pipe(v.string(), v.description("Path of the file to read")),
    offset: v.pipe(v.optional(v.number()), v.description("Read the file starting from this offset. Defaults to zero.")),
    max_chars: v.pipe(v.optional(v.number()), v.description("Maximum number of characters to read from the offset. Reads the file to the end by default."))
  });

  constructor(ctx: FileSystem) {
    super(ctx)
  }

  async execute(input: JsonValue): Promise<ToolResult> {
    try {
      const validated = v.parse(this.inputSchema, input);
      const cwd = this.ctx.cwd()
      const resolved = assertFileWithinWorkspace(validated.file_path, cwd)
      let content = await this.ctx.readToString(resolved)
      if (typeof validated.offset !== "undefined") {
        content = content.slice(validated.offset)
      }
      if (typeof validated.max_chars !== "undefined") {
        content = content.slice(0, validated.max_chars)
      }
      return { type: "success", result: content };
    } catch (e) {
      return {
        type: "error",
        error: `An error occurred while executing the \`read\` tool: ${e}`,
      };
    }
  }
}


export class WriteTool extends ToolFunction<FileSystem> {
  readonly name: string = "write";
  readonly description: string =
    "Write the file, by providing a path and the text content to write.";
  readonly inputSchema = v.object({
    file_path: v.pipe(v.string(), v.description("Path of the file to write")),
    content: v.pipe(v.string(), v.description("Content to write to the file")),
  });

  constructor(ctx: FileSystem) {
    super(ctx)
  }

  async execute(input: JsonValue): Promise<ToolResult> {
    try {
      const validated = v.parse(this.inputSchema, input);
      const cwd = this.ctx.cwd()
      const resolved = assertFileWithinWorkspace(validated.file_path, cwd)
      await this.ctx.write(resolved, validated.content);
      return { type: "success", result: `Wrote ${validated.content.length} characters to ${resolved}` };
    } catch (e) {
      return {
        type: "error",
        error: `An error occurred while executing the \`write\` tool: ${e}`,
      };
    }
  }
}

export class EditTool extends ToolFunction<FileSystem> {
  readonly name: string = "edit";
  readonly description: string =
    "Edit a text-based file by replacing an old string with a new one.";
  readonly inputSchema = v.object({
    file_path: v.pipe(v.string(), v.description("Path of the file to edit")),
    old_string: v.pipe(v.string(), v.description("Old string to replace. Must be unique unless `replace_all` is set to True.")),
    new_string: v.pipe(v.string(), v.description("New string to replace the old with")),
    replace_all: v.pipe(v.optional(v.boolean()), v.description("Replace all the occurrences of `old_string` with `new_string`. Defaults to False (checks if `old_string` is unique, fails if not)"))
  });

  constructor(ctx: FileSystem) {
    super(ctx)
  }

  async execute(input: JsonValue): Promise<ToolResult> {
    try {
      const validated = v.parse(this.inputSchema, input);
      if (validated.old_string === "") {
        return {
          type: "error",
          error: "`old_string` should not be empty"
        }
      }
      const cwd = this.ctx.cwd()
      const resolved = assertFileWithinWorkspace(validated.file_path, cwd)
      let content = await this.ctx.readToString(resolved);
      if (validated.replace_all) {
        content = content.replaceAll(validated.old_string, validated.new_string)
      } else {
        assertUniqueString(content, validated.old_string)
        content = content.replace(validated.old_string, validated.new_string)
      }
      await this.ctx.write(resolved, content);
      return { type: "success", result: `Edited ${resolved}` };
    } catch (e) {
      return {
        type: "error",
        error: `An error occurred while executing the \`edit\` tool: ${e}`,
      };
    }
  }
}

export class ShellTool extends ToolFunction<Shell> {
  readonly name: string = "shell";
  readonly description: string =
    "Execute a shell command, with an optional timeout. Do not use this tool to perform destructive and irreversible operations such `rm -rf /`";
  readonly inputSchema = v.object({
    command: v.pipe(v.string(), v.description("Command executable to run")),
    args: v.pipe(v.array(v.string()), v.description("Arguments for the executable")),
    timeout: v.pipe(v.optional(v.number()), v.description("Timeout (in seconds) for the shell command. Defaults to 60 seconds."))
  })

  constructor(ctx: Shell) {
    super(ctx)
  }

  override async execute(input: JsonValue): Promise<ToolResult> {
    try {
      const validated = v.parse(this.inputSchema, input)
        const { code, stdout, stderr, success, timedOut } = await this.ctx.exec(validated.command, validated.timeout ?? 60, {
          args: validated.args,
          stdout: "piped",
          stderr: "piped",
          stdin: "null"
        })

        if (timedOut) {
          return {
            type: "error",
            error: `Command timed out after ${validated.timeout ?? 60}s`
          }
        }

        if (success) {
          return {
            type: "success",
            result: `Command exited with ${code}.\n\nSTDOUT:\n\n${stdout}\n\nSTDERR:\n\n${stderr}`
          }
        } else {
          return {
            type: "error",
            error: `Command exited with ${code}.\n\nSTDOUT:\n\n${stdout}\n\nSTDERR:\n\n${stderr}`
          }
        }
    } catch (e) {
      return {
        type: "error",
        error: `An error occurred while executing the \`shell\` tool: ${e}`,
      };
    }
  }
}
