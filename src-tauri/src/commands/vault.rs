use serde::Deserialize;
use tauri::State;
use zeroize::Zeroizing;

use crate::{
    audit::{self, AuditResult},
    error::{CmdError, CmdResult},
    inventory::{self, CredentialSetMeta},
    vault::{self, VaultSecret},
    AppState,
};

fn require_admin(state: &AppState) -> Result<crate::iam::AuthenticatedUser, CmdError> {
    state
        .current_user
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| CmdError {
            code: "UNAUTHENTICATED",
            message: "Not logged in".into(),
        })
        .and_then(|u| {
            if u.role.is_admin() {
                Ok(u)
            } else {
                Err(CmdError {
                    code: "FORBIDDEN",
                    message: "Admin role required".into(),
                })
            }
        })
}

#[tauri::command]
pub fn cmd_list_credential_sets(
    state: State<'_, AppState>,
) -> CmdResult<Vec<CredentialSetMeta>> {
    state
        .current_user
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| CmdError {
            code: "UNAUTHENTICATED",
            message: "Not logged in".into(),
        })?;

    let conn = state.db.lock().unwrap();
    inventory::list_credential_sets(&conn).map_err(CmdError::from)
}

#[derive(Debug, Deserialize)]
pub struct CreatePasswordCredInput {
    pub name: String,
    pub username: String,
    pub password: String,
}

#[tauri::command]
pub fn cmd_create_credential_set(
    state: State<'_, AppState>,
    input: CreatePasswordCredInput,
) -> CmdResult<CredentialSetMeta> {
    let actor = require_admin(&state)?.username;

    let vault_ref = vault::new_ref();
    let secret = VaultSecret::Password {
        username: input.username.clone(),
        password: Zeroizing::new(input.password),
    };

    vault::store(&vault_ref, &secret).map_err(CmdError::from)?;

    let conn = state.db.lock().unwrap();
    let meta = inventory::create_credential_set(
        &conn,
        &input.name,
        "Password",
        &vault_ref,
        Some(&input.username),
    )
    .map_err(|e| {
        // Roll back vault entry if DB insert fails
        vault::delete(&vault_ref).ok();
        CmdError::from(e)
    })?;

    audit::log(
        &conn,
        &actor,
        "VLT_CREATE_CRED",
        Some(&meta.id),
        AuditResult::Ok,
        Some(&input.name),
    )
    .ok();

    Ok(meta)
}

#[tauri::command]
pub fn cmd_delete_credential_set(
    state: State<'_, AppState>,
    cred_id: String,
) -> CmdResult<()> {
    let actor = require_admin(&state)?.username;
    let conn = state.db.lock().unwrap();

    let vault_ref = inventory::delete_credential_set(&conn, &cred_id).map_err(CmdError::from)?;
    vault::delete(&vault_ref).map_err(CmdError::from)?;

    audit::log(
        &conn,
        &actor,
        "VLT_DELETE_CRED",
        Some(&cred_id),
        AuditResult::Ok,
        None,
    )
    .ok();

    Ok(())
}
