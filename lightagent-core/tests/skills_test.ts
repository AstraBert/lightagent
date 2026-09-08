import { assert, assertEquals, assertRejects } from "@std/assert";
import * as path from "@std/path";
import { SkillsClient } from "../src/skills.ts";
import {
  type DirEntry,
  type FileInfo,
  FileNotFoundError,
  type FileSystem,
} from "../src/fs.ts";

/** An in-memory FileSystem test double backed by a map of path to content. */
class FakeFileSystem implements FileSystem {
  env = undefined;
  files: Map<string, string> = new Map();
  home: string | undefined;

  constructor(home: string | undefined = "/home/user") {
    this.home = home;
  }

  private normalize(p: string): string {
    return path.normalize(p);
  }

  readToString(p: string): Promise<string> {
    const content = this.files.get(this.normalize(p));
    if (typeof content === "undefined") {
      return Promise.reject(new FileNotFoundError(`No such file: ${p}`));
    }
    return Promise.resolve(content);
  }

  readLines(p: string, nlines: number): Promise<string[]> {
    return this.readToString(p).then((c) => c.split("\n").slice(0, nlines));
  }

  async *readDir(p: string): AsyncIterable<DirEntry> {
    const prefix = this.normalize(p) + "/";
    const seen = new Set<string>();
    for (const filePath of this.files.keys()) {
      if (!filePath.startsWith(prefix)) continue;
      const rest = filePath.slice(prefix.length);
      const firstSegment = rest.split("/")[0];
      if (seen.has(firstSegment)) continue;
      seen.add(firstSegment);
      const isDir = rest.includes("/");
      yield {
        name: firstSegment,
        isFile: !isDir,
        isDirectory: isDir,
        isSymlink: false,
      };
    }
    // Yield nothing for missing directories (matches an empty dir).
  }

  write(p: string, content: string): Promise<void> {
    this.files.set(this.normalize(p), content);
    return Promise.resolve();
  }

  stat(p: string): Promise<FileInfo> {
    const normalized = this.normalize(p);
    const content = this.files.get(normalized);
    if (typeof content !== "undefined") {
      return Promise.resolve({
        isFile: true,
        isDirectory: false,
      } as FileInfo);
    }
    // Check if it is a directory prefix.
    const prefix = normalized + "/";
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        return Promise.resolve({
          isFile: false,
          isDirectory: true,
        } as FileInfo);
      }
    }
    return Promise.reject(new FileNotFoundError(`No such path: ${p}`));
  }

  homeDir(): string | undefined {
    return this.home;
  }

  cwd(): string {
    return "/workspace";
  }

  mkdir(_p: string, _recursive: boolean): Promise<void> {
    return Promise.resolve();
  }

  /** Test helper: place a skill file in the local skills directory. */
  addLocalSkill(name: string, skillMd: string) {
    this.files.set(
      path.normalize(path.join(".", ".agents/skills", name, "SKILL.md")),
      skillMd,
    );
  }

  /** Test helper: place a skill file in the global skills directory. */
  addGlobalSkill(name: string, skillMd: string) {
    this.files.set(
      path.normalize(path.join(this.home!, ".agents/skills", name, "SKILL.md")),
      skillMd,
    );
  }
}

function skillMd(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;
}

Deno.test("SkillsClient.getSkillPath - returns the local path when the skill exists locally", async () => {
  const fs = new FakeFileSystem();
  fs.addLocalSkill("pdf", skillMd("pdf", "PDF tools", "# PDF\n"));
  const client = new SkillsClient(fs);

  const skillPath = await client.getSkillPath("pdf");
  assertEquals(
    skillPath,
    path.join(".", ".agents/skills", "pdf", "SKILL.md"),
  );
});

Deno.test("SkillsClient.getSkillPath - falls back to the global path", async () => {
  const fs = new FakeFileSystem();
  fs.addGlobalSkill("pdf", skillMd("pdf", "PDF tools", "# PDF\n"));
  const client = new SkillsClient(fs);

  const skillPath = await client.getSkillPath("pdf");
  assertEquals(
    skillPath,
    path.join("/home/user", ".agents/skills", "pdf", "SKILL.md"),
  );
});

Deno.test("SkillsClient.getSkillPath - prefers local over global", async () => {
  const fs = new FakeFileSystem();
  fs.addLocalSkill("pdf", skillMd("pdf", "local", "# Local\n"));
  fs.addGlobalSkill("pdf", skillMd("pdf", "global", "# Global\n"));
  const client = new SkillsClient(fs);

  const skillPath = await client.getSkillPath("pdf");
  assertEquals(
    skillPath,
    path.join(".", ".agents/skills", "pdf", "SKILL.md"),
  );
});

