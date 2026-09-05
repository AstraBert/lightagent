import { DOFileSystem } from "./fs.ts";
import * as pathLib from "@std/path";
import { UntarStream } from "@std/tar";

async function fetchTarball(
  owner: string,
  repo: string,
  ref: string,
  token: string,
): Promise<ReadableStream<Uint8Array<ArrayBuffer>>> {
  const res = await fetch(
    `https://codeload.github.com/${owner}/${repo}/tar.gz/${ref}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    throw new Error(
      `GitHub returned ${res.status} for ${owner}/${repo}@${ref}`,
    );
  }
  return res.body!;
}

async function untarRepo(
  stream: ReadableStream<Uint8Array<ArrayBuffer>>,
  fs: DOFileSystem,
  repoRootPrefix: string,
) {
  for await (
    const entry of stream.pipeThrough(new DecompressionStream("gzip"))
      .pipeThrough(new UntarStream())
  ) {
    if (!entry.readable) continue; // directory entries have no readable body — skip, R2 needs no mkdir
    const strippedPath = entry.path.replace(/^[^/]+\//, ""); // drop GitHub's "{repo}-{ref}/" wrapper dir
    const targetPath = `/${repoRootPrefix}/${strippedPath}`;
    await fs.writeStream(targetPath, entry.readable);
  }
}

export class FileUploader {
  baseSkillPath: string = ".agents/skills";
  private bucket: R2Bucket;
  private fs: DOFileSystem;

  constructor(bucket: R2Bucket) {
    this.bucket = bucket;
    this.fs = new DOFileSystem(bucket);
  }

  async uploadFile(path: string, content: string) {
    await this.fs.write(path, content);
  }

  async uploadSkill(
    name: string,
    content: string,
    global?: boolean,
    baseDir?: string,
  ): Promise<string> {
    if (global) {
      const p = pathLib.join(
        this.fs.homeDir()!,
        this.baseSkillPath,
        name,
        "SKILL.md",
      );
      await this.fs.write(p, content);
      return p;
    } else {
      const p = pathLib.join(
        baseDir ?? this.fs.cwd(),
        this.baseSkillPath,
        name,
        "SKILL.md",
      );
      await this.fs.write(p, content);
      return p;
    }
  }

  async gitClone(
    owner: string,
    name: string,
    authToken: string,
    ref?: string,
  ) {
    const dir = "/" + name;
    const stream = await fetchTarball(owner, name, ref ?? "main", authToken);
    await untarRepo(stream, this.fs, dir);
    return dir;
  }
}
