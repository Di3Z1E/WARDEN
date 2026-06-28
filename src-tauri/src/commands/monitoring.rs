use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};

use crate::{
    error::{CmdError, CmdResult},
    inventory,
    monitoring::{self, LivenessResult, MonitorEvent, MonitorRule},
    AppState,
};

fn require_operator(state: &AppState) -> Result<crate::iam::AuthenticatedUser, CmdError> {
    state
        .current_user
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| CmdError { code: "UNAUTHENTICATED", message: "Not logged in".into() })
        .and_then(|u| {
            if u.role.can_connect() {
                Ok(u)
            } else {
                Err(CmdError { code: "FORBIDDEN", message: "Operator or Admin role required".into() })
            }
        })
}

// ── Liveness check ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cmd_check_machine_liveness(
    state: State<'_, AppState>,
    app: AppHandle,
    machine_id: String,
) -> CmdResult<LivenessResult> {
    require_operator(&state)?;

    let (machine_name, host, port) = {
        let conn = state.db.lock().unwrap();
        let machine = inventory::get_machine(&conn, &machine_id).map_err(CmdError::from)?;
        let target = monitoring::resolve_check_target(&conn, &machine_id).ok_or_else(|| CmdError {
            code: "NO_PROFILE",
            message: "Machine has no connection profiles to probe".into(),
        })?;
        (machine.name, target.0, target.1)
    };

    let (is_up, latency_ms) = monitoring::check_tcp(&host, port, 5).await;
    let checked_at = chrono::Utc::now().to_rfc3339();

    let prev_state = {
        let conn = state.db.lock().unwrap();
        monitoring::get_latest_state(&conn, &machine_id)
    };

    {
        let conn = state.db.lock().unwrap();
        monitoring::record_event(&conn, &machine_id, is_up, latency_ms).map_err(CmdError::from)?;
    }

    let new_state = if is_up { "up" } else { "down" };
    if prev_state.as_deref() != Some(new_state) {
        // Emit frontend event for toast
        app.emit(
            "monitoring:status_change",
            serde_json::json!({
                "machine_id": machine_id,
                "machine_name": machine_name,
                "is_up": is_up,
            }),
        )
        .ok();

        // Desktop notification if rule enables it
        let notify = {
            let conn = state.db.lock().unwrap();
            monitoring::get_rule(&conn, &machine_id)
                .ok()
                .flatten()
                .map(|r| r.notify_desktop)
                .unwrap_or(false)
        };

        if notify {
            let body = if is_up {
                format!("{machine_name} is back online")
            } else {
                format!("{machine_name} is offline")
            };
            use tauri_plugin_notification::NotificationExt;
            app.notification().builder().title("WARDEN Alert").body(&body).show().ok();
        }
    }

    Ok(LivenessResult { machine_id, is_up, latency_ms, checked_at, host, port })
}

#[tauri::command]
pub fn cmd_get_liveness_history(
    state: State<'_, AppState>,
    machine_id: String,
    limit: Option<i64>,
) -> CmdResult<Vec<MonitorEvent>> {
    require_operator(&state)?;
    let conn = state.db.lock().unwrap();
    monitoring::get_recent_events(&conn, &machine_id, limit.unwrap_or(20))
        .map_err(CmdError::from)
}

#[tauri::command]
pub fn cmd_get_all_liveness_statuses(state: State<'_, AppState>) -> CmdResult<Vec<MonitorEvent>> {
    require_operator(&state)?;
    let conn = state.db.lock().unwrap();
    monitoring::get_all_latest_statuses(&conn).map_err(CmdError::from)
}

// ── Monitor rules ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct UpsertRuleInput {
    pub machine_id: String,
    pub enabled: bool,
    pub notify_desktop: bool,
    pub interval_secs: Option<i64>,
}

#[tauri::command]
pub fn cmd_upsert_monitor_rule(
    state: State<'_, AppState>,
    input: UpsertRuleInput,
) -> CmdResult<MonitorRule> {
    require_operator(&state)?;
    let conn = state.db.lock().unwrap();
    monitoring::upsert_rule(
        &conn,
        &input.machine_id,
        input.enabled,
        input.notify_desktop,
        input.interval_secs.unwrap_or(60),
    )
    .map_err(CmdError::from)
}

#[tauri::command]
pub fn cmd_get_monitor_rule(
    state: State<'_, AppState>,
    machine_id: String,
) -> CmdResult<Option<MonitorRule>> {
    require_operator(&state)?;
    let conn = state.db.lock().unwrap();
    monitoring::get_rule(&conn, &machine_id).map_err(CmdError::from)
}

// ── Ansible export ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn cmd_export_ansible_inventory(state: State<'_, AppState>) -> CmdResult<String> {
    require_operator(&state)?;
    let conn = state.db.lock().unwrap();
    monitoring::export_ansible_inventory(&conn).map_err(CmdError::from)
}