Deno.test("SkillsClient.getSkillPath - throws when the skill does not exist", async () => {
  const fs = new FakeFileSystem();
  const client = new SkillsClient(fs);

  const error = await assertRejects(
    () => client.getSkillPath("missing"),
    Error,
    "could not be found",
  );
  // The error message mentions both lookup locations.
  assert(error.message.includes(".agents/skills"));
});

Deno.test("SkillsClient.getSkillPath - rejects invalid skill names", async () => {
  const fs = new FakeFileSystem();
  const client = new SkillsClient(fs);

  await assertRejects(
    () => client.getSkillPath("Invalid_Name"),
    Error,
    "Invalid skill name",
  );
  await assertRejects(
    () => client.getSkillPath("../traversal"),
    Error,
    "Invalid skill name",
  );
  await assertRejects(
    () => client.getSkillPath(""),
    Error,
    "Invalid skill name",
  );
});

Deno.test("SkillsClient.getSkillPath - rejects path traversal attempts even if a file exists there", async () => {
  const fs = new FakeFileSystem();
  // An attacker-controlled skill name cannot escape the skills directory
  // because assertValidSkillName rejects slashes.
  fs.files.set(path.normalize("./.agents/skills/SKILL.md"), "x");
  const client = new SkillsClient(fs);
  await assertRejects(
    () => client.getSkillPath(".."),
    Error,
    "Invalid skill name",
  );
});

Deno.test("SkillsClient.parseSkill - extracts description and body", async () => {
  const fs = new FakeFileSystem();
  fs.addLocalSkill(
    "pdf",
    skillMd("pdf", "Work with PDF files", "# PDF Skill\nDo PDF things.\n"),
  );
  const client = new SkillsClient(fs);

  const parsed = await client.parseSkill(
    path.join(".", ".agents/skills", "pdf", "SKILL.md"),
  );
  assertEquals(parsed.description, "Work with PDF files");
  assertEquals(parsed.content, "# PDF Skill\nDo PDF things.\n");
});

Deno.test("SkillsClient.parseSkill - throws for a missing file", async () => {
  const fs = new FakeFileSystem();
  const client = new SkillsClient(fs);
  await assertRejects(
    () => client.parseSkill("./.agents/skills/nope/SKILL.md"),
    FileNotFoundError,
  );
});

Deno.test("SkillsClient.parseSkill - throws for content without front matter", async () => {
  const fs = new FakeFileSystem();
  fs.addLocalSkill("broken", "no front matter here");
  const client = new SkillsClient(fs);
  await assertRejects(
    () => client.parseSkill("./.agents/skills/broken/SKILL.md"),
  );
});

Deno.test("SkillsClient.findSkills - discovers global and local skills", async () => {
  const fs = new FakeFileSystem();
  fs.addGlobalSkill("alpha", skillMd("alpha", "Global alpha", "# A\n"));
  fs.addLocalSkill("beta", skillMd("beta", "Local beta", "# B\n"));
  const client = new SkillsClient(fs);

  const skills = await client.findSkills();
  assertEquals(skills.size, 2);
  assertEquals(skills.get("alpha"), "Global alpha");
  assertEquals(skills.get("beta"), "Local beta");
});

Deno.test("SkillsClient.findSkills - local skills shadow global skills with the same name", async () => {
  const fs = new FakeFileSystem();
  fs.addGlobalSkill("pdf", skillMd("pdf", "Global PDF", "# Global\n"));
  fs.addLocalSkill("pdf", skillMd("pdf", "Local PDF", "# Local\n"));
  const client = new SkillsClient(fs);

  const skills = await client.findSkills();
  assertEquals(skills.size, 1);
  assertEquals(skills.get("pdf"), "Local PDF");
});

Deno.test("SkillsClient.findSkills - ignores directories without a SKILL.md", async () => {
  const fs = new FakeFileSystem();
  fs.addLocalSkill("good", skillMd("good", "Good skill", "# G\n"));
  // A directory that contains no SKILL.md.
  fs.files.set(
    path.normalize("./.agents/skills/incomplete/README.md"),
    "not a skill",
  );
  const client = new SkillsClient(fs);

  const skills = await client.findSkills();
  assertEquals(skills.size, 1);
  assertEquals(skills.get("good"), "Good skill");
});

Deno.test("SkillsClient.findSkills - ignores plain files in the skills directory", async () => {
  const fs = new FakeFileSystem();
  fs.addLocalSkill("good", skillMd("good", "Good skill", "# G\n"));
  // A stray file directly inside the skills directory.
  fs.files.set(path.normalize("./.agents/skills/notes.txt"), "notes");
  const client = new SkillsClient(fs);

  const skills = await client.findSkills();
  assertEquals(skills.size, 1);
  assert(skills.has("good"));
});

Deno.test("SkillsClient.findSkills - returns an empty map when no skills exist", async () => {
  const fs = new FakeFileSystem();
  const client = new SkillsClient(fs);
  const skills = await client.findSkills();
  assertEquals(skills.size, 0);
});
