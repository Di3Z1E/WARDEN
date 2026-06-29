use std::path::Path;

use rusqlite::{params, Connection};

// ── Migration 1 — baseline schema ─────────────────────────────────────────────

const M1: &str = r#"
CREATE TABLE IF NOT EXISTS app_users (
    id            TEXT PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK(role IN ('Admin','Operator','Auditor','ReadOnly')),
    mfa_secret_ref TEXT,
    status        TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
    id             TEXT PRIMARY KEY,
    parent_id      TEXT REFERENCES folders(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    dynamic_filter TEXT,
    created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS machines (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    machine_type      TEXT NOT NULL,
    folder_id         TEXT REFERENCES folders(id) ON DELETE SET NULL,
    tags              TEXT NOT NULL DEFAULT '[]',
    notes             TEXT,
    last_connected_at TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credential_sets (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL CHECK(kind IN ('Password','SshKey')),
    vault_ref  TEXT NOT NULL UNIQUE,
    username   TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS connection_profiles (
    id                TEXT PRIMARY KEY,
    machine_id        TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    label             TEXT NOT NULL,
    protocol          TEXT NOT NULL CHECK(protocol IN ('SSH','RDP','Telnet','VNC','SFTP','HTTP')),
    host              TEXT NOT NULL,
    port              INTEGER NOT NULL,
    options           TEXT NOT NULL DEFAULT '{}',
    credential_set_id TEXT REFERENCES credential_sets(id) ON DELETE SET NULL,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
    id        TEXT PRIMARY KEY,
    ts        TEXT NOT NULL,
    actor     TEXT NOT NULL,
    action    TEXT NOT NULL,
    target    TEXT,
    result    TEXT NOT NULL CHECK(result IN ('ok','denied','error')),
    detail    TEXT,
    hash_prev TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_ts    ON audit_events(ts);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_events(actor);
"#;

// ── Migration 2 — Script Library, Cert Monitor, Uptime Monitor ────────────────

const M2: &str = r#"
CREATE TABLE IF NOT EXISTS scripts (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    language        TEXT NOT NULL CHECK(language IN ('powershell','bash','python')),
    body            TEXT NOT NULL,
    parameters_json TEXT NOT NULL DEFAULT '[]',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS script_runs (
    id               TEXT PRIMARY KEY,
    script_id        TEXT REFERENCES scripts(id) ON DELETE SET NULL,
    machine_ids_json TEXT NOT NULL,
    started_at       TEXT NOT NULL,
    finished_at      TEXT,
    triggered_by     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS script_run_outputs (
    id          TEXT PRIMARY KEY,
    run_id      TEXT NOT NULL REFERENCES script_runs(id) ON DELETE CASCADE,
    machine_id  TEXT NOT NULL,
    stdout      TEXT,
    stderr      TEXT,
    exit_code   INTEGER,
    finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_script_run_outputs_run ON script_run_outputs(run_id);

CREATE TABLE IF NOT EXISTS cert_monitors (
    id                  TEXT PRIMARY KEY,
    host                TEXT NOT NULL,
    port                INTEGER NOT NULL DEFAULT 443,
    label               TEXT,
    last_checked_at     TEXT,
    last_subject        TEXT,
    last_not_after      TEXT,
    last_days_remaining INTEGER,
    created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS monitor_rules (
    id                            TEXT PRIMARY KEY,
    machine_id                    TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    check_interval_secs           INTEGER NOT NULL DEFAULT 60,
    consecutive_failures_threshold INTEGER NOT NULL DEFAULT 3,
    enabled                       INTEGER NOT NULL DEFAULT 1,
    notify_desktop                INTEGER NOT NULL DEFAULT 1,
    notify_webhook_url            TEXT,
    created_at                    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS monitor_events (
    id         TEXT PRIMARY KEY,
    machine_id TEXT NOT NULL,
    ts         TEXT NOT NULL,
    state      TEXT NOT NULL CHECK(state IN ('up','down')),
    latency_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_monitor_events_machine ON monitor_events(machine_id, ts);
"#;

// ── Migration 3 — MFA + credential expiry ────────────────────────────────────

const M3: &str = r#"
ALTER TABLE app_users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE credential_sets ADD COLUMN expires_at TEXT;
"#;

// ── Migration table ───────────────────────────────────────────────────────────

// ── Migration 4 — HTTP endpoint monitors ──────────────────────────────────────

const M4: &str = r#"
CREATE TABLE IF NOT EXISTS http_monitors (
    id                TEXT PRIMARY KEY,
    label             TEXT NOT NULL,
    url               TEXT NOT NULL,
    method            TEXT NOT NULL DEFAULT 'GET',
    expected_status   INTEGER NOT NULL DEFAULT 200,
    match_body        TEXT,
    timeout_secs      INTEGER NOT NULL DEFAULT 10,
    last_checked_at   TEXT,
    last_status_code  INTEGER,
    last_latency_ms   INTEGER,
    last_ok           INTEGER,
    last_error        TEXT,
    created_at        TEXT NOT NULL
);
"#;

const MIGRATIONS: &[(i64, &str)] = &[(1, M1), (2, M2), (3, M3), (4, M4)];

// ── Public API ────────────────────────────────────────────────────────────────

pub fn open(path: &Path) -> anyhow::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
    // Bootstrap settings before querying the version
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);\
         INSERT OR IGNORE INTO settings(key, value) VALUES ('schema_version', '0');",
    )?;
    run_migrations(&conn)?;
    Ok(conn)
}

fn run_migrations(conn: &Connection) -> anyhow::Result<()> {
    let current: i64 = conn
        .query_row(
            "SELECT CAST(value AS INTEGER) FROM settings WHERE key='schema_version'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    for &(v, sql) in MIGRATIONS {
        if v > current {
            conn.execute_batch(sql)?;
            conn.execute(
                "INSERT OR REPLACE INTO settings(key,value) VALUES('schema_version',?1)",
                params![v.to_string()],
            )?;
        }
    }
    Ok(())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

pub fn is_first_run(conn: &Connection) -> rusqlite::Result<bool> {
    let count: i64 =
        conn.query_row("SELECT COUNT(*) FROM app_users WHERE role='Admin'", [], |r| r.get(0))?;
    Ok(count == 0)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO settings(key,value) VALUES(?1,?2)",
        params![key, value],
    )?;
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key=?1")?;
    let mut rows = stmt.query(params![key])?;
    Ok(rows.next()?.map(|r| r.get_unwrap(0)))
}
