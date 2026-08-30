import type { Environment } from "@cle-does-things/lightagent-core";

export interface FileInfo {
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  mtime: Date | null;
  atime: Date | null;
  birthtime: Date | null;
  ctime: Date | null;
  dev: number;
  ino: number | null;
  mode: number | null;
  nlink: number | null;
  uid: number | null;
  gid: number | null;
  rdev: number | null;
  blksize: number | null;
  blocks: number | null;
  isBlockDevice: boolean | null;
  isCharDevice: boolean | null;
  isFifo: boolean | null;
  isSocket: boolean | null;
}

export interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
}

export class FileNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileNotFoundError";
    Object.setPrototypeOf(this, FileNotFoundError.prototype);
  }
}

export interface FileSystem {
  env: Environment | undefined;
  readToString: (path: string) => Promise<string>;
  readLines: (path: string, nlines: number) => Promise<string[]>;
  readDir: (path: string) => AsyncIterable<DirEntry>;
  write: (path: string, content: string) => Promise<void>;
  stat: (path: string) => Promise<FileInfo>;
  homeDir: () => string | undefined;
  cwd: () => string;
  mkdir: (path: string, recursive: boolean) => Promise<void>;
}

export async function exists(path: string, fs: FileSystem): Promise<boolean> {
  try {
    await fs.stat(path);
  } catch (e) {
    if (e instanceof FileNotFoundError) {
      return false;
    }
    throw e;
  }
  return true;
}
