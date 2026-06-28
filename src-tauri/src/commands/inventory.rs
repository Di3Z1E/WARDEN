use tauri::State;

use crate::{
    audit::{self, AuditResult},
    error::{CmdError, CmdResult},
    inventory::{
        self, ConnectionProfile, CreateMachineInput, CreateProfileInput, Folder, Machine,
        UpdateMachineInput,
    },
    AppState,
};

fn require_auth(state: &AppState) -> Result<crate::iam::AuthenticatedUser, CmdError> {
    state
        .current_user
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| CmdError {
            code: "UNAUTHENTICATED",
            message: "Not logged in".into(),
        })
}

fn require_admin(state: &AppState) -> Result<crate::iam::AuthenticatedUser, CmdError> {
    let u = require_auth(state)?;
    if !u.role.is_admin() {
        return Err(CmdError {
            code: "FORBIDDEN",
            message: "Admin role required".into(),
        });
    }
    Ok(u)
}

// ── Folders ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn cmd_list_folders(state: State<'_, AppState>) -> CmdResult<Vec<Folder>> {
    require_auth(&state)?;
    let conn = state.db.lock().unwrap();
    inventory::list_folders(&conn).map_err(CmdError::from)
}

#[derive(serde::Deserialize)]
pub struct CreateFolderInput {
    pub name: String,
    pub parent_id: Option<String>,
}

#[tauri::command]
pub fn cmd_create_folder(
    state: State<'_, AppState>,
    input: CreateFolderInput,
) -> CmdResult<Folder> {
    let actor = require_admin(&state)?.username;
    let conn = state.db.lock().unwrap();
    let folder =
        inventory::create_folder(&conn, &input.name, input.parent_id.as_deref())
            .map_err(CmdError::from)?;

    audit::log(
        &conn,
        &actor,
        "INV_CREATE_FOLDER",
        Some(&folder.id),
        AuditResult::Ok,
        Some(&input.name),
    )
    .ok();

    Ok(folder)
}

#[tauri::command]
pub fn cmd_delete_folder(
    state: State<'_, AppState>,
    folder_id: String,
) -> CmdResult<()> {
    let actor = require_admin(&state)?.username;
    let conn = state.db.lock().unwrap();
    inventory::delete_folder(&conn, &folder_id).map_err(CmdError::from)?;
    audit::log(&conn, &actor, "INV_DELETE_FOLDER", Some(&folder_id), AuditResult::Ok, None).ok();
    Ok(())
}

// ── Machines ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn cmd_list_machines(state: State<'_, AppState>) -> CmdResult<Vec<Machine>> {
    require_auth(&state)?;
    let conn = state.db.lock().unwrap();
    inventory::list_machines(&conn).map_err(CmdError::from)
}

#[tauri::command]
pub fn cmd_get_machine(
    state: State<'_, AppState>,
    machine_id: String,
) -> CmdResult<Machine> {
    require_auth(&state)?;
    let conn = state.db.lock().unwrap();
    inventory::get_machine(&conn, &machine_id).map_err(CmdError::from)
}

#[tauri::command]
pub fn cmd_create_machine(
    state: State<'_, AppState>,
    input: CreateMachineInput,
) -> CmdResult<Machine> {
    let actor = require_admin(&state)?.username;
    let conn = state.db.lock().unwrap();
    let machine = inventory::create_machine(&conn, &input).map_err(CmdError::from)?;

    audit::log(
        &conn,
        &actor,
        "INV_CREATE_MACHINE",
        Some(&machine.id),
        AuditResult::Ok,
        Some(&machine.name),
    )
    .ok();

    Ok(machine)
}

#[tauri::command]
pub fn cmd_update_machine(
    state: State<'_, AppState>,
    machine_id: String,
    input: UpdateMachineInput,
) -> CmdResult<Machine> {
    let actor = require_admin(&state)?.username;
    let conn = state.db.lock().unwrap();
    let machine = inventory::update_machine(&conn, &machine_id, &input).map_err(CmdError::from)?;
    audit::log(&conn, &actor, "INV_UPDATE_MACHINE", Some(&machine_id), AuditResult::Ok, None).ok();
    Ok(machine)
}

#[tauri::command]
pub fn cmd_delete_machine(
    state: State<'_, AppState>,
    machine_id: String,
) -> CmdResult<()> {
    let actor = require_admin(&state)?.username;
    let conn = state.db.lock().unwrap();
    inventory::delete_machine(&conn, &machine_id).map_err(CmdError::from)?;
    audit::log(&conn, &actor, "INV_DELETE_MACHINE", Some(&machine_id), AuditResult::Ok, None).ok();
    Ok(())
}

// ── Connection profiles ───────────────────────────────────────────────────────

#[tauri::command]
pub fn cmd_list_profiles(
    state: State<'_, AppState>,
    machine_id: String,
) -> CmdResult<Vec<ConnectionProfile>> {
    require_auth(&state)?;
    let conn = state.db.lock().unwrap();
    inventory::list_profiles(&conn, &machine_id).map_err(CmdError::from)
}

#[tauri::command]
pub fn cmd_create_profile(
    state: State<'_, AppState>,
    input: CreateProfileInput,
) -> CmdResult<ConnectionProfile> {
    let actor = require_admin(&state)?.username;
    let conn = state.db.lock().unwrap();
    let profile = inventory::create_profile(&conn, &input).map_err(CmdError::from)?;
    audit::log(
        &conn,
        &actor,
        "INV_CREATE_PROFILE",
        Some(&profile.id),
        AuditResult::Ok,
        Some(&profile.label),
    )
    .ok();
    Ok(profile)
}

#[tauri::command]
pub fn cmd_update_profile(
    state: State<'_, AppState>,
    profile_id: String,
    input: CreateProfileInput,
) -> CmdResult<ConnectionProfile> {
    let actor = require_admin(&state)?.username;
    let conn = state.db.lock().unwrap();
    let profile = inventory::update_profile(&conn, &profile_id, &input).map_err(CmdError::from)?;
    audit::log(&conn, &actor, "INV_UPDATE_PROFILE", Some(&profile_id), AuditResult::Ok, None).ok();
    Ok(profile)
}

#[tauri::command]
pub fn cmd_delete_profile(
    state: State<'_, AppState>,
    profile_id: String,
) -> CmdResult<()> {
    let actor = require_admin(&state)?.username;
    let conn = state.db.lock().unwrap();
    inventory::delete_profile(&conn, &profile_id).map_err(CmdError::from)?;
    audit::log(&conn, &actor, "INV_DELETE_PROFILE", Some(&profile_id), AuditResult::Ok, None).ok();
    Ok(())
}
