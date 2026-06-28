use serde::Deserialize;
use tauri::State;

use crate::{
    audit::{self, AuditResult},
    error::{CmdError, CmdResult},
    power,
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct WolInput {
    pub mac: String,
    pub broadcast: Option<String>,
    pub machine_id: Option<String>,
}

#[tauri::command]
pub fn cmd_wake_on_lan(
    state: State<'_, AppState>,
    input: WolInput,
) -> CmdResult<()> {
    let actor = state
        .current_user
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| CmdError {
            code: "UNAUTHENTICATED",
            message: "Not logged in".into(),
        })?;

    if !actor.role.can_connect() {
        return Err(CmdError {
            code: "FORBIDDEN",
            message: "Operator or Admin role required".into(),
        });
    }

    power::wake_on_lan(&input.mac, input.broadcast.as_deref()).map_err(CmdError::from)?;

    let conn = state.db.lock().unwrap();
    audit::log(
        &conn,
        &actor.username,
        "PWR_WAKE_ON_LAN",
        input.machine_id.as_deref(),
        AuditResult::Ok,
        Some(&input.mac),
    )
    .ok();

    Ok(())
}
