use argon2::password_hash::rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use tauri::State;
use totp_rs::{Algorithm, Secret, TOTP};
use zeroize::Zeroizing;

use crate::{
    audit::{self, AuditResult},
    commands::iam::AppUserDto,
    error::{CmdError, CmdResult},
    iam::{self, AuthenticatedUser},
    vault::{self, VaultSecret},
    AppState, PendingMfa,
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

fn generate_totp_secret() -> String {
    let mut bytes = [0u8; 20];
    OsRng.fill_bytes(&mut bytes);
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut out = String::new();
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;
    for &b in bytes.iter() {
        buf = (buf << 8) | (b as u32);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(CHARS[((buf >> bits) & 0x1F) as usize] as char);
        }
    }
    if bits > 0 {
        out.push(CHARS[((buf << (5 - bits)) & 0x1F) as usize] as char);
    }
    out
}

fn make_totp(secret_b32: &str, username: &str) -> Result<TOTP, CmdError> {
    let bytes = Secret::Encoded(secret_b32.to_string())
        .to_bytes()
        .map_err(|e| CmdError { code: "MFA_ERROR", message: e.to_string() })?;
    TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        bytes,
        Some("WARDEN".to_string()),
        username.to_string(),
    )
    .map_err(|e| CmdError { code: "MFA_ERROR", message: e.to_string() })
}

// ── Provision ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct MfaProvisionResult {
    pub otpauth_url: String,
    pub qr_png_base64: String,
}

#[tauri::command]
pub fn cmd_mfa_provision(state: State<'_, AppState>) -> CmdResult<MfaProvisionResult> {
    let actor = require_auth(&state)?;

    let secret_b32 = generate_totp_secret();

    let totp = make_totp(&secret_b32, &actor.username)?;
    let otpauth_url = totp.get_url();
    let qr_png_base64 = totp
        .get_qr_base64()
        .map_err(|e| CmdError { code: "MFA_ERROR", message: e.to_string() })?;

    // Store provisioned secret in vault (not yet enabled — enable after verify)
    let conn = state.db.lock().unwrap();

    // Remove any previous unverified MFA vault entry
    if let Ok((Some(old_ref), _)) = iam::get_mfa_row(&conn, &actor.id) {
        vault::delete(&old_ref).ok();
    }

    let vault_ref = vault::new_ref();
    vault::store(
        &vault_ref,
        &VaultSecret::Totp {
            secret_base32: Zeroizing::new(secret_b32),
        },
    )
    .map_err(CmdError::from)?;

    iam::set_mfa_secret_ref(&conn, &actor.id, Some(&vault_ref)).map_err(CmdError::from)?;

    audit::log(&conn, &actor.username, "MFA_PROVISION", Some(&actor.id), AuditResult::Ok, None)
        .ok();

    Ok(MfaProvisionResult { otpauth_url, qr_png_base64 })
}

// ── Verify and enable ─────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct VerifyEnableInput {
    pub code: String,
}

#[tauri::command]
pub fn cmd_mfa_verify_and_enable(
    state: State<'_, AppState>,
    input: VerifyEnableInput,
) -> CmdResult<()> {
    let actor = require_auth(&state)?;
    let conn = state.db.lock().unwrap();

    let (vault_ref_opt, _) = iam::get_mfa_row(&conn, &actor.id).map_err(CmdError::from)?;
    let vault_ref = vault_ref_opt.ok_or_else(|| CmdError {
        code: "MFA_NOT_PROVISIONED",
        message: "No MFA secret found. Generate a QR code first.".into(),
    })?;

    let secret_b32 = retrieve_totp_secret(&vault_ref)?;
    let totp = make_totp(&secret_b32, &actor.username)?;

    if !totp
        .check_current(&input.code)
        .map_err(|e| CmdError { code: "MFA_ERROR", message: e.to_string() })?
    {
        return Err(CmdError {
            code: "MFA_INVALID_CODE",
            message: "Invalid authenticator code".into(),
        });
    }

    iam::set_mfa_enabled(&conn, &actor.id, true).map_err(CmdError::from)?;

    // Sync in-memory session so next cmd_get_current_user reflects the change
    if let Some(ref mut u) = *state.current_user.lock().unwrap() {
        u.mfa_enabled = true;
    }

    audit::log(
        &conn,
        &actor.username,
        "MFA_ENABLE",
        Some(&actor.id),
        AuditResult::Ok,
        None,
    )
    .ok();

    Ok(())
}

// ── Disable ───────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct DisableMfaInput {
    pub current_password: String,
}

#[tauri::command]
pub fn cmd_mfa_disable(
    state: State<'_, AppState>,
    input: DisableMfaInput,
) -> CmdResult<()> {
    let actor = require_auth(&state)?;
    let conn = state.db.lock().unwrap();

    // Re-verify password before disabling
    iam::authenticate(&conn, &actor.username, &input.current_password).map_err(|_| CmdError {
        code: "AUTH_FAILED",
        message: "Current password is incorrect".into(),
    })?;

    let (vault_ref_opt, _) = iam::get_mfa_row(&conn, &actor.id).map_err(CmdError::from)?;
    if let Some(vault_ref) = vault_ref_opt {
        vault::delete(&vault_ref).ok();
    }

    iam::set_mfa_secret_ref(&conn, &actor.id, None).map_err(CmdError::from)?;
    iam::set_mfa_enabled(&conn, &actor.id, false).map_err(CmdError::from)?;

    if let Some(ref mut u) = *state.current_user.lock().unwrap() {
        u.mfa_enabled = false;
    }

    audit::log(
        &conn,
        &actor.username,
        "MFA_DISABLE",
        Some(&actor.id),
        AuditResult::Ok,
        None,
    )
    .ok();

    Ok(())
}

