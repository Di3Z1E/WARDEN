use russh::keys::PublicKeyBase64;
use serde::{Deserialize, Serialize};
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

// ── SSH Key (upload existing) ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct UploadSshKeyInput {
    pub name: String,
    pub username: String,
    pub private_key_pem: String,
    pub passphrase: Option<String>,
}

#[tauri::command]
pub fn cmd_upload_ssh_key(
    state: State<'_, AppState>,
    input: UploadSshKeyInput,
) -> CmdResult<CredentialSetMeta> {
    let actor = require_admin(&state)?.username;

    // Validate the key parses before storing
    russh::keys::decode_secret_key(
        &input.private_key_pem,
        input.passphrase.as_deref(),
    )
    .map_err(|e| CmdError { code: "KEY_PARSE_ERROR", message: e.to_string() })?;

    let vault_ref = vault::new_ref();
    vault::store(
        &vault_ref,
        &VaultSecret::SshKey {
            username: input.username.clone(),
            private_key: Zeroizing::new(input.private_key_pem),
            passphrase: input.passphrase.map(Zeroizing::new),
        },
    )
    .map_err(CmdError::from)?;

    let conn = state.db.lock().unwrap();
    let meta = inventory::create_credential_set(
        &conn,
        &input.name,
        "SshKey",
        &vault_ref,
        Some(&input.username),
    )
    .map_err(|e| {
        vault::delete(&vault_ref).ok();
        CmdError::from(e)
    })?;

    audit::log(
        &conn,
        &actor,
        "VLT_UPLOAD_KEY",
        Some(&meta.id),
        AuditResult::Ok,
        Some(&input.name),
    )
    .ok();

    Ok(meta)
}

// ── SSH Key Generation ─────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct GenerateSshKeyInput {
    pub name: String,
    pub username: String,
}

#[derive(Debug, Serialize)]
pub struct GenerateSshKeyResult {
    pub credential_set: CredentialSetMeta,
    pub public_key: String,
}

#[tauri::command]
pub fn cmd_generate_ssh_key(
    state: State<'_, AppState>,
    input: GenerateSshKeyInput,
) -> CmdResult<GenerateSshKeyResult> {
    let actor = require_admin(&state)?.username;

    // Generate ed25519 key pair
    let kp = russh::keys::PrivateKey::random(
        &mut rand::rng(),
        russh::keys::ssh_key::Algorithm::Ed25519,
    )
    .map_err(|e| CmdError { code: "KEYGEN_ERROR", message: e.to_string() })?;

    // Encode private key as OpenSSH PEM
    let private_key_pem = kp
        .to_openssh(russh::keys::ssh_key::LineEnding::LF)
        .map_err(|e| CmdError { code: "KEYGEN_ERROR", message: e.to_string() })?;

    // Build authorized_keys line
    let pub_key = kp.public_key();
    let public_key = format!("{} {} WARDEN", pub_key.algorithm().as_str(), pub_key.public_key_base64());

    // Store in vault
    let vault_ref = vault::new_ref();
    vault::store(
        &vault_ref,
        &VaultSecret::SshKey {
            username: input.username.clone(),
            private_key: private_key_pem,
            passphrase: None,
        },
    )
    .map_err(CmdError::from)?;

    let conn = state.db.lock().unwrap();
    let meta = inventory::create_credential_set(
        &conn,
        &input.name,
        "SshKey",
        &vault_ref,
        Some(&input.username),
    )
    .map_err(|e| {
        vault::delete(&vault_ref).ok();
        CmdError::from(e)
    })?;

    audit::log(
        &conn,
        &actor,
        "VLT_GENERATE_KEY",
        Some(&meta.id),
        AuditResult::Ok,
        Some(&input.name),
    )
    .ok();

    Ok(GenerateSshKeyResult { credential_set: meta, public_key })
}

// ── Get public key from stored SshKey credential ──────────────────────────────

#[tauri::command]
pub fn cmd_get_public_key(
    state: State<'_, AppState>,
    cred_id: String,
) -> CmdResult<String> {
    state
        .current_user
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| CmdError { code: "UNAUTHENTICATED", message: "Not logged in".into() })?;

    let conn = state.db.lock().unwrap();
    let creds = inventory::list_credential_sets(&conn).map_err(CmdError::from)?;
    let meta = creds
        .into_iter()
        .find(|c| c.id == cred_id)
        .ok_or_else(|| CmdError { code: "NOT_FOUND", message: "Credential not found".into() })?;

    let secret = vault::retrieve(&meta.vault_ref).map_err(CmdError::from)?;
    let (private_key_pem, passphrase_opt) = match secret {
        VaultSecret::SshKey { private_key, passphrase, .. } => (private_key, passphrase),
        _ => {
            return Err(CmdError {
                code: "WRONG_KIND",
                message: "Credential is not an SSH key".into(),
            })
        }
    };

    let pass_str = passphrase_opt.as_deref().map(|p| p.as_str().to_string());
    let kp = russh::keys::decode_secret_key(&private_key_pem, pass_str.as_deref())
        .map_err(|e| CmdError { code: "KEY_PARSE_ERROR", message: e.to_string() })?;

    let pub_key = kp.public_key();

    Ok(format!("{} {} WARDEN", pub_key.algorithm().as_str(), pub_key.public_key_base64()))
}

