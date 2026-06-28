use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::{
    audit::{self, AuditResult},
    error::{CmdError, CmdResult},
    inventory,
    protocols::{rdp, ssh, telnet, SessionProtocol},
    vault::{self, VaultSecret},
    AppState,
};

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

// ── Connect SSH ───────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ConnectSshInput {
    pub profile_id: String,
    pub cols: u32,
    pub rows: u32,
}

#[derive(Debug, Serialize)]
pub struct SessionDto {
    pub id: String,
    pub protocol: String,
    pub profile_id: String,
}

#[tauri::command]
pub async fn cmd_connect_ssh(
    state: State<'_, AppState>,
    app: AppHandle,
    input: ConnectSshInput,
) -> CmdResult<SessionDto> {
    let actor = require_connect(&state)?;

    // ── All synchronous DB + vault work before any await ──────────────────
    let (profile, machine_id, username, auth) = {
        let conn = state.db.lock().unwrap();

        // Scan machines for the profile (inventory is small)
        let machines = inventory::list_machines(&conn).map_err(CmdError::from)?;
        let mut found: Option<(inventory::ConnectionProfile, String)> = None;

        for m in &machines {
            let profiles =
                inventory::list_profiles(&conn, &m.id).map_err(CmdError::from)?;
            if let Some(p) = profiles.into_iter().find(|p| p.id == input.profile_id) {
                found = Some((p, m.id.clone()));
                break;
            }
        }

        let (profile, machine_id) = found.ok_or_else(|| CmdError {
            code: "NOT_FOUND",
            message: format!("Profile not found: {}", input.profile_id),
        })?;

        // Resolve credential set
        let cred_id = profile.credential_set_id.as_ref().ok_or_else(|| CmdError {
            code: "NO_CREDENTIAL",
            message: "No credential set assigned to this connection profile".into(),
        })?;

        let cred_sets = inventory::list_credential_sets(&conn).map_err(CmdError::from)?;
        let cred_meta = cred_sets
            .into_iter()
            .find(|s| &s.id == cred_id)
            .ok_or_else(|| CmdError {
                code: "CRED_NOT_FOUND",
                message: format!("Credential set not found: {}", cred_id),
            })?;

        // Retrieve secret from Windows Credential Manager
        let secret = vault::retrieve(&cred_meta.vault_ref).map_err(CmdError::from)?;

        let (username, auth) = match secret {
            VaultSecret::Password { username, password } => {
                (username, ssh::SshAuth::Password(password))
            }
            VaultSecret::SshKey {
                username,
                private_key,
                passphrase,
            } => (
                username,
                ssh::SshAuth::PublicKey {
                    private_key_pem: private_key,
                    passphrase,
                },
            ),
        };

        (profile, machine_id, username, auth)
    };

    // ── Async: establish SSH connection ────────────────────────────────────
    let session_id = uuid::Uuid::new_v4().to_string();

    let params = ssh::SshParams {
        host: profile.host.clone(),
        port: profile.port,
        username,
        auth,
        term: "xterm-256color".to_string(),
        cols: input.cols,
        rows: input.rows,
    };

    let handle = ssh::connect(params, session_id.clone(), app)
        .await
        .map_err(|e| CmdError {
            code: "SSH_CONNECT_ERROR",
            message: e.to_string(),
        })?;

    // Audit + last-connected timestamp
    {
        let conn = state.db.lock().unwrap();
        audit::log(
            &conn,
            &actor.username,
            "SESSION_OPEN_SSH",
            Some(&profile.id),
            AuditResult::Ok,
            Some(&format!("{}:{}", profile.host, profile.port)),
        )
        .ok();
        inventory::touch_machine(&conn, &machine_id).ok();
    }

    state
        .sessions
        .lock()
        .unwrap()
        .insert(session_id.clone(), handle);

    Ok(SessionDto {
        id: session_id,
        protocol: "SSH".into(),
        profile_id: input.profile_id,
    })
}

// ── Connect Telnet ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ConnectTelnetInput {
    pub profile_id: String,
}

