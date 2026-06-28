use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    audit::{self, AuditResult},
    db,
    error::{CmdError, CmdResult},
    iam::{self, AppUser, AuthenticatedUser, Role},
    AppState,
};

fn require_auth(state: &AppState) -> Result<AuthenticatedUser, CmdError> {
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

fn require_admin(state: &AppState) -> Result<AuthenticatedUser, CmdError> {
    let user = require_auth(state)?;
    if !user.role.is_admin() {
        return Err(CmdError {
            code: "FORBIDDEN",
            message: "Admin role required".into(),
        });
    }
    Ok(user)
}

// ── First-run ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn cmd_first_run_check(state: State<'_, AppState>) -> CmdResult<bool> {
    let conn = state.db.lock().unwrap();
    db::is_first_run(&conn).map_err(|e| CmdError {
        code: "DB_ERROR",
        message: e.to_string(),
    })
}

#[derive(Debug, Deserialize)]
pub struct SetupAdminInput {
    pub username: String,
    pub password: String,
}

#[tauri::command]
pub fn cmd_setup_admin(
    state: State<'_, AppState>,
    input: SetupAdminInput,
) -> CmdResult<AppUser> {
    let conn = state.db.lock().unwrap();
    let is_first = db::is_first_run(&conn).map_err(|e| CmdError {
        code: "DB_ERROR",
        message: e.to_string(),
    })?;

    if !is_first {
        return Err(CmdError {
            code: "ALREADY_SETUP",
            message: "Admin already configured".into(),
        });
    }

    let user = iam::create_user(&conn, &input.username, &input.password, Role::Admin)
        .map_err(CmdError::from)?;

    audit::log(&conn, &input.username, "IAM_SETUP_ADMIN", None, AuditResult::Ok, None).ok();

    Ok(user)
}

// ── Auth ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct LoginInput {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub user: AppUserDto,
}

#[derive(Debug, Serialize, Clone)]
pub struct AppUserDto {
    pub id: String,
    pub username: String,
    pub role: String,
}

impl From<&AuthenticatedUser> for AppUserDto {
    fn from(u: &AuthenticatedUser) -> Self {
        AppUserDto {
            id: u.id.clone(),
            username: u.username.clone(),
            role: u.role.as_str().to_string(),
        }
    }
}

#[tauri::command]
pub fn cmd_login(
    state: State<'_, AppState>,
    input: LoginInput,
) -> CmdResult<LoginResponse> {
    let conn = state.db.lock().unwrap();

    match iam::authenticate(&conn, &input.username, &input.password) {
        Ok(auth_user) => {
            audit::log(&conn, &input.username, "AUTH_LOGIN", None, AuditResult::Ok, None).ok();
            let dto = AppUserDto::from(&auth_user);
            *state.current_user.lock().unwrap() = Some(auth_user);
            Ok(LoginResponse { user: dto })
        }
        Err(e) => {
            audit::log(
                &conn,
                &input.username,
                "AUTH_LOGIN",
                None,
                AuditResult::Denied,
                Some(&e.to_string()),
            )
            .ok();
            Err(CmdError::from(e))
        }
    }
}

#[tauri::command]
pub fn cmd_logout(state: State<'_, AppState>) -> CmdResult<()> {
    let actor = {
        let guard = state.current_user.lock().unwrap();
        guard.as_ref().map(|u| u.username.clone()).unwrap_or_default()
    };
    *state.current_user.lock().unwrap() = None;

    let conn = state.db.lock().unwrap();
    audit::log(&conn, &actor, "AUTH_LOGOUT", None, AuditResult::Ok, None).ok();

    Ok(())
}

#[tauri::command]
pub fn cmd_get_current_user(state: State<'_, AppState>) -> CmdResult<Option<AppUserDto>> {
    let guard = state.current_user.lock().unwrap();
    Ok(guard.as_ref().map(AppUserDto::from))
}

// ── User management (Admin only) ─────────────────────────────────────────────

#[tauri::command]
pub fn cmd_list_users(state: State<'_, AppState>) -> CmdResult<Vec<AppUser>> {
    require_admin(&state)?;
    let conn = state.db.lock().unwrap();
    iam::list_users(&conn).map_err(CmdError::from)
}

#[derive(Debug, Deserialize)]
pub struct CreateUserInput {
    pub username: String,
    pub password: String,
    pub role: String,
}

