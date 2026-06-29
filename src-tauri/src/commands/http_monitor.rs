use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::time::Instant;
use tauri::State;
use uuid::Uuid;

use crate::{
    error::{CmdError, CmdResult},
    AppState,
};

fn require_operator(state: &AppState) -> Result<(), CmdError> {
    state
        .current_user
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| CmdError { code: "UNAUTHENTICATED", message: "Not logged in".into() })?;
    Ok(())
}

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct HttpMonitor {
    pub id: String,
    pub label: String,
    pub url: String,
    pub method: String,
    pub expected_status: i64,
    pub match_body: Option<String>,
    pub timeout_secs: i64,
    pub last_checked_at: Option<String>,
    pub last_status_code: Option<i64>,
    pub last_latency_ms: Option<i64>,
    pub last_ok: Option<bool>,
    pub last_error: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct HttpCheckResult {
    pub url: String,
    pub status_code: Option<u16>,
    pub latency_ms: u64,
    pub ok: bool,
    pub error: Option<String>,
}

fn row_to_monitor(r: &rusqlite::Row<'_>) -> rusqlite::Result<HttpMonitor> {
    Ok(HttpMonitor {
        id: r.get(0)?,
        label: r.get(1)?,
        url: r.get(2)?,
        method: r.get(3)?,
        expected_status: r.get(4)?,
        match_body: r.get(5)?,
        timeout_secs: r.get(6)?,
        last_checked_at: r.get(7)?,
        last_status_code: r.get(8)?,
        last_latency_ms: r.get(9)?,
        last_ok: r.get::<_, Option<i64>>(10)?.map(|v| v != 0),
        last_error: r.get(11)?,
        created_at: r.get(12)?,
    })
}

const SELECT: &str = "SELECT id,label,url,method,expected_status,match_body,timeout_secs,\
    last_checked_at,last_status_code,last_latency_ms,last_ok,last_error,created_at \
    FROM http_monitors";

// ── Core check logic ──────────────────────────────────────────────────────────

async fn do_check(
    url: &str,
    method: &str,
    expected_status: u16,
    match_body: Option<&str>,
    timeout_secs: u64,
) -> HttpCheckResult {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .danger_accept_invalid_certs(true)
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return HttpCheckResult {
                url: url.to_string(),
                status_code: None,
                latency_ms: 0,
                ok: false,
                error: Some(e.to_string()),
            }
        }
    };

    let t0 = Instant::now();
    let req = match method.to_uppercase().as_str() {
        "POST" => client.post(url),
        "PUT"  => client.put(url),
        "HEAD" => client.head(url),
        _      => client.get(url),
    };

    match req.send().await {
        Err(e) => HttpCheckResult {
            url: url.to_string(),
            status_code: None,
            latency_ms: t0.elapsed().as_millis() as u64,
            ok: false,
            error: Some(e.to_string()),
        },
        Ok(resp) => {
            let latency_ms = t0.elapsed().as_millis() as u64;
            let status = resp.status().as_u16();
            let status_ok = status == expected_status;

            let body_ok = if let Some(pattern) = match_body {
                resp.text().await.map(|b| b.contains(pattern)).unwrap_or(false)
            } else {
                true
            };

            let ok = status_ok && body_ok;
            let error = if !ok {
                if !status_ok {
                    Some(format!("Expected {expected_status}, got {status}"))
                } else {
                    Some("Body did not contain expected string".to_string())
                }
            } else {
                None
            };

            HttpCheckResult { url: url.to_string(), status_code: Some(status), latency_ms, ok, error }
        }
    }
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cmd_check_http_endpoint(
    state: State<'_, AppState>,
    url: String,
    method: Option<String>,
    expected_status: Option<u16>,
    match_body: Option<String>,
    timeout_secs: Option<u64>,
) -> CmdResult<HttpCheckResult> {
    require_operator(&state)?;
    Ok(do_check(
        &url,
        method.as_deref().unwrap_or("GET"),
        expected_status.unwrap_or(200),
        match_body.as_deref(),
        timeout_secs.unwrap_or(10),
    )
    .await)
}

