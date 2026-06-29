use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::{
    audit::{self, AuditResult},
    error::{CmdError, CmdResult},
    inventory,
    protocols::ssh::{self, SshAuth},
    scripts::{self, Script, ScriptRun, ScriptRunOutput},
    vault::{self, VaultSecret},
    AppState,
};

fn require_operator(state: &AppState) -> Result<crate::iam::AuthenticatedUser, CmdError> {
    state
        .current_user
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| CmdError { code: "UNAUTHENTICATED", message: "Not logged in".into() })
        .and_then(|u| {
            if u.role.can_connect() {
                Ok(u)
            } else {
                Err(CmdError {
                    code: "FORBIDDEN",
                    message: "Operator or Admin role required".into(),
                })
            }
        })
}

fn require_admin(state: &AppState) -> Result<crate::iam::AuthenticatedUser, CmdError> {
    state
        .current_user
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| CmdError { code: "UNAUTHENTICATED", message: "Not logged in".into() })
        .and_then(|u| {
            if u.role.is_admin() {
                Ok(u)
            } else {
                Err(CmdError { code: "FORBIDDEN", message: "Admin role required".into() })
            }
        })
}

// ── Script CRUD ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn cmd_list_scripts(state: State<'_, AppState>) -> CmdResult<Vec<Script>> {
    require_operator(&state)?;
    let conn = state.db.lock().unwrap();
    scripts::list_scripts(&conn).map_err(CmdError::from)
}

#[derive(Debug, Deserialize)]
pub struct CreateScriptInput {
    pub name: String,
    pub language: String,
    pub body: String,
    pub parameters_json: Option<String>,
}

#[tauri::command]
pub fn cmd_create_script(
    state: State<'_, AppState>,
    input: CreateScriptInput,
) -> CmdResult<Script> {
    require_operator(&state)?;
    let params_json = input.parameters_json.as_deref().unwrap_or("[]");
    let conn = state.db.lock().unwrap();
    scripts::create_script(
        &conn,
        scripts::CreateScriptInput {
            name: &input.name,
            language: &input.language,
            body: &input.body,
            parameters_json: params_json,
        },
    )
    .map_err(CmdError::from)
}

#[derive(Debug, Deserialize)]
pub struct UpdateScriptInput {
    pub name: String,
    pub language: String,
    pub body: String,
    pub parameters_json: Option<String>,
}

#[tauri::command]
pub fn cmd_update_script(
    state: State<'_, AppState>,
    script_id: String,
    input: UpdateScriptInput,
) -> CmdResult<Script> {
    require_operator(&state)?;
    let params_json = input.parameters_json.as_deref().unwrap_or("[]");
    let conn = state.db.lock().unwrap();
    scripts::update_script(
        &conn,
        &script_id,
        scripts::UpdateScriptInput {
            name: &input.name,
            language: &input.language,
            body: &input.body,
            parameters_json: params_json,
        },
    )
    .map_err(CmdError::from)
}

#[tauri::command]
pub fn cmd_delete_script(state: State<'_, AppState>, script_id: String) -> CmdResult<()> {
    require_admin(&state)?;
    let conn = state.db.lock().unwrap();
    scripts::delete_script(&conn, &script_id).map_err(CmdError::from)
}

// ── Script runs ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn cmd_list_script_runs(
    state: State<'_, AppState>,
    script_id: Option<String>,
) -> CmdResult<Vec<ScriptRun>> {
    require_operator(&state)?;
    let conn = state.db.lock().unwrap();
    scripts::list_runs(&conn, script_id.as_deref()).map_err(CmdError::from)
}

#[tauri::command]
pub fn cmd_get_script_run_outputs(
    state: State<'_, AppState>,
    run_id: String,
) -> CmdResult<Vec<ScriptRunOutput>> {
    require_operator(&state)?;
    let conn = state.db.lock().unwrap();
    scripts::get_run_outputs(&conn, &run_id).map_err(CmdError::from)
}

// ── Resolve SSH credentials for a machine ────────────────────────────────────

struct SshCreds {
    host: String,
    port: u16,
    username: String,
    auth: SshAuth,
}