#[tauri::command]
pub fn cmd_create_user(
    state: State<'_, AppState>,
    input: CreateUserInput,
) -> CmdResult<AppUser> {
    let actor = require_admin(&state)?.username;
    let role = Role::from_str(&input.role).ok_or_else(|| CmdError {
        code: "INVALID_ROLE",
        message: format!("Unknown role: {}", input.role),
    })?;

    let conn = state.db.lock().unwrap();
    let user = iam::create_user(&conn, &input.username, &input.password, role)
        .map_err(CmdError::from)?;

    audit::log(
        &conn,
        &actor,
        "IAM_CREATE_USER",
        Some(&user.id),
        AuditResult::Ok,
        Some(&input.username),
    )
    .ok();

    Ok(user)
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserInput {
    pub id: String,
    pub role: Option<String>,
    pub status: Option<String>,
    pub new_password: Option<String>,
}

#[tauri::command]
pub fn cmd_update_user(
    state: State<'_, AppState>,
    input: UpdateUserInput,
) -> CmdResult<()> {
    let actor = require_admin(&state)?.username;
    let conn = state.db.lock().unwrap();

    if let Some(ref role_str) = input.role {
        let role = Role::from_str(role_str).ok_or_else(|| CmdError {
            code: "INVALID_ROLE",
            message: format!("Unknown role: {}", role_str),
        })?;
        iam::update_user_role(&conn, &input.id, role).map_err(CmdError::from)?;
    }

    if let Some(ref status) = input.status {
        iam::set_user_status(&conn, &input.id, status).map_err(CmdError::from)?;
    }

    if let Some(ref pw) = input.new_password {
        iam::reset_password(&conn, &input.id, pw).map_err(CmdError::from)?;
    }

    audit::log(
        &conn,
        &actor,
        "IAM_UPDATE_USER",
        Some(&input.id),
        AuditResult::Ok,
        None,
    )
    .ok();

    Ok(())
}

// ── Own account editing ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct UpdateOwnProfileInput {
    pub current_password: String,
    pub new_username: Option<String>,
    pub new_password: Option<String>,
}

#[tauri::command]
pub fn cmd_update_own_profile(
    state: State<'_, AppState>,
    input: UpdateOwnProfileInput,
) -> CmdResult<AppUserDto> {
    let actor = require_auth(&state)?;

    let updated = {
        let conn = state.db.lock().unwrap();

        // Verify current password
        iam::authenticate(&conn, &actor.username, &input.current_password)
            .map_err(|_| CmdError {
                code: "AUTH_FAILED",
                message: "Current password is incorrect".into(),
            })?;

        if let Some(ref new_username) = input.new_username {
            let trimmed = new_username.trim();
            if !trimmed.is_empty() {
                iam::update_username(&conn, &actor.id, trimmed).map_err(CmdError::from)?;
            }
        }

        if let Some(ref new_pw) = input.new_password {
            if !new_pw.is_empty() {
                iam::reset_password(&conn, &actor.id, new_pw).map_err(CmdError::from)?;
            }
        }

        audit::log(
            &conn,
            &actor.username,
            "IAM_UPDATE_OWN_PROFILE",
            Some(&actor.id),
            AuditResult::Ok,
            None,
        )
        .ok();

        let u = iam::get_user_by_id(&conn, &actor.id).map_err(CmdError::from)?;
        AppUserDto {
            id: u.id,
            username: u.username,
            role: u.role.as_str().to_string(),
        }
    }; // conn lock released

    // Sync in-memory session username
    if let Some(ref mut session_user) = *state.current_user.lock().unwrap() {
        session_user.username = updated.username.clone();
    }

    Ok(updated)
}

#[tauri::command]
pub fn cmd_delete_user(
    state: State<'_, AppState>,
    user_id: String,
) -> CmdResult<()> {
    let actor = require_admin(&state)?;

    if actor.id == user_id {
        return Err(CmdError {
            code: "INVALID_OPERATION",
            message: "Cannot delete your own account".into(),
        });
    }

    let conn = state.db.lock().unwrap();
    iam::delete_user(&conn, &user_id).map_err(CmdError::from)?;

    audit::log(
        &conn,
        &actor.username,
        "IAM_DELETE_USER",
        Some(&user_id),
        AuditResult::Ok,
        None,
    )
    .ok();

    Ok(())
}
