use std::path::Path;

use rusqlite::{Connection, Result, params};

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_users (
    id          TEXT PRIMARY KEY,
    username    TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role        TEXT NOT NULL CHECK(role IN ('Admin','Operator','Auditor','ReadOnly')),
    mfa_secret_ref TEXT,
    status      TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
    id          TEXT PRIMARY KEY,
    parent_id   TEXT REFERENCES folders(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    dynamic_filter TEXT,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS machines (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    machine_type TEXT NOT NULL,
    folder_id   TEXT REFERENCES folders(id) ON DELETE SET NULL,
    tags        TEXT NOT NULL DEFAULT '[]',
    notes       TEXT,
    last_connected_at TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credential_sets (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK(kind IN ('Password','SshKey')),
    vault_ref   TEXT NOT NULL UNIQUE,
    username    TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS connection_profiles (
    id          TEXT PRIMARY KEY,
    machine_id  TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    label       TEXT NOT NULL,
    protocol    TEXT NOT NULL CHECK(protocol IN ('SSH','RDP','Telnet','VNC','SFTP','HTTP')),
    host        TEXT NOT NULL,
    port        INTEGER NOT NULL,
    options     TEXT NOT NULL DEFAULT '{}',
    credential_set_id TEXT REFERENCES credential_sets(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
    id          TEXT PRIMARY KEY,
    ts          TEXT NOT NULL,
    actor       TEXT NOT NULL,
    action      TEXT NOT NULL,
    target      TEXT,
    result      TEXT NOT NULL CHECK(result IN ('ok','denied','error')),
    detail      TEXT,
    hash_prev   TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_events(ts);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_events(actor);

CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL
);

INSERT OR IGNORE INTO settings(key, value) VALUES ('schema_version', '1');
"#;

pub fn open(path: &Path) -> anyhow::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
}

/// Utility: check whether the admin user has been created (first-run detection).
pub fn is_first_run(conn: &Connection) -> Result<bool> {
    let count: i64 =
        conn.query_row("SELECT COUNT(*) FROM app_users WHERE role='Admin'", [], |r| {
            r.get(0)
        })?;
    Ok(count == 0)
}

/// Store an arbitrary setting.
pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO settings(key,value) VALUES(?1,?2)",
        params![key, value],
    )?;
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key=?1")?;
    let mut rows = stmt.query(params![key])?;
    Ok(rows.next()?.map(|r| r.get_unwrap(0)))
}
