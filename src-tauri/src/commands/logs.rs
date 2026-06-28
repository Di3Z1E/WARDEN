use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::{
    error::{CmdError, CmdResult},
    inventory,
    protocols::ssh::{self, SshAuth},
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
                Err(CmdError { code: "FORBIDDEN", message: "Operator or Admin required".into() })
            }
        })
}

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
        VaultSecret::Password { username, password } => (username, SshAuth::Password(password)),
        VaultSecret::SshKey { username, private_key, passphrase } => {
            (username, SshAuth::PublicKey { private_key_pem: private_key, passphrase })
        }
    };
    Ok(SshCreds { host: profile.host, port: profile.port, username, auth })
}

// ── Event Log (Windows + Linux) ───────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct EventLogEntry {
    pub ts: String,
    pub id: u32,
    pub level: String,
    pub source: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct QueryEventLogInput {
    pub machine_id: String,
    pub platform: String,
    /// Windows: System / Application / Security / Setup. Linux: ignored (journalctl unit filter used instead).
    pub log_name: String,
    /// Windows: "Error" | "Warning" | "Information". Linux: "0"-"7" (syslog priority).
    pub level: Option<String>,
    pub source: Option<String>,
    pub event_id: Option<u32>,
    pub since: Option<String>,
    pub limit: Option<u32>,
}

fn build_win_evtlog_ps(input: &QueryEventLogInput) -> String {
    let limit = input.limit.unwrap_or(100).min(500);
    let log_name = input.log_name.replace('\'', "");

    let mut filter_parts = vec![format!("LogName='{log_name}'")];
    if let Some(ref since) = input.since {
        let safe = since.replace('\'', "");
        filter_parts.push(format!("StartTime='{safe}'"));
    }
    if let Some(id) = input.event_id {
        filter_parts.push(format!("Id={id}"));
    }
    let filter_hash = format!("@{{{}}}", filter_parts.join(";"));

    // Level mapping: Error=2, Warning=3, Information=4
    let level_filter = input.level.as_deref().map(|l| match l {
        "Error" => " | Where-Object {$_.Level -eq 2}",
        "Warning" => " | Where-Object {$_.Level -eq 3}",
        "Information" => " | Where-Object {$_.Level -eq 4}",
        _ => "",
    }).unwrap_or("");

    let source_filter = input.source.as_deref().map(|s| {
        let safe = s.replace('\'', "");
        format!(" | Where-Object {{$_.ProviderName -like '*{safe}*'}}")
    }).unwrap_or_default();

    format!(
        concat!(
            "$evts = Get-WinEvent -FilterHashtable {filter} -MaxEvents {limit} -ErrorAction SilentlyContinue{level}{source};\n",
            "@($evts | Select-Object ",
            "@{{N='ts';E={{$_.TimeCreated.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')}}}},",
            "@{{N='id';E={{$_.Id}}}},",
            "@{{N='level';E={{$_.LevelDisplayName}}}},",
            "@{{N='source';E={{$_.ProviderName}}}},",
            "@{{N='message';E={{$m=$_.Message -replace '\\r?\\n',' ';if($m.Length -gt 500){{$m.Substring(0,500)}}else{{$m}}}}}}) | ConvertTo-Json -Compress"
        ),
        filter = filter_hash,
        limit = limit,
        level = level_filter,
        source = source_filter,
    )
}

fn build_lin_journal_cmd(input: &QueryEventLogInput) -> String {
    let limit = input.limit.unwrap_or(100).min(500);
    let mut jctl_args = format!("journalctl -n {limit} --no-pager --output=json");
    if let Some(ref unit) = input.source {
        let safe = unit.replace(['\'', '"'], "");
        jctl_args.push_str(&format!(" -u '{safe}'"));
    }
    if let Some(ref since) = input.since {
        let safe = since.replace(['\'', '"'], "");
        jctl_args.push_str(&format!(" --since '{safe}'"));
    }
    if let Some(ref level) = input.level {
        // syslog priority: 0=emerg..7=debug; map friendly names
        let prio = match level.as_str() {
            "Error" => "3",
            "Warning" => "4",
            "Information" | "Info" => "6",
            other => other,
        };
        jctl_args.push_str(&format!(" -p {prio}"));
    }
    // Parse NDJSON (one JSON object per line) into an array
    format!(
        r#"{jctl_args} 2>/dev/null | python3 -c "import sys,json;rows=[];[rows.append({{'ts':e.get('_SOURCE_REALTIME_TIMESTAMP',e.get('__REALTIME_TIMESTAMP','')),'id':0,'level':e.get('PRIORITY',''),'source':e.get('SYSLOG_IDENTIFIER',e.get('_COMM','')),'message':(e.get('MESSAGE','') or '')[:500]}}) for l in sys.stdin if l.strip() for e in [json.loads(l)]];print(json.dumps(rows))""#,
        jctl_args = jctl_args,
    )
}

