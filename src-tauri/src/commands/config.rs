use std::collections::HashMap;

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chrono::Utc;
use rand::Rng;
use serde::{Deserialize, Serialize};
use tauri::State;
use zeroize::Zeroizing;

use crate::{
    error::{CmdError, CmdResult},
    inventory::{self, CreateMachineInput, CreateProfileInput},
    vault::{self, VaultSecret},
    AppState,
};

// ── Internal structs ──────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
struct CredentialExport {
    original_id: String,
    name: String,
    kind: String,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    key_passphrase: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct ExportPayload {
    folders: Vec<inventory::Folder>,
    machines: Vec<inventory::Machine>,
    profiles: Vec<inventory::ConnectionProfile>,
    credentials: Vec<CredentialExport>,
}

#[derive(Serialize, Deserialize)]
struct EncryptedExport {
    version: u32,
    exported_at: String,
    salt: String,
    nonce: String,
    payload: String,
}

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub folders: usize,
    pub machines: usize,
    pub profiles: usize,
    pub credentials: usize,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn derive_key(passphrase: &[u8], salt: &[u8]) -> [u8; 32] {
    let params = Params::new(65536, 3, 1, Some(32)).expect("argon2 params");
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon2
        .hash_password_into(passphrase, salt, &mut key)
        .expect("argon2 kdf");
    key
}

fn require_admin(state: &AppState) -> Result<(), CmdError> {
    match state.current_user.lock().unwrap().as_ref() {
        None => Err(CmdError {
            code: "UNAUTHENTICATED",
            message: "Not logged in".into(),
        }),
        Some(u) if !u.role.is_admin() => Err(CmdError {
            code: "FORBIDDEN",
            message: "Admin role required for backup operations".into(),
        }),
        _ => Ok(()),
    }
}

// ── Export ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cmd_export_config(
    state: State<'_, AppState>,
    passphrase: String,
) -> CmdResult<String> {
    require_admin(&state)?;

    let (folders, machines, profiles, cred_metas) = {
        let conn = state.db.lock().unwrap();
        let folders = inventory::list_folders(&conn).map_err(CmdError::from)?;
        let machines = inventory::list_machines(&conn).map_err(CmdError::from)?;
        let cred_metas = inventory::list_credential_sets(&conn).map_err(CmdError::from)?;
        let mut profiles: Vec<inventory::ConnectionProfile> = Vec::new();
        for m in &machines {
            profiles.extend(inventory::list_profiles(&conn, &m.id).map_err(CmdError::from)?);
        }
        (folders, machines, profiles, cred_metas)
    };

    // Retrieve plaintext secrets from vault
    let mut credentials: Vec<CredentialExport> = Vec::new();
    for meta in &cred_metas {
        let secret = vault::retrieve(&meta.vault_ref).map_err(CmdError::from)?;
        let (username, password, private_key, key_passphrase) = match &secret {
            VaultSecret::Password { username, password } => {
                (username.clone(), Some(password.as_str().to_owned()), None, None)
            }
            VaultSecret::SshKey { username, private_key, passphrase } => (
                username.clone(),
                None,
                Some(private_key.as_str().to_owned()),
                passphrase.as_ref().map(|p| p.as_str().to_owned()),
            ),
        };
        credentials.push(CredentialExport {
            original_id: meta.id.clone(),
            name: meta.name.clone(),
            kind: meta.kind.clone(),
            username,
            password,
            private_key,
            key_passphrase,
        });
    }

    let payload = ExportPayload { folders, machines, profiles, credentials };
    // Wrap in Zeroizing so plaintext secrets are wiped from memory after encryption
    let payload_json = Zeroizing::new(
        serde_json::to_string(&payload)
            .map_err(|e| CmdError { code: "SERIALIZE_ERROR", message: e.to_string() })?,
    );

    let mut salt = [0u8; 16];
    let mut nonce_bytes = [0u8; 12];
    rand::rng().fill_bytes(&mut salt);
    rand::rng().fill_bytes(&mut nonce_bytes);

    let key_bytes = derive_key(passphrase.as_bytes(), &salt);
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, payload_json.as_bytes())
        .map_err(|_| CmdError {
            code: "ENCRYPT_ERROR",
            message: "Encryption failed".into(),
        })?;

    let export = EncryptedExport {
        version: 1,
        exported_at: Utc::now().to_rfc3339(),
        salt: B64.encode(salt),
        nonce: B64.encode(nonce_bytes),
        payload: B64.encode(&ciphertext),
    };

    serde_json::to_string_pretty(&export)
        .map_err(|e| CmdError { code: "SERIALIZE_ERROR", message: e.to_string() })
}

