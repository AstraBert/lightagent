export const version = 1
export const sql = `CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT    NOT NULL,
    payload     TEXT    NOT NULL,
    created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS _migrations (
    version     INTEGER NOT NULL,
    applied_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);`