// ── Credential expiry ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn cmd_set_credential_expiry(
    state: State<'_, AppState>,
    cred_id: String,
    expires_at: Option<String>,
) -> CmdResult<()> {
    require_admin(&state)?;
    let conn = state.db.lock().unwrap();
    inventory::set_credential_expiry(&conn, &cred_id, expires_at.as_deref()).map_err(CmdError::from)
}

#[tauri::command]
pub fn cmd_get_expiring_credentials(
    state: State<'_, AppState>,
    days: Option<i64>,
) -> CmdResult<Vec<inventory::CredentialSetMeta>> {
    state
        .current_user
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| CmdError { code: "UNAUTHENTICATED", message: "Not logged in".into() })?;
    let conn = state.db.lock().unwrap();
    inventory::get_expiring_credentials(&conn, days.unwrap_or(30)).map_err(CmdError::from)
}

// ── Deploy public key to a remote machine via SSH ─────────────────────────────

#[derive(Debug, Deserialize)]
pub struct DeployPublicKeyInput {
    pub credential_set_id: String,
    pub target_machine_id: String,
    pub auth_credential_set_id: String,
}

#[tauri::command]
pub async fn cmd_deploy_public_key(
    state: State<'_, AppState>,
    input: DeployPublicKeyInput,
) -> CmdResult<()> {
    use crate::protocols::ssh::{self, SshAuth};

    state
        .current_user
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| CmdError { code: "UNAUTHENTICATED", message: "Not logged in".into() })?;

    // Build the public key line
    let public_key = {
        let conn = state.db.lock().unwrap();
        let creds = inventory::list_credential_sets(&conn).map_err(CmdError::from)?;
        let meta = creds
            .iter()
            .find(|c| c.id == input.credential_set_id)
            .ok_or_else(|| CmdError { code: "NOT_FOUND", message: "SSH key credential not found".into() })?;

        let secret = vault::retrieve(&meta.vault_ref).map_err(CmdError::from)?;
        let (private_key_pem, passphrase_opt) = match secret {
            VaultSecret::SshKey { private_key, passphrase, .. } => (private_key, passphrase),
            _ => return Err(CmdError { code: "WRONG_KIND", message: "Not an SSH key credential".into() }),
        };
        let pass_str = passphrase_opt.as_deref().map(|p| p.as_str().to_string());
        let kp = russh::keys::decode_secret_key(&private_key_pem, pass_str.as_deref())
            .map_err(|e| CmdError { code: "KEY_PARSE_ERROR", message: e.to_string() })?;
        let pub_key = kp.public_key();
        format!("{} {} WARDEN", pub_key.algorithm().as_str(), pub_key.public_key_base64())
    };

    // Get connection target (host + port) from machine profiles
    let (host, port, ssh_username, auth) = {
        let conn = state.db.lock().unwrap();
        let profiles = inventory::list_profiles(&conn, &input.target_machine_id)
            .map_err(CmdError::from)?;
        let profile = profiles
            .into_iter()
            .find(|p| p.protocol == "SSH")
            .ok_or_else(|| CmdError {
                code: "NO_SSH_PROFILE",
                message: "Target machine has no SSH connection profile".into(),
            })?;

        let creds = inventory::list_credential_sets(&conn).map_err(CmdError::from)?;
        let auth_meta = creds
            .into_iter()
            .find(|c| c.id == input.auth_credential_set_id)
            .ok_or_else(|| CmdError { code: "NOT_FOUND", message: "Auth credential not found".into() })?;

        let secret = vault::retrieve(&auth_meta.vault_ref).map_err(CmdError::from)?;
        let (username, ssh_auth) = match secret {
            VaultSecret::Password { username, password } => (username, SshAuth::Password(password)),
            VaultSecret::SshKey { username, private_key, passphrase } => (
                username,
                SshAuth::PublicKey { private_key_pem: private_key, passphrase },
            ),
            VaultSecret::Totp { .. } => return Err(CmdError {
                code: "INVALID_CREDENTIAL",
                message: "TOTP secret cannot be used as SSH auth".into(),
            }),
        };

        (profile.host.clone(), profile.port, username, ssh_auth)
    };

    // Feed the deploy script to sh via stdin
    let deploy_script = format!(
        "mkdir -p ~/.ssh && chmod 700 ~/.ssh && printf '%s\\n' '{key}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys",
        key = public_key.replace('\'', "'\\''")
    );

    let (_, stderr, exit) = ssh::run_command(
        &host,
        port,
        &ssh_username,
        auth,
        "sh",
        Some(deploy_script.as_bytes()),
        None,
        None,
    )
    .await
    .map_err(|e| CmdError { code: "SSH_ERROR", message: e.to_string() })?;

    if exit != 0 {
        return Err(CmdError {
            code: "DEPLOY_FAILED",
            message: format!("Deploy failed (exit {}): {}", exit, stderr.trim()),
        });
    }

    Ok(())
}