// ── Import ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cmd_import_config(
    state: State<'_, AppState>,
    data: String,
    passphrase: String,
) -> CmdResult<ImportResult> {
    require_admin(&state)?;

    let export: EncryptedExport = serde_json::from_str(&data).map_err(|e| CmdError {
        code: "PARSE_ERROR",
        message: format!("Invalid backup file: {}", e),
    })?;

    if export.version != 1 {
        return Err(CmdError {
            code: "VERSION_MISMATCH",
            message: format!("Unsupported backup version {}. Expected 1.", export.version),
        });
    }

    let salt = B64.decode(&export.salt).map_err(|_| CmdError {
        code: "PARSE_ERROR",
        message: "Corrupted backup: invalid salt".into(),
    })?;
    let nonce_bytes = B64.decode(&export.nonce).map_err(|_| CmdError {
        code: "PARSE_ERROR",
        message: "Corrupted backup: invalid nonce".into(),
    })?;
    let ciphertext = B64.decode(&export.payload).map_err(|_| CmdError {
        code: "PARSE_ERROR",
        message: "Corrupted backup: invalid payload".into(),
    })?;

    let key_bytes = derive_key(passphrase.as_bytes(), &salt);
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| CmdError {
            code: "WRONG_PASSPHRASE",
            message: "Wrong passphrase or corrupted backup file".into(),
        })?;

    let payload: ExportPayload = serde_json::from_slice(&plaintext).map_err(|e| CmdError {
        code: "PARSE_ERROR",
        message: format!("Corrupt payload: {}", e),
    })?;

    let mut folder_count = 0usize;
    let mut machine_count = 0usize;
    let mut profile_count = 0usize;
    let mut credential_count = 0usize;

    let mut folder_id_map: HashMap<String, String> = HashMap::new();
    let mut machine_id_map: HashMap<String, String> = HashMap::new();
    let mut cred_id_map: HashMap<String, String> = HashMap::new();

    {
        let conn = state.db.lock().unwrap();

        // Import folders — multi-pass to resolve parent_id ordering
        let mut remaining = payload.folders;
        for _ in 0..=remaining.len() {
            if remaining.is_empty() {
                break;
            }
            let mut deferred = Vec::new();
            for folder in remaining {
                let parent_new_id = match &folder.parent_id {
                    None => None,
                    Some(old_pid) => match folder_id_map.get(old_pid) {
                        Some(nid) => Some(nid.clone()),
                        None => {
                            deferred.push(folder);
                            continue;
                        }
                    },
                };
                let created = inventory::create_folder(
                    &conn,
                    &folder.name,
                    parent_new_id.as_deref(),
                )
                .map_err(CmdError::from)?;
                folder_id_map.insert(folder.id, created.id);
                folder_count += 1;
            }
            remaining = deferred;
        }

        // Import machines
        for machine in &payload.machines {
            let new_folder_id = machine
                .folder_id
                .as_ref()
                .and_then(|oid| folder_id_map.get(oid))
                .cloned();
            let input = CreateMachineInput {
                name: machine.name.clone(),
                machine_type: machine.machine_type.as_str().to_string(),
                folder_id: new_folder_id,
                tags: machine.tags.clone(),
                notes: machine.notes.clone(),
            };
            let created = inventory::create_machine(&conn, &input).map_err(CmdError::from)?;
            machine_id_map.insert(machine.id.clone(), created.id);
            machine_count += 1;
        }

        // Import credentials into vault
        for cred in &payload.credentials {
            let vault_ref = vault::new_ref();
            let secret = match cred.kind.as_str() {
                "Password" => VaultSecret::Password {
                    username: cred.username.clone(),
                    password: Zeroizing::new(cred.password.clone().unwrap_or_default()),
                },
                _ => VaultSecret::SshKey {
                    username: cred.username.clone(),
                    private_key: Zeroizing::new(cred.private_key.clone().unwrap_or_default()),
                    passphrase: cred
                        .key_passphrase
                        .as_ref()
                        .map(|p| Zeroizing::new(p.clone())),
                },
            };
            vault::store(&vault_ref, &secret).map_err(CmdError::from)?;
            let created = inventory::create_credential_set(
                &conn,
                &cred.name,
                &cred.kind,
                &vault_ref,
                Some(&cred.username),
            )
            .map_err(CmdError::from)?;
            cred_id_map.insert(cred.original_id.clone(), created.id);
            credential_count += 1;
        }

        // Import profiles
        for profile in &payload.profiles {
            let new_machine_id = match machine_id_map.get(&profile.machine_id) {
                Some(id) => id.clone(),
                None => continue, // orphaned profile — skip
            };
            let new_cred_id = profile
                .credential_set_id
                .as_ref()
                .and_then(|oid| cred_id_map.get(oid))
                .cloned();
            let input = CreateProfileInput {
                machine_id: new_machine_id,
                label: profile.label.clone(),
                protocol: profile.protocol.clone(),
                host: profile.host.clone(),
                port: profile.port,
                options: Some(profile.options.clone()),
                credential_set_id: new_cred_id,
            };
            inventory::create_profile(&conn, &input).map_err(CmdError::from)?;
            profile_count += 1;
        }
    }

    Ok(ImportResult {
        folders: folder_count,
        machines: machine_count,
        profiles: profile_count,
        credentials: credential_count,
    })
}
