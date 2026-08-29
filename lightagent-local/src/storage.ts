import { Database, type Statement as BaseStatement } from "@db/sqlite";
import {
  type SqlBindParameters,
  SqliteClient,
  type SqlStatement,
} from "@cle-does-things/lightagent-core";
import { LocalFileSystem } from "./fs.ts";
import * as pathlib from "@std/path";

export const LIGHTAGENT_DB_PATH = "lightagent/sessions.sqlite";

export class LocalSqlStatement<T extends object> implements SqlStatement<T> {
  private base: BaseStatement<T>;

  constructor(base: BaseStatement<T>) {
    this.base = base;
  }

  // deno-lint-ignore require-await
  async all(...parameters: SqlBindParameters): Promise<T[]> {
    return this.base.all(...parameters);
  }

  // deno-lint-ignore require-await
  async get(...parameters: SqlBindParameters): Promise<T | undefined> {
    return this.base.get(...parameters);
  }
}

export class LocalSqliteClient implements SqliteClient {
  dbPath: string;
  private db: Database | undefined = undefined;
  private fs: LocalFileSystem = new LocalFileSystem();

  constructor(path: string) {
    this.dbPath = path;
  }

  async initDb(fs: LocalFileSystem) {
    if (!this.db) {
      await fs.mkdir(pathlib.dirname(this.dbPath), true);
      this.db = new Database(this.dbPath);
      this.db.exec("pragma journal_mode = WAL");
      this.db.exec("pragma synchronous = NORMAL");
    }
  }

  async exec(sql: string, ...parameters: SqlBindParameters): Promise<void> {
    await this.initDb(this.fs);
    this.db!.exec(sql, ...parameters);
  }

  async prepare<T extends object>(sql: string): Promise<SqlStatement<T>> {
    await this.initDb(this.fs);
    const stmt = this.db!.prepare<T>(sql);
    return new LocalSqlStatement(stmt);
  }
}

export function getDbPath(fs: LocalFileSystem) {
  const base = fs.homeDir();
  if (!base) {
    throw new Error(
      `Could not find a home directory for the current environment. Ensure that the variable ${
        fs.env.os() === "windows" ? "USERPROFILE" : "HOME"
      } is set.`,
    );
  }
  const path = (base.endsWith("/") ? base.slice(0, base.length - 1) : base) +
    "/" + LIGHTAGENT_DB_PATH;
  return path;
}
