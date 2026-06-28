//! Credential vault — Windows Credential Manager backed, never plaintext on disk.
//!
//! Vault references (vault_ref) are UUIDs stored in the DB.
//! The actual secrets live in Credential Manager under target names:
//!   "WARDEN/<vault_ref>"
//!
//! We store JSON-encoded payloads so a single target can hold:
//!   { "password": "..." }  — for password credentials
//!   { "private_key": "...", "passphrase": "..." }  — for SSH keys

use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::error::AppError;

const TARGET_PREFIX: &str = "WARDEN/";

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum VaultSecret {
    Password {
        username: String,
        password: Zeroizing<String>,
    },
    SshKey {
        username: String,
        private_key: Zeroizing<String>,
        passphrase: Option<Zeroizing<String>>,
    },
}

/// Generate a fresh vault reference UUID.
pub fn new_ref() -> String {
    Uuid::new_v4().to_string()
}

fn target_name(vault_ref: &str) -> String {
    format!("{}{}", TARGET_PREFIX, vault_ref)
}

// ── Windows Credential Manager ───────────────────────────────────────────────

#[cfg(windows)]
pub fn store(vault_ref: &str, secret: &VaultSecret) -> Result<(), AppError> {
    use windows::core::PWSTR;
    use windows::Win32::Security::Credentials::{
        CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };

    let payload = Zeroizing::new(
        serde_json::to_string(secret)
            .map_err(|e| AppError::Vault(e.to_string()))?,
    );
    let payload_bytes = payload.as_bytes();

    let target = target_name(vault_ref);
    let target_w: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();

    let username_str = match secret {
        VaultSecret::Password { username, .. } => username.clone(),
        VaultSecret::SshKey { username, .. } => username.clone(),
    };
    let username_w: Vec<u16> = username_str
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let cred = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: PWSTR(target_w.as_ptr() as *mut u16),
        UserName: PWSTR(username_w.as_ptr() as *mut u16),
        CredentialBlobSize: payload_bytes.len() as u32,
        CredentialBlob: payload_bytes.as_ptr() as *mut u8,
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        ..Default::default()
    };

    unsafe { CredWriteW(&cred, 0) }
        .map_err(|e| AppError::Vault(e.to_string()))?;

    Ok(())
}

#[cfg(windows)]
pub fn retrieve(vault_ref: &str) -> Result<VaultSecret, AppError> {
    use windows::Win32::Security::Credentials::{
        CredFree, CredReadW, CRED_TYPE_GENERIC,
    };

    let target = target_name(vault_ref);
    let target_w: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();

    let raw = unsafe {
        let mut ptr = std::ptr::null_mut();
        CredReadW(
            windows::core::PCWSTR(target_w.as_ptr()),
            CRED_TYPE_GENERIC,
            0,
            &mut ptr,
        )
        .map_err(|e| AppError::Vault(e.to_string()))?;

        let cred = &*ptr;
        let blob = std::slice::from_raw_parts(
            cred.CredentialBlob,
            cred.CredentialBlobSize as usize,
        );
        let payload = Zeroizing::new(blob.to_vec());
        CredFree(ptr as *mut _);
        payload
    };

    let secret: VaultSecret = serde_json::from_slice(&raw)
        .map_err(|e| AppError::Vault(format!("Corrupt vault entry: {}", e)))?;

    Ok(secret)
}

#[cfg(windows)]
pub fn delete(vault_ref: &str) -> Result<(), AppError> {
    use windows::Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC};

    let target = target_name(vault_ref);
    let target_w: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();

    unsafe {
        CredDeleteW(
            windows::core::PCWSTR(target_w.as_ptr()),
            CRED_TYPE_GENERIC,
            0,
        )
    }
    .map_err(|e| AppError::Vault(e.to_string()))?;

    Ok(())
}

// ── Stub implementations for non-Windows builds (CI / linting only) ──────────

#[cfg(not(windows))]
pub fn store(_vault_ref: &str, _secret: &VaultSecret) -> Result<(), AppError> {
    Err(AppError::Vault("Credential Manager only available on Windows".into()))
}

#[cfg(not(windows))]
pub fn retrieve(_vault_ref: &str) -> Result<VaultSecret, AppError> {
    Err(AppError::Vault("Credential Manager only available on Windows".into()))
}

#[cfg(not(windows))]
pub fn delete(_vault_ref: &str) -> Result<(), AppError> {
    Err(AppError::Vault("Credential Manager only available on Windows".into()))
}