fn resolve_ssh_creds(state: &AppState, machine_id: &str) -> Result<SshCreds, CmdError> {
    let conn = state.db.lock().unwrap();
    let profiles = inventory::list_profiles(&conn, machine_id).map_err(CmdError::from)?;
    let profile = profiles
        .into_iter()
        .find(|p| p.protocol == "SSH" || p.protocol == "SFTP")
        .ok_or_else(|| CmdError {
            code: "NO_SSH_PROFILE",
            message: format!("No SSH profile found for machine {machine_id}"),
        })?;

    let cred_id = profile.credential_set_id.as_ref().ok_or_else(|| CmdError {
        code: "NO_CREDENTIAL",
        message: "SSH profile has no credential set".into(),
    })?;

    let cred_sets = inventory::list_credential_sets(&conn).map_err(CmdError::from)?;
    let cred_meta = cred_sets
        .into_iter()
        .find(|s| &s.id == cred_id)
        .ok_or_else(|| CmdError { code: "CRED_NOT_FOUND", message: "Credential not found".into() })?;

    let secret = vault::retrieve(&cred_meta.vault_ref).map_err(CmdError::from)?;
    let (username, auth) = match secret {
        VaultSecret::Password { username, password } => {
            (username, SshAuth::Password(password))
        }
        VaultSecret::SshKey { username, private_key, passphrase } => (
            username,
            SshAuth::PublicKey { private_key_pem: private_key, passphrase },
        ),
        VaultSecret::Totp { .. } => return Err(CmdError {
            code: "INVALID_CREDENTIAL",
            message: "TOTP secrets cannot be used as SSH credentials".into(),
        }),
    };

    Ok(SshCreds { host: profile.host, port: profile.port, username, auth })
}

// ── Run script on machines ────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct ScriptRunDto {
    pub run_id: String,
}

#[derive(Debug, Deserialize)]
pub struct RunScriptInput {
    pub script_id: String,
    pub machine_ids: Vec<String>,
}

#[tauri::command]
pub async fn cmd_run_script(
    state: State<'_, AppState>,
    app: AppHandle,
    input: RunScriptInput,
) -> CmdResult<ScriptRunDto> {
    let actor = require_operator(&state)?;

    let (script, _machine_ids_json, run_id) = {
        let conn = state.db.lock().unwrap();
        let script = scripts::get_script(&conn, &input.script_id).map_err(CmdError::from)?;
        let machine_ids_json = serde_json::to_string(&input.machine_ids)
            .map_err(|e| CmdError { code: "SERIALIZE_ERROR", message: e.to_string() })?;
        let run =
            scripts::create_run(&conn, Some(&input.script_id), &machine_ids_json, &actor.username)
                .map_err(CmdError::from)?;
        (script, machine_ids_json, run.id)
    };

    let interpreter = match script.language.as_str() {
        "powershell" => "powershell.exe -NonInteractive -",
        "bash" => "bash",
        _ => "python3",
    };

    // Resolve creds per machine and build task list
    let mut tasks = Vec::new();
    for machine_id in &input.machine_ids {
        match resolve_ssh_creds(&state, machine_id) {
            Ok(creds) => tasks.push((machine_id.clone(), creds, Ok(()))),
            Err(e) => tasks.push((machine_id.clone(), dummy_creds(), Err(e))),
        }
    }

    // Log audit event
    {
        let conn = state.db.lock().unwrap();
        audit::log(
            &conn,
            &actor.username,
            "SCRIPT_RUN",
            Some(&script.name),
            AuditResult::Ok,
            Some(&format!("{} machines", input.machine_ids.len())),
        )
        .ok();
    }

    let script_body = script.body.clone();

    let app2 = app.clone();
    let run_id2 = run_id.clone();

    tokio::spawn(async move {
        let mut join_set = tokio::task::JoinSet::new();

        for (machine_id, creds, pre_err) in tasks {
            if let Err(e) = pre_err {
                // Immediately write failure output
                app2.emit(
                    &format!("script:output:{}:{}", run_id2, machine_id),
                    ssh::ExecChunk { kind: "stderr".into(), data: e.message.clone() },
                )
                .ok();
                app2.emit(
                    &format!("script:output:{}:{}", run_id2, machine_id),
                    ssh::ExecChunk { kind: "exit".into(), data: "-1".into() },
                )
                .ok();
                continue;
            }

            let body = script_body.clone();
            let interp = interpreter.to_string();
            let run_id_t = run_id2.clone();
            let mid = machine_id.clone();
            let app_t = app2.clone();

            join_set.spawn(async move {
                let event = format!("script:output:{}:{}", run_id_t, mid);
                let result = ssh::run_command(
                    &creds.host,
                    creds.port,
                    &creds.username,
                    creds.auth,
                    &interp,
                    Some(body.as_bytes()),
                    Some(&app_t),
                    Some(&event),
                )
                .await;

                let (stdout, stderr, exit_code) = result.unwrap_or_else(|e| {
                    (String::new(), e.to_string(), -1)
                });

                app_t
                    .emit(
                        &event,
                        ssh::ExecChunk { kind: "exit".into(), data: exit_code.to_string() },
                    )
                    .ok();
                (mid, stdout, stderr, exit_code)
            });
        }

        // Drain tasks — DB persistence is handled by the frontend via cmd_save_run_output
        while join_set.join_next().await.is_some() {}
        app2.emit(&format!("script:run_done:{}", run_id2), ()).ok();
    });

    Ok(ScriptRunDto { run_id })
}