// ── Complete login with TOTP code ─────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct LoginMfaInput {
    pub ephemeral_token: String,
    pub code: String,
}

#[tauri::command]
pub fn cmd_login_mfa(
    state: State<'_, AppState>,
    input: LoginMfaInput,
) -> CmdResult<AppUserDto> {
    // Pull the pending challenge out (removes it — single-use)
    let pending: PendingMfa = state
        .pending_mfa
        .lock()
        .unwrap()
        .remove(&input.ephemeral_token)
        .ok_or_else(|| CmdError {
            code: "MFA_TOKEN_EXPIRED",
            message: "MFA session expired or invalid. Please sign in again.".into(),
        })?;

    if pending.expires_at < std::time::Instant::now() {
        return Err(CmdError {
            code: "MFA_TOKEN_EXPIRED",
            message: "MFA session expired. Please sign in again.".into(),
        });
    }

    let conn = state.db.lock().unwrap();
    let (vault_ref_opt, _) =
        iam::get_mfa_row(&conn, &pending.user.id).map_err(CmdError::from)?;
    let vault_ref = vault_ref_opt.ok_or_else(|| CmdError {
        code: "MFA_NOT_CONFIGURED",
        message: "MFA not configured for this account".into(),
    })?;

    let secret_b32 = retrieve_totp_secret(&vault_ref)?;
    let totp = make_totp(&secret_b32, &pending.user.username)?;

    if !totp
        .check_current(&input.code)
        .map_err(|e| CmdError { code: "MFA_ERROR", message: e.to_string() })?
    {
        audit::log(
            &conn,
            &pending.user.username,
            "AUTH_LOGIN_MFA",
            None,
            AuditResult::Denied,
            Some("Invalid TOTP code"),
        )
        .ok();
        return Err(CmdError {
            code: "MFA_INVALID_CODE",
            message: "Invalid authenticator code".into(),
        });
    }

    audit::log(
        &conn,
        &pending.user.username,
        "AUTH_LOGIN_MFA",
        None,
        AuditResult::Ok,
        None,
    )
    .ok();

    let dto = AppUserDto::from(&pending.user);
    *state.current_user.lock().unwrap() = Some(pending.user);

    Ok(dto)
}

// ── Private helpers ───────────────────────────────────────────────────────────

fn retrieve_totp_secret(vault_ref: &str) -> Result<String, CmdError> {
    match vault::retrieve(vault_ref).map_err(CmdError::from)? {
        VaultSecret::Totp { secret_base32 } => Ok(secret_base32.to_string()),
        _ => Err(CmdError {
            code: "MFA_ERROR",
            message: "Unexpected vault entry type for MFA".into(),
        }),
    }
}

// ── Ephemeral token cleanup helper (called on logout) ─────────────────────────

pub fn _evict_expired_pending(state: &AppState) {
    let now = std::time::Instant::now();
    state
        .pending_mfa
        .lock()
        .unwrap()
        .retain(|_, v| v.expires_at > now);
}

// ── Get current user MFA status ───────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct MfaStatus {
    pub enabled: bool,
    pub provisioned: bool,
}

#[tauri::command]
pub fn cmd_get_mfa_status(state: State<'_, AppState>) -> CmdResult<MfaStatus> {
    let actor = require_auth(&state)?;
    let conn = state.db.lock().unwrap();
    let (vault_ref_opt, enabled) =
        iam::get_mfa_row(&conn, &actor.id).map_err(CmdError::from)?;
    Ok(MfaStatus {
        enabled,
        provisioned: vault_ref_opt.is_some(),
    })
}

// ── Generate ephemeral token for re-provision (Admin resetting another user) ──

#[derive(Debug, Deserialize)]
pub struct AdminResetMfaInput {
    pub user_id: String,
}

#[tauri::command]
pub fn cmd_admin_reset_mfa(
    state: State<'_, AppState>,
    input: AdminResetMfaInput,
) -> CmdResult<()> {
    let actor = {
        let guard = state.current_user.lock().unwrap();
        guard.clone().ok_or_else(|| CmdError {
            code: "UNAUTHENTICATED",
            message: "Not logged in".into(),
        })?
    };

    if !actor.role.is_admin() {
        return Err(CmdError {
            code: "FORBIDDEN",
            message: "Admin role required".into(),
        });
    }

    let conn = state.db.lock().unwrap();
    let (vault_ref_opt, _) =
        iam::get_mfa_row(&conn, &input.user_id).map_err(CmdError::from)?;

    if let Some(vault_ref) = vault_ref_opt {
        vault::delete(&vault_ref).ok();
    }

    iam::set_mfa_secret_ref(&conn, &input.user_id, None).map_err(CmdError::from)?;
    iam::set_mfa_enabled(&conn, &input.user_id, false).map_err(CmdError::from)?;

    audit::log(
        &conn,
        &actor.username,
        "MFA_ADMIN_RESET",
        Some(&input.user_id),
        AuditResult::Ok,
        None,
    )
    .ok();

    Ok(())
}

