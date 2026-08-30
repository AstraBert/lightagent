import { SqliteClient, SqlBindParameters, SqlStatement } from "@cle-does-things/lightagent-core";

export class DOSqlStatement<T extends object> implements SqlStatement<T> {
  private base: D1PreparedStatement

  constructor(base: D1PreparedStatement) {
    this.base = base
  }

  async all(...parameters: SqlBindParameters): Promise<T[]> {
    const result = await this.base.bind(parameters).all<T>()
    if (result.success) {
      return result.results
    }
    throw new Error(`An error occurred while executing the statement: ${result.error ?? 'unknown error'}`)
  }

  async get(...parameters: SqlBindParameters): Promise<T | undefined> {
    const result = await this.base.bind(parameters).first<T>()
    if (!result) {
      return undefined
    }
    return result
  }
}

export class DOSqliteClient implements SqliteClient {
  private base: D1Database

  constructor(base: D1Database) {
    this.base = base
  }

  async exec(sql: string, ...parameters: SqlBindParameters): Promise<void> {
    await this.base.prepare(sql).bind(parameters).run()
  }

  // deno-lint-ignore require-await
  async prepare<T extends object>(sql: string): Promise<SqlStatement<T>> {
    return new DOSqlStatement(this.base.prepare(sql))
  }
}
