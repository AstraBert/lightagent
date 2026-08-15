import { Database } from "@db/sqlite";
import { getDbClient } from "./db.ts";
import { applyMigrations } from "./migrations.ts";
import { AgentEvent } from "../events.ts";

export class AgentStorage {
  private db: Database;
  private initialized: boolean;

  constructor() {
    this.db = getDbClient();
    this.initialized = false;
  }

  private async initStorage() {
    if (!this.initialized) {
      await applyMigrations(this.db)
      this.initialized = true;
    }
  }

  async store(event: AgentEvent) {
    await this.initStorage();
    this.db.exec("insert into events (session_id, payload, created_at) values (:sessionId, :payload, :createdAt)", {
      sessionId: event.sessionId,
      payload: JSON.stringify(event),
      createdAt: Number(event.timestamp),
    })
  }
}
