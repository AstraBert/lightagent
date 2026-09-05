import * as v from "valibot";
import { FileUploader } from "./uploader.ts";
import { Provider } from "@cle-does-things/lightagent-core";
import { DOLightAgent } from "./agent.ts";

interface DOEnv {
  FS: R2Bucket;
  DB: D1Database;
}

const AgentRequestSchema = v.object({
  model: v.string(),
  base_url: v.optional(v.string()),
  skills: v.optional(v.array(v.string())),
  auto_skill_discovery: v.optional(v.boolean()),
  prompt_caching: v.optional(v.boolean()),
  parallel_tool_calls: v.optional(v.boolean()),
  system: v.optional(v.object({
    content: v.string(),
    append: v.boolean(),
  })),
  prompt: v.string(),
  session_id: v.optional(v.string()),
});

const ReposRequestSchema = v.object({
  owner: v.string(),
  name: v.string(),
  ref: v.optional(v.string()),
});

const SkillsRequestSchema = v.object({
  content: v.string(),
  name: v.string(),
  global: v.optional(v.boolean()),
  cwd: v.optional(v.string()),
});

export default {
  async fetch(request: Request, env: DOEnv) {
    const uploader = new FileUploader(env.FS);
    if (request.method === "POST") {
      const pathParam = new URL(request.url).pathname;
      switch (pathParam) {
        case "/agents": {
          const openaiKey = request.headers.get("x-openai-key");
          const anthropicKey = request.headers.get("x-anthropic-key");
          if (!openaiKey && !anthropicKey) {
            return Response.json({
              detail:
                "You need to provide an OpenAI API key under the `x-openai-key` header or an Anthropic API key under the `x-anthropic-key` header",
            }, { status: 401 });
          }
          if (openaiKey && anthropicKey) {
            return Response.json({
              detail:
                "You can provide only one of `x-openai-key` and `x-anthropic-key` header",
            }, { status: 400 });
          }
          const provider: Provider = openaiKey ? "openai" : "anthropic";
          const apiKey = (openaiKey ?? anthropicKey) as string;
          try {
            const data = await request.json();
            const validated = v.parse(AgentRequestSchema, data);
            const agent = new DOLightAgent({
              model: validated.model,
              db: env.DB,
              bucket: env.FS,
              provider,
              apiKey,
              baseUrl: validated.base_url,
              system: validated.system,
              promptCaching: validated.prompt_caching,
              autoSkillDiscovery: validated.auto_skill_discovery,
              skillsList: validated.skills,
              parallelToolCalls: validated.parallel_tool_calls,
            });
            await agent.checkForMigrations();
            await agent.initWasm();
            const controller = new AbortController();
            request.signal.addEventListener("abort", () => controller.abort());
            const signal = controller.signal;
            const stream = new ReadableStream<Uint8Array>({
              async start(streamController) {
                const encoder = new TextEncoder();
                try {
                  for await (
                    const chunk of agent.run(validated.prompt, {
                      sessionId: validated.session_id,
                      abortSignal: signal,
                    })
                  ) {
                    if (controller.signal.aborted) break;
                    streamController.enqueue(
                      encoder.encode(JSON.stringify(chunk) + "\n"),
                    );
                  }
                  streamController.close();
                } catch (err) {
                  streamController.error(err);
                }
              },
              cancel(reason) {
                // Fires if the *consumer* of this stream cancels it (e.g. client aborts mid-read)
                controller.abort(reason);
              },
            });
            return new Response(stream, {
              headers: { "Content-Type": "application/x-ndjson" },
            });
          } catch (e) {
            return Response.json({
              detail: `An error occurred while running your agent: ${e}`,
              stack: e instanceof Error ? (e.stack ?? "no stack") : "no stack",
            }, { status: 500 });
          }
        }
        case "/repos": {
          const token = request.headers.get("x-github-token");
          if (!token) {
            return Response.json({
              detail:
                "You need to provide a GitHub access token under the `x-github-token` header",
            }, { status: 401 });
          }
          try {
            const data = await request.json();
            const validated = v.parse(ReposRequestSchema, data);
            const dir = await uploader.gitClone(
              validated.owner,
              validated.name,
              token,
              validated.ref,
            );
            return Response.json({ directory: dir }, { status: 200 });
          } catch (e) {
            return Response.json({
              detail:
                `An error occurred while trying to download the GitHub repository: ${e}`,
              stack: e instanceof Error ? (e.stack ?? "no stack") : "no stack",
            }, { status: 500 });
          }
        }
        case "/files": {
          const form = await request.formData();
          const fl = form.get("file");
          const path = form.get("path");
          if (!fl) {
            return Response.json({
              detail: "Missing required form data field: file",
            }, { status: 400 });
          }
          if (!path) {
            return Response.json({
              detail: "Missing required form data field: path",
            }, { status: 400 });
          }
          if (typeof fl === "string") {
            return Response.json({
              detail:
                "Found `file` in the current form data, but it is a string.",
            }, { status: 400 });
          }
          if (typeof path !== "string") {
            return Response.json({
              detail:
                "Found 'path' in the current form data, but it is not a string",
            }, { status: 400 });
          }
          let text: string;
          try {
            text = await fl.text();
          } catch (e) {
            return Response.json({
              detail:
                `An error occurred while trying to read the file to text: ${e}. Provided files should always be text-based`,
              stack: e instanceof Error ? (e.stack ?? "no stack") : "no stack",
            }, { status: 400 });
          }
          try {
            await uploader.uploadFile(path, text);
            return Response.json(null, { status: 204 });
          } catch (e) {
            return Response.json({
              detail: `An error occurred while trying to upload the file: ${e}`,
              stack: e instanceof Error ? (e.stack ?? "no stack") : "no stack",
            }, { status: 500 });
          }
        }
        case "/skills": {
          try {
            const data = await request.json();
            const validated = v.parse(SkillsRequestSchema, data);
            const skillPath = await uploader.uploadSkill(
              validated.name,
              validated.content,
              validated.global,
              validated.cwd,
            );
            return Response.json({ path: skillPath }, { status: 200 });
          } catch (e) {
            return Response.json({
              detail:
                `An error occurred while trying to upload the skill: ${e}`,
              stack: e instanceof Error ? (e.stack ?? "no stack") : "no stack",
            }, { status: 500 });
          }
        }
      }
    }

    return new Response("Method not allowed.", { status: 405 });
  },
};