#[tauri::command]
pub async fn cmd_connect_telnet(
    state: State<'_, AppState>,
    app: AppHandle,
    input: ConnectTelnetInput,
) -> CmdResult<SessionDto> {
    let actor = require_connect(&state)?;

    let (profile, machine_id) = {
        let conn = state.db.lock().unwrap();
        let machines = inventory::list_machines(&conn).map_err(CmdError::from)?;
        let mut found: Option<(inventory::ConnectionProfile, String)> = None;
        for m in &machines {
            let profiles = inventory::list_profiles(&conn, &m.id).map_err(CmdError::from)?;
            if let Some(p) = profiles.into_iter().find(|p| p.id == input.profile_id) {
                found = Some((p, m.id.clone()));
                break;
            }
        }
        found.ok_or_else(|| CmdError {
            code: "NOT_FOUND",
            message: format!("Profile not found: {}", input.profile_id),
        })?
    };

    let session_id = uuid::Uuid::new_v4().to_string();
    let params = telnet::TelnetParams {
        host: profile.host.clone(),
        port: profile.port as u32,
    };

    let handle = telnet::connect(params, session_id.clone(), app)
        .await
        .map_err(|e| CmdError {
            code: "TELNET_CONNECT_ERROR",
            message: e.to_string(),
        })?;

    {
        let conn = state.db.lock().unwrap();
        audit::log(
            &conn,
            &actor.username,
            "SESSION_OPEN_TELNET",
            Some(&profile.id),
            AuditResult::Ok,
            Some(&format!("{}:{}", profile.host, profile.port)),
        )
        .ok();
        inventory::touch_machine(&conn, &machine_id).ok();
    }

    state.sessions.lock().unwrap().insert(session_id.clone(), handle);

    Ok(SessionDto {
        id: session_id,
        protocol: "Telnet".into(),
        profile_id: input.profile_id,
    })
}

// ── Connect RDP ───────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ConnectRdpInput {
    pub profile_id: String,
    pub width: Option<u16>,
    pub height: Option<u16>,
}

#[tauri::command]
pub async fn cmd_connect_rdp(
    state: State<'_, AppState>,
    app: AppHandle,
    input: ConnectRdpInput,
) -> CmdResult<SessionDto> {
    let actor = require_connect(&state)?;

    let (profile, machine_id, username, password, domain, enable_nla) = {
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

        let (username, password) = match secret {
            VaultSecret::Password { username, password } => (username, password),
            VaultSecret::SshKey { .. } => {
                return Err(CmdError {
                    code: "WRONG_CRED_TYPE",
                    message: "RDP requires a password credential, not an SSH key".into(),
                });
            }
        };

        // Parse DOMAIN\username or plain username
        let (domain, username) = if let Some(pos) = username.find('\\') {
            (Some(username[..pos].to_string()), username[pos + 1..].to_string())
        } else {
            (None, username)
        };

        // Read NLA toggle from profile options (default: enabled)
        let enable_nla = profile.options
            .get("nla")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        (profile, machine_id, username, password, domain, enable_nla)
    };

    let session_id = uuid::Uuid::new_v4().to_string();
    let rdp_params = rdp::RdpParams {
        host: profile.host.clone(),
        port: profile.port,
        username,
        password,
        domain,
        width: input.width.unwrap_or(1280),
        height: input.height.unwrap_or(800),
        enable_nla,
    };

    let handle = rdp::connect(rdp_params, session_id.clone(), app)
        .await
        .map_err(|e| CmdError { code: "RDP_CONNECT_ERROR", message: e.to_string() })?;

    {
        let conn = state.db.lock().unwrap();
        audit::log(
            &conn,
            &actor.username,
            "SESSION_OPEN_RDP",
            Some(&profile.id),
            AuditResult::Ok,
            Some(&format!("{}:{}", profile.host, profile.port)),
        )
        .ok();
        inventory::touch_machine(&conn, &machine_id).ok();
    }

    state.sessions.lock().unwrap().insert(session_id.clone(), handle);

    Ok(SessionDto {
        id: session_id,
        protocol: "RDP".into(),
        profile_id: input.profile_id,
    })
}

