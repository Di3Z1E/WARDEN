use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;

// ── Entities ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Script {
    pub id: String,
    pub name: String,
    pub language: String,
    pub body: String,
    pub parameters_json: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptRun {
    pub id: String,
    pub script_id: Option<String>,
    pub machine_ids_json: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub triggered_by: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptRunOutput {
    pub id: String,
    pub run_id: String,
    pub machine_id: String,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub exit_code: Option<i32>,
    pub finished_at: Option<String>,
}

// ── Script CRUD ───────────────────────────────────────────────────────────────

pub fn list_scripts(conn: &Connection) -> Result<Vec<Script>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, language, body, parameters_json, created_at, updated_at
         FROM scripts ORDER BY name ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Script {
            id: r.get(0)?,
            name: r.get(1)?,
            language: r.get(2)?,
            body: r.get(3)?,
            parameters_json: r.get(4)?,
            created_at: r.get(5)?,
            updated_at: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get_script(conn: &Connection, id: &str) -> Result<Script, AppError> {
    Ok(conn.query_row(
        "SELECT id, name, language, body, parameters_json, created_at, updated_at
         FROM scripts WHERE id=?1",
        params![id],
        |r| {
            Ok(Script {
                id: r.get(0)?,
                name: r.get(1)?,
                language: r.get(2)?,
                body: r.get(3)?,
                parameters_json: r.get(4)?,
                created_at: r.get(5)?,
                updated_at: r.get(6)?,
            })
        },
    )?)
}

pub struct CreateScriptInput<'a> {
    pub name: &'a str,
    pub language: &'a str,
    pub body: &'a str,
    pub parameters_json: &'a str,
}

pub fn create_script(conn: &Connection, input: CreateScriptInput<'_>) -> Result<Script, AppError> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO scripts(id,name,language,body,parameters_json,created_at,updated_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![id, input.name, input.language, input.body, input.parameters_json, now, now],
    )?;
    get_script(conn, &id)
}

pub struct UpdateScriptInput<'a> {
    pub name: &'a str,
    pub language: &'a str,
    pub body: &'a str,
    pub parameters_json: &'a str,
}

pub fn update_script(
    conn: &Connection,
    id: &str,
    input: UpdateScriptInput<'_>,
) -> Result<Script, AppError> {
    let now = Utc::now().to_rfc3339();
    let rows = conn.execute(
        "UPDATE scripts SET name=?1, language=?2, body=?3, parameters_json=?4, updated_at=?5
         WHERE id=?6",
        params![input.name, input.language, input.body, input.parameters_json, now, id],
    )?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("Script not found: {id}")));
    }
    get_script(conn, id)
}

pub fn delete_script(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM scripts WHERE id=?1", params![id])?;
    Ok(())
}

// ── Script Run CRUD ───────────────────────────────────────────────────────────

pub fn create_run(
    conn: &Connection,
    script_id: Option<&str>,
    machine_ids_json: &str,
    triggered_by: &str,
) -> Result<ScriptRun, AppError> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO script_runs(id,script_id,machine_ids_json,started_at,triggered_by)
         VALUES(?1,?2,?3,?4,?5)",
        params![id, script_id, machine_ids_json, now, triggered_by],
    )?;
    Ok(ScriptRun {
        id,
        script_id: script_id.map(str::to_owned),
        machine_ids_json: machine_ids_json.to_owned(),
        started_at: now,
        finished_at: None,
        triggered_by: triggered_by.to_owned(),
    })
}

pub fn finish_run(conn: &Connection, run_id: &str) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE script_runs SET finished_at=?1 WHERE id=?2",
        params![now, run_id],
    )?;
    Ok(())
}

