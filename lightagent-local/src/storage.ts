import { Database, type Statement as BaseStatement } from "@db/sqlite";
import { SqliteClient, type SqlBindParameters, type SqlStatement } from "@cle-does-things/lightagent-core";
import { LocalFileSystem } from "./fs.ts";

export class LocalSqlStatement<T extends object> implements SqlStatement<T> {
  private base: BaseStatement<T>

  constructor(base: BaseStatement<T>) {
    this.base = base
  }

  all(...parameters: SqlBindParameters): T[] {
    return this.base.all(...parameters)
  }

  get(...parameters: SqlBindParameters): T | undefined {
    return this.base.get(...parameters)
  }
}

export class LocalSqliteClient implements SqliteClient {
  private readonly db: Database

  constructor(path: string) {
    this.db = new Database(path)
  }

  exec(sql: string, ...parameters: SqlBindParameters): void {
    this.db.exec(sql, ...parameters)
  }

  prepare<T extends object>(sql: string): SqlStatement<T> {
    const stmt = this.db.prepare<T>(sql)
    return new LocalSqlStatement(stmt)
  }
}

export const LIGHTAGENT_DB_PATH = "lightagent/sessions.sqlite";
let dbClient: undefined | LocalSqliteClient = undefined;

export function getDbClient(fs: LocalFileSystem) {
  if (!dbClient) {
    const base = fs.homeDir();
    if (!base) {
      throw new Error(
        `Could not find a home directory for the current environment. Ensure that the variable ${
          Deno.build.os === "windows" ? "USERPROFILE" : "HOME"
        } is set.`,
      );
    }
    const path = (base.endsWith("/") ? base.slice(0, base.length - 1) : base) +
      "/" + LIGHTAGENT_DB_PATH;
    dbClient = new LocalSqliteClient(path);
    dbClient.exec("pragma journal_mode = WAL");
    dbClient.exec("pragma synchronous = NORMAL");
  }
  return dbClient;
}
