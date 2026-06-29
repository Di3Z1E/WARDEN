use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::sync::Mutex;

use crate::{
    error::{CmdError, CmdResult},
    inventory,
    protocols::sftp::{self, DirEntryDto, SftpConnectParams},
    vault::{self, VaultSecret},
    AppState,
};

// ── SFTP session state ────────────────────────────────────────────────────────
//
// Stored separately from terminal sessions because SFTP uses an Arc<Mutex<>>
// for async access, not an mpsc channel. The std::sync::Mutex in AppState is
// released before any await point — only the inner tokio::sync::Mutex is held
// across awaits.

fn require_connect(state: &AppState) -> Result<crate::iam::AuthenticatedUser, CmdError> {
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
            if u.role.can_connect() {
                Ok(u)
            } else {
                Err(CmdError {
                    code: "FORBIDDEN",
                    message: "Operator or Admin role required to open sessions".into(),
                })
            }
        })
}

// ── Connect SFTP ──────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ConnectSftpInput {
    pub profile_id: String,
}

#[derive(Debug, Serialize)]
pub struct SftpSessionDto {
    pub id: String,
    pub profile_id: String,
    pub host: String,
}

#[tauri::command]
pub async fn cmd_connect_sftp(
    state: State<'_, AppState>,
    input: ConnectSftpInput,
) -> CmdResult<SftpSessionDto> {
    let _actor = require_connect(&state)?;

    let (profile, machine_id, username, auth) = {
        let conn = state.db.lock().unwrap();
        let machines = inventory::list_machines(&conn).map_err(CmdError::from)?;
        let mut found = None;
        for m in &machines {
            let profiles = inventory::list_profiles(&conn, &m.id).map_err(CmdError::from)?;
            if let Some(p) = profiles.into_iter().find(|p| p.id == input.profile_id) {
                found = Some((p, m.id.clone()));
                break;
            }
        }
        let (profile, machine_id) = found.ok_or_else(|| CmdError {
            code: "NOT_FOUND",
            message: format!("Profile not found: {}", input.profile_id),
        })?;

        let cred_id = profile.credential_set_id.as_ref().ok_or_else(|| CmdError {
            code: "NO_CREDENTIAL",
            message: "No credential assigned to this profile".into(),
        })?;
        let cred_sets = inventory::list_credential_sets(&conn).map_err(CmdError::from)?;
        let cred_meta = cred_sets
            .into_iter()
            .find(|s| &s.id == cred_id)
            .ok_or_else(|| CmdError {
                code: "CRED_NOT_FOUND",
                message: "Credential set not found".into(),
            })?;
        let secret = vault::retrieve(&cred_meta.vault_ref).map_err(CmdError::from)?;

        let (username, auth) = match secret {
            VaultSecret::Password { username, password } => {
                (username, crate::protocols::ssh::SshAuth::Password(password))
            }
            VaultSecret::SshKey { username, private_key, passphrase } => (
                username,
                crate::protocols::ssh::SshAuth::PublicKey {
                    private_key_pem: private_key,
                    passphrase,
                },
            ),
            VaultSecret::Totp { .. } => return Err(CmdError {
                code: "INVALID_CREDENTIAL",
                message: "TOTP secrets cannot be used as SFTP credentials".into(),
            }),
        };

        (profile, machine_id, username, auth)
    };

    let session_id = uuid::Uuid::new_v4().to_string();
    let host = profile.host.clone();

    let params = SftpConnectParams {
        host: profile.host.clone(),
        port: profile.port,
        username,
        auth,
    };

    let entry = sftp::connect(params)
        .await
        .map_err(|e| CmdError { code: "SFTP_CONNECT_ERROR", message: e.to_string() })?;

    // Touch machine timestamp
    {
        let conn = state.db.lock().unwrap();
        inventory::touch_machine(&conn, &machine_id).ok();
    }

    state
        .sftp_sessions
        .lock()
        .unwrap()
        .insert(session_id.clone(), entry);

    Ok(SftpSessionDto { id: session_id, profile_id: input.profile_id, host })
}

// ── List directory ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct SftpPathInput {
    pub session_id: String,
    pub path: String,
}

#[tauri::command]
pub async fn cmd_sftp_list_dir(
    state: State<'_, AppState>,
    input: SftpPathInput,
) -> CmdResult<Vec<DirEntryDto>> {
    require_connect(&state)?;

    let sftp_arc = get_sftp(&state, &input.session_id)?;
    let sftp = sftp_arc.lock().await;

    let entries = sftp
        .read_dir(&input.path)
        .await
        .map_err(|e| CmdError { code: "SFTP_ERROR", message: e.to_string() })?;

    let mut dtos: Vec<DirEntryDto> = entries
        .into_iter()
        .filter_map(|e| {
            let filename = e.file_name();
            // Skip navigation entries
            if filename == "." || filename == ".." {
                return None;
            }
            let meta = e.metadata();
            let perms = meta.permissions;
            Some(DirEntryDto {
                name: filename,
                is_dir: perms.map(sftp::perms_is_dir).unwrap_or(false),
                is_link: perms.map(sftp::perms_is_link).unwrap_or(false),
                size: meta.size,
                modified: meta.mtime.map(|t| t as u64),
                permissions: perms,
            })
        })
        .collect();

    // Directories first, then files, both alphabetical
    dtos.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(dtos)
}