#[tauri::command]
pub async fn cmd_query_event_log(
    state: State<'_, AppState>,
    input: QueryEventLogInput,
) -> CmdResult<Vec<EventLogEntry>> {
    require_operator(&state)?;
    let creds = resolve_ssh_creds(&state, &input.machine_id)?;

    let out = if input.platform == "windows" {
        let ps = build_win_evtlog_ps(&input);
        let (stdout, _, _) = ssh::run_command(
            &creds.host, creds.port, &creds.username, creds.auth,
            "powershell.exe -NonInteractive -",
            Some(ps.as_bytes()),
            None, None,
        ).await.map_err(|e| CmdError { code: "SSH_EXEC", message: e.to_string() })?;
        stdout
    } else {
        let cmd = build_lin_journal_cmd(&input);
        let (stdout, _, _) = ssh::run_command(
            &creds.host, creds.port, &creds.username, creds.auth,
            &cmd,
            None, None, None,
        ).await.map_err(|e| CmdError { code: "SSH_EXEC", message: e.to_string() })?;
        stdout
    };

    serde_json::from_str(out.trim()).map_err(|e| CmdError {
        code: "PARSE",
        message: format!("{e}: {}", &out[..out.len().min(400)]),
    })
}

// ── Log Tail (persistent streaming) ──────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct StartTailResult {
    pub tail_id: String,
    pub event_name: String,
}

// Holds all owned data needed to run the SSH exec inside a 'static tokio task.
struct TailTask {
    host: String,
    port: u16,
    username: String,
    auth: SshAuth,
    command: String,
    stdin_data: Option<Vec<u8>>,
    app: AppHandle,
    event_name: String,
}

impl TailTask {
    async fn run(self) {
        let _ = ssh::run_command(
            &self.host,
            self.port,
            &self.username,
            self.auth,
            &self.command,
            self.stdin_data.as_deref(),
            Some(&self.app),
            Some(&self.event_name),
        )
        .await;
    }
}

#[tauri::command]
pub async fn cmd_start_log_tail(
    state: State<'_, AppState>,
    app: AppHandle,
    machine_id: String,
    path_or_unit: String,
    platform: String,
) -> CmdResult<StartTailResult> {
    require_operator(&state)?;
    let creds = resolve_ssh_creds(&state, &machine_id)?;

    let tail_id = Uuid::new_v4().to_string();
    let event_name = format!("logtail:line:{}", tail_id);

    // Strip single quotes to prevent injection in shell path
    let safe_path: String = path_or_unit.chars().filter(|c| *c != '\'').collect();

    let task = if platform == "windows" {
        let ps = format!("Get-Content -Wait -Tail 0 -Path '{safe_path}' | ForEach-Object {{ Write-Output $_ }}");
        TailTask {
            host: creds.host,
            port: creds.port,
            username: creds.username,
            auth: creds.auth,
            command: "powershell.exe -NonInteractive -".to_string(),
            stdin_data: Some(ps.into_bytes()),
            app: app.clone(),
            event_name: event_name.clone(),
        }
    } else {
        TailTask {
            host: creds.host,
            port: creds.port,
            username: creds.username,
            auth: creds.auth,
            command: format!("tail -F '{safe_path}' 2>&1"),
            stdin_data: None,
            app: app.clone(),
            event_name: event_name.clone(),
        }
    };

    let handle = tokio::spawn(task.run());
    state.tail_tasks.lock().unwrap().insert(tail_id.clone(), handle);

    Ok(StartTailResult { tail_id, event_name })
}

#[tauri::command]
pub async fn cmd_stop_log_tail(
    state: State<'_, AppState>,
    tail_id: String,
) -> CmdResult<()> {
    require_operator(&state)?;
    if let Some(handle) = state.tail_tasks.lock().unwrap().remove(&tail_id) {
        handle.abort();
    }
    Ok(())
}