fn dummy_creds() -> SshCreds {
    SshCreds {
        host: String::new(),
        port: 22,
        username: String::new(),
        auth: SshAuth::Password(zeroize::Zeroizing::new(String::new())),
    }
}

// ── Finish a run (called by frontend after all machines done) ─────────────────

#[tauri::command]
pub fn cmd_finish_script_run(state: State<'_, AppState>, run_id: String) -> CmdResult<()> {
    require_operator(&state)?;
    let conn = state.db.lock().unwrap();
    scripts::finish_run(&conn, &run_id).map_err(CmdError::from)
}

/// Save output for one machine of a run (called from frontend after receiving exit chunk)
#[derive(Debug, Deserialize)]
pub struct SaveRunOutputInput {
    pub run_id: String,
    pub machine_id: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

#[tauri::command]
pub fn cmd_save_run_output(
    state: State<'_, AppState>,
    input: SaveRunOutputInput,
) -> CmdResult<()> {
    require_operator(&state)?;
    let conn = state.db.lock().unwrap();
    scripts::upsert_run_output(
        &conn,
        &input.run_id,
        &input.machine_id,
        &input.stdout,
        &input.stderr,
        input.exit_code,
    )
    .map_err(CmdError::from)
}

// ── Bulk exec ─────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BulkExecInput {
    pub machine_ids: Vec<String>,
    pub command: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct BulkExecDto {
    pub job_id: String,
}

#[tauri::command]
pub async fn cmd_bulk_exec(
    state: State<'_, AppState>,
    app: AppHandle,
    input: BulkExecInput,
) -> CmdResult<BulkExecDto> {
    let actor = require_operator(&state)?;
    let job_id = uuid::Uuid::new_v4().to_string();

    // Resolve creds
    let mut tasks: Vec<(String, Result<SshCreds, CmdError>)> = Vec::new();
    for mid in &input.machine_ids {
        tasks.push((mid.clone(), resolve_ssh_creds(&state, mid)));
    }

    {
        let conn = state.db.lock().unwrap();
        audit::log(
            &conn,
            &actor.username,
            "BULK_EXEC",
            None,
            AuditResult::Ok,
            Some(&format!("{} machines", input.machine_ids.len())),
        )
        .ok();
    }

    let command = input.command.clone();
    let job_id2 = job_id.clone();
    let app2 = app.clone();

    tokio::spawn(async move {
        let mut join_set = tokio::task::JoinSet::new();

        for (machine_id, creds_result) in tasks {
            let creds = match creds_result {
                Ok(c) => c,
                Err(e) => {
                    app2.emit(
                        &format!("bulk:output:{}:{}", job_id2, machine_id),
                        ssh::ExecChunk { kind: "stderr".into(), data: e.message },
                    )
                    .ok();
                    app2.emit(
                        &format!("bulk:output:{}:{}", job_id2, machine_id),
                        ssh::ExecChunk { kind: "exit".into(), data: "-1".into() },
                    )
                    .ok();
                    continue;
                }
            };

            let cmd = command.clone();
            let jid = job_id2.clone();
            let mid = machine_id.clone();
            let app_t = app2.clone();

            join_set.spawn(async move {
                let event = format!("bulk:output:{}:{}", jid, mid);
                let result = ssh::run_command(
                    &creds.host,
                    creds.port,
                    &creds.username,
                    creds.auth,
                    &cmd,
                    None,
                    Some(&app_t),
                    Some(&event),
                )
                .await;

                let exit_code = match result {
                    Ok((_, _, code)) => code,
                    Err(e) => {
                        app_t
                            .emit(
                                &event,
                                ssh::ExecChunk { kind: "stderr".into(), data: e.to_string() },
                            )
                            .ok();
                        -1
                    }
                };

                app_t
                    .emit(&event, ssh::ExecChunk { kind: "exit".into(), data: exit_code.to_string() })
                    .ok();
            });
        }

        while join_set.join_next().await.is_some() {}
        app2.emit(&format!("bulk:done:{}", job_id2), ()).ok();
    });

    Ok(BulkExecDto { job_id })
}