// ── RDP input (keyboard / mouse) ─────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RdpInputEvent {
    pub session_id: String,
    /// Pre-encoded RDP input PDU bytes (base64).
    pub data_base64: String,
}

#[tauri::command]
pub async fn cmd_rdp_input(
    state: State<'_, AppState>,
    input: RdpInputEvent,
) -> CmdResult<()> {
    require_connect(&state)?;

    let data = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &input.data_base64,
    )
    .map_err(|e| CmdError { code: "DECODE_ERROR", message: e.to_string() })?;

    let tx = {
        let guard = state.sessions.lock().unwrap();
        guard
            .get(&input.session_id)
            .map(|h| h.input_tx.clone())
            .ok_or_else(|| CmdError {
                code: "SESSION_NOT_FOUND",
                message: format!("No RDP session: {}", input.session_id),
            })?
    };

    tx.send(data).await.map_err(|_| CmdError {
        code: "SESSION_CLOSED",
        message: "RDP session input channel closed".into(),
    })?;

    Ok(())
}

// ── Write to session (stdin) ──────────────────────────────────────────────────

#[tauri::command]
pub async fn cmd_session_write(
    state: State<'_, AppState>,
    session_id: String,
    data: Vec<u8>,
) -> CmdResult<()> {
    require_connect(&state)?;

    let tx = {
        let guard = state.sessions.lock().unwrap();
        guard
            .get(&session_id)
            .map(|h| h.input_tx.clone())
            .ok_or_else(|| CmdError {
                code: "SESSION_NOT_FOUND",
                message: format!("No active session: {}", session_id),
            })?
    };

    tx.send(data).await.map_err(|_| CmdError {
        code: "SESSION_CLOSED",
        message: "Session input channel closed".into(),
    })?;

    Ok(())
}

// ── Resize PTY ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ResizeInput {
    pub session_id: String,
    pub cols: u32,
    pub rows: u32,
}

#[tauri::command]
pub async fn cmd_session_resize(
    state: State<'_, AppState>,
    input: ResizeInput,
) -> CmdResult<()> {
    require_connect(&state)?;

    let tx = {
        let guard = state.sessions.lock().unwrap();
        guard
            .get(&input.session_id)
            .map(|h| h.input_tx.clone())
            .ok_or_else(|| CmdError {
                code: "SESSION_NOT_FOUND",
                message: format!("No active session: {}", input.session_id),
            })?
    };

    let msg = format!("\x00RESIZE:{}:{}", input.cols, input.rows);
    tx.send(msg.into_bytes()).await.map_err(|_| CmdError {
        code: "SESSION_CLOSED",
        message: "Session input channel closed".into(),
    })?;

    Ok(())
}

// ── Disconnect session ────────────────────────────────────────────────────────

#[tauri::command]
pub fn cmd_disconnect_session(
    state: State<'_, AppState>,
    session_id: String,
) -> CmdResult<()> {
    let actor = state
        .current_user
        .lock()
        .unwrap()
        .as_ref()
        .map(|u| u.username.clone())
        .unwrap_or_default();

    // Drop the handle → aborts the background task via Drop impl
    state.sessions.lock().unwrap().remove(&session_id);

    let conn = state.db.lock().unwrap();
    audit::log(
        &conn,
        &actor,
        "SESSION_CLOSE",
        Some(&session_id),
        AuditResult::Ok,
        None,
    )
    .ok();

    Ok(())
}

// ── List active sessions ──────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct ActiveSessionDto {
    pub id: String,
    pub protocol: String,
}

#[tauri::command]
pub fn cmd_list_sessions(state: State<'_, AppState>) -> CmdResult<Vec<ActiveSessionDto>> {
    let guard = state.sessions.lock().unwrap();
    Ok(guard
        .values()
        .map(|h| ActiveSessionDto {
            id: h.id.clone(),
            protocol: match h.protocol {
                SessionProtocol::Ssh => "SSH".into(),
                SessionProtocol::Rdp => "RDP".into(),
                SessionProtocol::Telnet => "Telnet".into(),
                SessionProtocol::Vnc => "VNC".into(),
            },
        })
        .collect())
}
