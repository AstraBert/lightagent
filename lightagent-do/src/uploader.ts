import { DOFileSystem } from "./fs.ts";
import * as pathLib from "@std/path";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { FileInfo, FileNotFoundError } from "@cle-does-things/lightagent-core";

interface Stats {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  mode: number; // used to detect executable bit, symlink mode 120000, etc.
  size: number;
  mtimeMs: number; // used for cache invalidation / detecting changed files
  ctimeMs?: number;
  ino?: number | string;
}

class StatsImpl implements Stats {
  mode: number;
  size: number;
  mtimeMs: number;
  ctimeMs?: number;
  ino?: string | number;
  private base: FileInfo;

  constructor(base: FileInfo) {
    this.base = base;
    this.size = base.size;
    this.mode = base.mode ??
      (base.isFile ? 0o100644 : base.isDirectory ? 0o40755 : 0o120000);
    this.mtimeMs = base.mtime?.toTemporalInstant().epochMilliseconds ?? 0;
    this.ino = base.ino ?? undefined;
    this.ctimeMs = base.ctime?.toTemporalInstant().epochMilliseconds ?? 0;
  }

  isFile(): boolean {
    return this.base.isFile;
  }

  isDirectory(): boolean {
    return this.base.isDirectory;
  }

  isSymbolicLink(): boolean {
    return this.base.isSymlink;
  }
}

class GitFs implements git.PromiseFsClient {
  private base: R2Bucket;
  repoRoot: string;

  constructor(base: R2Bucket, repoRoot: string) {
    this.base = base;
    this.repoRoot = repoRoot
  }

  private pathToKey(path: string): string {
    return path.replace(/^\/+/, "");
  }

  private normalizePath(path: string): string {
    const parts = path.split("/").filter((p) => p !== "" && p !== ".");
    const stack: string[] = [];
    for (const part of parts) {
      if (part === "..") stack.pop();
      else stack.push(part);
    }
    return "/" + stack.join("/");
  }

  private isImpliedDirectory(path: string): boolean {
    const normalized = this.normalizePath(path);
    return normalized === "/" || normalized === "" || normalized === this.repoRoot;
  }

  readonly promises = {
    readFile: async (
      path: string,
      opts?: { encoding?: string } | string,
    ): Promise<Uint8Array | string> => {
      const result = await this.base.get(this.pathToKey(path));
      if (!result) throw new FileNotFoundError(`No such file: ${path}`);
      const content = await result.arrayBuffer();
      if (
        opts && (
          (
            typeof opts === "object" && opts.encoding &&
            opts.encoding === "utf8"
          ) || (
            typeof opts === "string" && opts == "utf8"
          )
        )
      ) {
        const decoder = new TextDecoder();
        return decoder.decode(content);
      }
      return new Uint8Array(content);
    },
    writeFile: async (
      path: string,
      data: Uint8Array | string,
      _opts?: unknown,
    ): Promise<void> => {
      await this.base.put(this.pathToKey(path), data);
    },
    unlink: async (path: string, _opts?: unknown): Promise<void> => {
      await this.base.delete(this.pathToKey(path));
    },
    readdir: async (path: string, opts?: unknown): Promise<string[]> => {
      const fs = new DOFileSystem(this.base);
      let recursive = false;
      if (
        opts && typeof opts === "object" && "recursive" in opts &&
        typeof opts.recursive === "boolean"
      ) {
        recursive = opts.recursive;
      }
      const readDir = async (
        directory: string,
        recursive: boolean,
      ): Promise<string[]> => {
        const entries = [];
        for await (const entry of fs.readDir(directory)) {
          if (entry.isFile) {
            entries.push(entry.name);
          } else if (entry.isDirectory) {
            if (recursive) {
              const newEntries = await readDir(
                pathLib.join(directory, entry.name),
                recursive,
              );
              entries.push(...newEntries);
            } else {
              entries.push(entry.name);
            }
          }
        }
        return entries;
      };
      const entries = await readDir(path, recursive);
      return entries;
    },
    mkdir: async (_path: string): Promise<void> => {
      // no-opt in R2
    },
    rmdir: async (path: string): Promise<void> => {
      let cursor: string | undefined;

      do {
        const listed = await this.base.list({
          prefix: this.pathToKey(path),
          cursor,
        }); // no delimiter — get every key under prefix, recursively
        const keys = listed.objects.map((obj) => obj.key);

        if (keys.length > 0) {
          await this.base.delete(keys); // R2's delete() accepts a string[] — batches in one call
        }

        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);
    },
    stat: async (path: string): Promise<Stats> => {
      if (this.isImpliedDirectory(path)) {
        // repo root always "exists" as a directory, even with zero objects under it yet
        return new StatsImpl({
          isFile: false,
          isDirectory: true,
          isSymlink: false,
          size: 0,
          mtime: null, atime: null, birthtime: null, ctime: null,
          dev: 0, ino: null, mode: null, nlink: null,
          uid: null, gid: null, rdev: null, blksize: null, blocks: null,
          isBlockDevice: false, isCharDevice: false, isFifo: false, isSocket: false,
        });
      }
      const fs = new DOFileSystem(this.base);
      const info = await fs.stat(path);
      return new StatsImpl(info);
    },
    lstat: async (path: string): Promise<Stats> => {
      if (this.isImpliedDirectory(path)) {
        // repo root always "exists" as a directory, even with zero objects under it yet
        return new StatsImpl({
          isFile: false,
          isDirectory: true,
          isSymlink: false,
          size: 0,
          mtime: null, atime: null, birthtime: null, ctime: null,
          dev: 0, ino: null, mode: null, nlink: null,
          uid: null, gid: null, rdev: null, blksize: null, blocks: null,
          isBlockDevice: false, isCharDevice: false, isFifo: false, isSocket: false,
        });
      }
      const fs = new DOFileSystem(this.base);
      const info = await fs.stat(path);
      return new StatsImpl(info);
    },
    // deno-lint-ignore require-await
    readlink: async (_path: string): Promise<string> => {
      throw new Error("readlink not supported on R2-backed filesystem");
      },
    // deno-lint-ignore require-await
    symlink: async (_target: string, _path: string): Promise<void> => {
      throw new Error("symlink not supported on R2-backed filesystem");
    },
    chmod: async (_path: string, _mode: number): Promise<void> => {
      // no-op: R2 has no real file permissions
    },
  };
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
    repositoryUrl: string,
    authToken: string,
    options?: { branch?: string },
  ) {
    const splat = repositoryUrl.split("/");
    const dir = "/" + splat[splat.length - 1].replaceAll(".git", "");
    const fs = new GitFs(this.bucket, dir);
    await git.clone({
      fs,
      http,
      url: repositoryUrl,
      dir,
      singleBranch: true,
      ref: options?.branch,
      onAuth: () => ({
        username: "x-access-token",
        password: authToken,
      }),
    });
    return dir;
  }
}
