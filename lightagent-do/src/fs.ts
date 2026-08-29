import {
  FileSystem,
  Environment,
  FileNotFoundError,
  FileInfo,
  DirEntry
} from "@cle-does-things/lightagent-core"

export class DOFileSystem implements FileSystem {
  env: Environment | undefined = undefined;
  private base: R2Bucket

  constructor(base: R2Bucket) {
    this.base = base
  }

  async readToString(path: string): Promise<string> {
    const result = await this.base.get(this.pathToKey(path))
    if (!result) { throw new FileNotFoundError(`No such file: ${path}`) }
    const text = await result.text()
    return text
  }

  async write(path: string, content: string): Promise<void> {
    await this.base.put(this.pathToKey(path), content)
  }

  cwd(): string {
    return "/"
  }

  homeDir(): string {
    return "/"
  }

  // deno-lint-ignore require-await
  async mkdir(_path: string, _recursive: boolean): Promise<void> {
    return
  }

  async stat(path: string): Promise<FileInfo> {
    const result = await this.base.head(this.pathToKey(path))
    if (!result) { throw new FileNotFoundError(`No such file or directory: ${path}`) }
    return {
      isFile: true,
      isDirectory: false,
      isSymlink: false,
      isBlockDevice: false,
      isCharDevice: false,
      isFifo: false,
      isSocket: false,
      size: result.size,
      mtime: result.uploaded,
      atime: null,
      birthtime: result.uploaded,
      ctime: null,
      dev: 0,
      ino: null,
      mode: null,
      nlink: null,
      uid: null,
      gid: null,
      rdev: null,
      blksize: null,
      blocks: null,
    }
  }

  async *readDir(path: string): AsyncIterable<DirEntry> {
    const prefix = this.pathToKey(path).replace(/\/?$/, "/")
    const listed = await this.base.list({prefix, delimiter: "/"})
    for (const p of listed.delimitedPrefixes ?? []) {
      yield { name: p.slice(prefix.length, -1), isFile: false, isDirectory: true, isSymlink: false };
    }
    for (const obj of listed.objects) {
      yield { name: obj.key.slice(prefix.length), isFile: true, isDirectory: false, isSymlink: false };
    }
  }

  private pathToKey(path: string): string {
    return path.replace(/^\/+/, "")
  }
}