pub fn list_runs(conn: &Connection, script_id: Option<&str>) -> Result<Vec<ScriptRun>, AppError> {
    let mut stmt = if let Some(sid) = script_id {
        let mut s = conn.prepare(
            "SELECT id,script_id,machine_ids_json,started_at,finished_at,triggered_by
             FROM script_runs WHERE script_id=?1 ORDER BY started_at DESC LIMIT 50",
        )?;
        let rows = s.query_map(params![sid], row_to_run)?;
        return Ok(rows.collect::<Result<Vec<_>, _>>()?);
    } else {
        conn.prepare(
            "SELECT id,script_id,machine_ids_json,started_at,finished_at,triggered_by
             FROM script_runs ORDER BY started_at DESC LIMIT 50",
        )?
    };
    let rows = stmt.query_map([], row_to_run)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn row_to_run(r: &rusqlite::Row<'_>) -> rusqlite::Result<ScriptRun> {
    Ok(ScriptRun {
        id: r.get(0)?,
        script_id: r.get(1)?,
        machine_ids_json: r.get(2)?,
        started_at: r.get(3)?,
        finished_at: r.get(4)?,
        triggered_by: r.get(5)?,
    })
}

pub fn upsert_run_output(
    conn: &Connection,
    run_id: &str,
    machine_id: &str,
    stdout: &str,
    stderr: &str,
    exit_code: i32,
) -> Result<(), AppError> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT OR REPLACE INTO script_run_outputs
             (id,run_id,machine_id,stdout,stderr,exit_code,finished_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![id, run_id, machine_id, stdout, stderr, exit_code, now],
    )?;
    Ok(())
}

pub fn get_run_outputs(
    conn: &Connection,
    run_id: &str,
) -> Result<Vec<ScriptRunOutput>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id,run_id,machine_id,stdout,stderr,exit_code,finished_at
         FROM script_run_outputs WHERE run_id=?1",
    )?;
    let rows = stmt.query_map(params![run_id], |r| {
        Ok(ScriptRunOutput {
            id: r.get(0)?,
            run_id: r.get(1)?,
            machine_id: r.get(2)?,
            stdout: r.get(3)?,
            stderr: r.get(4)?,
            exit_code: r.get(5)?,
            finished_at: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

// ── Cert monitor CRUD ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertMonitor {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub label: Option<String>,
    pub last_checked_at: Option<String>,
    pub last_subject: Option<String>,
    pub last_not_after: Option<String>,
    pub last_days_remaining: Option<i64>,
    pub created_at: String,
}

pub fn list_cert_monitors(conn: &Connection) -> Result<Vec<CertMonitor>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id,host,port,label,last_checked_at,last_subject,last_not_after,
                last_days_remaining,created_at
         FROM cert_monitors ORDER BY host ASC",
    )?;
    let rows = stmt.query_map([], row_to_cert_monitor)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn upsert_cert_monitor(
    conn: &Connection,
    id: Option<&str>,
    host: &str,
    port: u16,
    label: Option<&str>,
) -> Result<CertMonitor, AppError> {
    let id = id.map(str::to_owned).unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO cert_monitors(id,host,port,label,created_at)
         VALUES(?1,?2,?3,?4,?5)
         ON CONFLICT(id) DO UPDATE SET host=excluded.host, port=excluded.port, label=excluded.label",
        params![id, host, port, label, now],
    )?;
    Ok(conn.query_row(
        "SELECT id,host,port,label,last_checked_at,last_subject,last_not_after,
                last_days_remaining,created_at
         FROM cert_monitors WHERE id=?1",
        params![id],
        row_to_cert_monitor,
    )?)
}

pub fn update_cert_check_result(
    conn: &Connection,
    id: &str,
    subject: &str,
    not_after: &str,
    days_remaining: i64,
) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE cert_monitors SET last_checked_at=?1, last_subject=?2,
             last_not_after=?3, last_days_remaining=?4
         WHERE id=?5",
        params![now, subject, not_after, days_remaining, id],
    )?;
    Ok(())
}

pub fn delete_cert_monitor(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM cert_monitors WHERE id=?1", params![id])?;
    Ok(())
}

fn row_to_cert_monitor(r: &rusqlite::Row<'_>) -> rusqlite::Result<CertMonitor> {
    Ok(CertMonitor {
        id: r.get(0)?,
        host: r.get(1)?,
        port: r.get::<_, u16>(2)?,
        label: r.get(3)?,
        last_checked_at: r.get(4)?,
        last_subject: r.get(5)?,
        last_not_after: r.get(6)?,
        last_days_remaining: r.get(7)?,
        created_at: r.get(8)?,
    })
}