// ── Read file ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct FileContents {
    pub data_base64: String,
    pub size: u64,
}

#[tauri::command]
pub async fn cmd_sftp_read_file(
    state: State<'_, AppState>,
    input: SftpPathInput,
) -> CmdResult<FileContents> {
    require_connect(&state)?;

    let sftp_arc = get_sftp(&state, &input.session_id)?;
    let sftp = sftp_arc.lock().await;

    let data = sftp
        .read(&input.path)
        .await
        .map_err(|e| CmdError { code: "SFTP_ERROR", message: e.to_string() })?;

    let size = data.len() as u64;
    Ok(FileContents {
        data_base64: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &data),
        size,
    })
}

// ── Write file ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct SftpWriteInput {
    pub session_id: String,
    pub path: String,
    pub data_base64: String,
}

#[tauri::command]
pub async fn cmd_sftp_write_file(
    state: State<'_, AppState>,
    input: SftpWriteInput,
) -> CmdResult<()> {
    require_connect(&state)?;

    let data = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &input.data_base64,
    )
    .map_err(|e| CmdError { code: "DECODE_ERROR", message: e.to_string() })?;

    let sftp_arc = get_sftp(&state, &input.session_id)?;
    let sftp = sftp_arc.lock().await;

    sftp.write(&input.path, &data)
        .await
        .map_err(|e| CmdError { code: "SFTP_ERROR", message: e.to_string() })?;

    Ok(())
}

// ── Create directory ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cmd_sftp_mkdir(
    state: State<'_, AppState>,
    input: SftpPathInput,
) -> CmdResult<()> {
    require_connect(&state)?;

    let sftp_arc = get_sftp(&state, &input.session_id)?;
    let sftp = sftp_arc.lock().await;

    sftp.create_dir(&input.path)
        .await
        .map_err(|e| CmdError { code: "SFTP_ERROR", message: e.to_string() })?;

    Ok(())
}

// ── Delete file or directory ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct SftpDeleteInput {
    pub session_id: String,
    pub path: String,
    pub is_dir: bool,
}

#[tauri::command]
pub async fn cmd_sftp_delete(
    state: State<'_, AppState>,
    input: SftpDeleteInput,
) -> CmdResult<()> {
    require_connect(&state)?;

    let sftp_arc = get_sftp(&state, &input.session_id)?;
    let sftp = sftp_arc.lock().await;

    if input.is_dir {
        sftp.remove_dir(&input.path)
            .await
            .map_err(|e| CmdError { code: "SFTP_ERROR", message: e.to_string() })?;
    } else {
        sftp.remove_file(&input.path)
            .await
            .map_err(|e| CmdError { code: "SFTP_ERROR", message: e.to_string() })?;
    }

    Ok(())
}

// ── Rename / move ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct SftpRenameInput {
    pub session_id: String,
    pub from: String,
    pub to: String,
}

#[tauri::command]
pub async fn cmd_sftp_rename(
    state: State<'_, AppState>,
    input: SftpRenameInput,
) -> CmdResult<()> {
    require_connect(&state)?;

    let sftp_arc = get_sftp(&state, &input.session_id)?;
    let sftp = sftp_arc.lock().await;

    sftp.rename(&input.from, &input.to)
        .await
        .map_err(|e| CmdError { code: "SFTP_ERROR", message: e.to_string() })?;

    Ok(())
}

// ── Disconnect ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn cmd_sftp_disconnect(
    state: State<'_, AppState>,
    session_id: String,
) -> CmdResult<()> {
    // Dropping the SftpEntry drops the SSH handle, closing the connection.
    state.sftp_sessions.lock().unwrap().remove(&session_id);
    Ok(())
}

// ── Helper ────────────────────────────────────────────────────────────────────

fn get_sftp(
    state: &AppState,
    session_id: &str,
) -> Result<Arc<Mutex<russh_sftp::client::SftpSession>>, CmdError> {
    state
        .sftp_sessions
        .lock()
        .unwrap()
        .get(session_id)
        .map(|e| Arc::clone(&e.sftp))
        .ok_or_else(|| CmdError {
            code: "SFTP_SESSION_NOT_FOUND",
            message: format!("No SFTP session: {}", session_id),
        })
}
