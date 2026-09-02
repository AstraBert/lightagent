import * as v from "valibot";
import { FileUploader } from "./uploader.ts";

interface DOEnv {
  FS: R2Bucket;
  DB: D1Database;
}

const ReposRequestSchema = v.object({
  url: v.string(),
  branch: v.optional(v.string()),
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
    if (request.method.toUpperCase() === "POST") {
      const pathParam = new URL(request.url).pathname;
      switch (pathParam) {
        case "repos": {
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
            const dir = await uploader.gitClone(validated.url, token, {
              branch: validated.branch,
            });
            return Response.json({ directory: dir }, { status: 200 });
          } catch (e) {
            return Response.json({
              detail:
                `An error occurred while trying to download the GitHub repository: ${e}`,
            }, { status: 500 });
          }
        }
        case "files": {
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
            }, { status: 400 });
          }
          try {
            await uploader.uploadFile(path, text);
            return Response.json(null, { status: 204 });
          } catch (e) {
            return Response.json({
              detail: `An error occurred while trying to upload the file: ${e}`,
            }, { status: 500 });
          }
        }
        case "skills": {
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
            }, { status: 500 });
          }
        }
      }
    }

    return new Response("Method not allowed.", { status: 405 });
  },
};
