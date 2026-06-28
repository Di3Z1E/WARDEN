use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEvent {
    pub id: String,
    pub ts: String,
    pub actor: String,
    pub action: String,
    pub target: Option<String>,
    pub result: String,
    pub detail: Option<String>,
    pub hash_prev: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuditResult {
    Ok,
    Denied,
    Error,
}

impl AuditResult {
    pub fn as_str(&self) -> &'static str {
        match self {
            AuditResult::Ok => "ok",
            AuditResult::Denied => "denied",
            AuditResult::Error => "error",
        }
    }
}

pub fn log(
    conn: &Connection,
    actor: &str,
    action: &str,
    target: Option<&str>,
    result: AuditResult,
    detail: Option<&str>,
) -> Result<(), AppError> {
    let id = Uuid::new_v4().to_string();
    let ts = Utc::now().to_rfc3339();

    let prev_hash = last_hash(conn).unwrap_or_default();
    let hash = compute_hash(&prev_hash, &id, &ts, actor, action, result.as_str());

    conn.execute(
        "INSERT INTO audit_events(id,ts,actor,action,target,result,detail,hash_prev)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
        params![id, ts, actor, action, target, result.as_str(), detail, hash],
    )?;

    Ok(())
}

fn last_hash(conn: &Connection) -> Option<String> {
    conn.query_row(
        "SELECT hash_prev FROM audit_events ORDER BY ts DESC LIMIT 1",
        [],
        |r| r.get(0),
    )
    .ok()
    .flatten()
}

fn compute_hash(prev: &str, id: &str, ts: &str, actor: &str, action: &str, result: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(prev.as_bytes());
    hasher.update(b"|");
    hasher.update(id.as_bytes());
    hasher.update(b"|");
    hasher.update(ts.as_bytes());
    hasher.update(b"|");
    hasher.update(actor.as_bytes());
    hasher.update(b"|");
    hasher.update(action.as_bytes());
    hasher.update(b"|");
    hasher.update(result.as_bytes());
    hex::encode(hasher.finalize())
}

#[derive(Debug, Deserialize)]
pub struct AuditQuery {
    pub actor: Option<String>,
    pub action: Option<String>,
    pub since: Option<String>,
    pub until: Option<String>,
    pub limit: Option<i64>,
}

pub fn query(conn: &Connection, q: &AuditQuery) -> Result<Vec<AuditEvent>, AppError> {
    let limit = q.limit.unwrap_or(500).min(2000);

    // Use SQLite NULL-coalescing trick for optional WHERE filters.
    // If a parameter is NULL, the condition is always true (filter skipped).
    let mut stmt = conn.prepare(
        "SELECT id, ts, actor, action, target, result, detail, hash_prev
         FROM audit_events
         WHERE (?1 IS NULL OR actor = ?1)
           AND (?2 IS NULL OR action LIKE '%' || ?2 || '%')
           AND (?3 IS NULL OR ts >= ?3)
           AND (?4 IS NULL OR ts <= ?4)
         ORDER BY ts DESC
         LIMIT ?5",
    )?;

    let events = stmt
        .query_map(
            params![q.actor, q.action, q.since, q.until, limit],
            |r| {
                Ok(AuditEvent {
                    id: r.get(0)?,
                    ts: r.get(1)?,
                    actor: r.get(2)?,
                    action: r.get(3)?,
                    target: r.get(4)?,
                    result: r.get(5)?,
                    detail: r.get(6)?,
                    hash_prev: r.get(7)?,
                })
            },
        )?
        .filter_map(|r| r.ok())
        .collect();

    Ok(events)
}