#[tauri::command]
pub fn cmd_list_http_monitors(state: State<'_, AppState>) -> CmdResult<Vec<HttpMonitor>> {
    require_operator(&state)?;
    let conn = state.db.lock().unwrap();
    let mut stmt = conn
        .prepare(&format!("{SELECT} ORDER BY label"))
        .map_err(|e| CmdError { code: "DB_ERROR", message: e.to_string() })?;
    let rows = stmt
        .query_map([], row_to_monitor)
        .map_err(|e| CmdError { code: "DB_ERROR", message: e.to_string() })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[derive(Debug, Deserialize)]
pub struct UpsertHttpMonitorInput {
    pub id: Option<String>,
    pub label: String,
    pub url: String,
    pub method: Option<String>,
    pub expected_status: Option<i64>,
    pub match_body: Option<String>,
    pub timeout_secs: Option<i64>,
}

fn upsert_in_db(conn: &Connection, input: &UpsertHttpMonitorInput) -> Result<HttpMonitor, CmdError> {
    let now = Utc::now().to_rfc3339();
    let id = input.id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
    let method = input.method.as_deref().unwrap_or("GET").to_uppercase();
    let expected_status = input.expected_status.unwrap_or(200);
    let timeout_secs = input.timeout_secs.unwrap_or(10);

    conn.execute(
        "INSERT INTO http_monitors(id,label,url,method,expected_status,match_body,timeout_secs,created_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8)
         ON CONFLICT(id) DO UPDATE SET
           label=excluded.label, url=excluded.url, method=excluded.method,
           expected_status=excluded.expected_status, match_body=excluded.match_body,
           timeout_secs=excluded.timeout_secs",
        params![id, input.label, input.url, method, expected_status, input.match_body, timeout_secs, now],
    )
    .map_err(|e| CmdError { code: "DB_ERROR", message: e.to_string() })?;

    conn.query_row(
        &format!("{SELECT} WHERE id=?1"),
        params![id],
        row_to_monitor,
    )
    .map_err(|e| CmdError { code: "DB_ERROR", message: e.to_string() })
}

#[tauri::command]
pub fn cmd_upsert_http_monitor(
    state: State<'_, AppState>,
    input: UpsertHttpMonitorInput,
) -> CmdResult<HttpMonitor> {
    require_operator(&state)?;
    let conn = state.db.lock().unwrap();
    upsert_in_db(&conn, &input)
}

#[tauri::command]
pub fn cmd_delete_http_monitor(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    require_operator(&state)?;
    let conn = state.db.lock().unwrap();
    conn.execute("DELETE FROM http_monitors WHERE id=?1", params![id])
        .map_err(|e| CmdError { code: "DB_ERROR", message: e.to_string() })?;
    Ok(())
}

#[tauri::command]
pub async fn cmd_refresh_http_monitor(
    state: State<'_, AppState>,
    id: String,
) -> CmdResult<HttpMonitor> {
    require_operator(&state)?;

    let (url, method, expected_status, match_body, timeout_secs) = {
        let conn = state.db.lock().unwrap();
        conn.query_row(
            "SELECT url,method,expected_status,match_body,timeout_secs FROM http_monitors WHERE id=?1",
            params![id],
            |r| Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, i64>(4)?,
            )),
        )
        .map_err(|_| CmdError { code: "NOT_FOUND", message: "HTTP monitor not found".into() })?
    };

    let result = do_check(
        &url,
        &method,
        expected_status as u16,
        match_body.as_deref(),
        timeout_secs as u64,
    )
    .await;

    let checked_at = Utc::now().to_rfc3339();
    let conn = state.db.lock().unwrap();
    conn.execute(
        "UPDATE http_monitors SET last_checked_at=?1, last_status_code=?2,
         last_latency_ms=?3, last_ok=?4, last_error=?5 WHERE id=?6",
        params![
            checked_at,
            result.status_code.map(|s| s as i64),
            result.latency_ms as i64,
            result.ok as i64,
            result.error,
            id
        ],
    )
    .map_err(|e| CmdError { code: "DB_ERROR", message: e.to_string() })?;

    conn.query_row(&format!("{SELECT} WHERE id=?1"), params![id], row_to_monitor)
        .map_err(|e| CmdError { code: "DB_ERROR", message: e.to_string() })
}
