use tauri::State;

use crate::{
    audit::{self, AuditEvent, AuditQuery},
    error::{CmdError, CmdResult},
    AppState,
};

#[tauri::command]
pub fn cmd_query_audit(
    state: State<'_, AppState>,
    query: AuditQuery,
) -> CmdResult<Vec<AuditEvent>> {
    let user = state
        .current_user
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| CmdError {
            code: "UNAUTHENTICATED",
            message: "Not logged in".into(),
        })?;

    // Auditors and Admins can query; others are denied
    match user.role {
        crate::iam::Role::Admin | crate::iam::Role::Auditor => {}
        _ => {
            return Err(CmdError {
                code: "FORBIDDEN",
                message: "Auditor or Admin role required".into(),
            })
        }
    }

    let conn = state.db.lock().unwrap();
    audit::query(&conn, &query).map_err(CmdError::from)
}
