use serde::{Deserialize, Serialize};
use tauri::State;

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
        VaultSecret::Totp { .. } => return Err(CmdError {
            code: "INVALID_CREDENTIAL",
            message: "TOTP secrets cannot be used as SSH credentials".into(),
        }),
    };
    Ok(SshCreds { host: profile.host, port: profile.port, username, auth })
}

// Run a command over SSH and return stdout. For PowerShell commands, send via stdin.
async fn exec_cmd(creds: SshCreds, cmd: &str, stdin: Option<&[u8]>) -> Result<String, CmdError> {
    let (stdout, _, _) = ssh::run_command(
        &creds.host,
        creds.port,
        &creds.username,
        creds.auth,
        cmd,
        stdin,
        None,
        None,
    )
    .await
    .map_err(|e| CmdError { code: "SSH_EXEC", message: e.to_string() })?;
    Ok(stdout)
}

// ── Metrics ───────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct MetricsSnapshot {
    pub cpu_pct: f32,
    pub mem_total_mb: u64,
    pub mem_free_mb: u64,
}

#[derive(Deserialize)]
struct MetricsRaw {
    cpu_pct: f32,
    mem_total_mb: u64,
    mem_free_mb: u64,
}

// PowerShell piped via stdin
const WIN_METRICS_PS: &str = concat!(
    "$cpu=[math]::Round(((Get-CimInstance Win32_Processor)|Measure-Object LoadPercentage -Average).Average,0);",
    "$o=Get-CimInstance Win32_OperatingSystem;",
    "@{cpu_pct=$cpu;mem_total_mb=[math]::Round($o.TotalVisibleMemorySize/1024);",
    "mem_free_mb=[math]::Round($o.FreePhysicalMemory/1024)}|ConvertTo-Json -Compress"
);

// Python one-liner: two /proc/stat readings 300 ms apart → accurate idle delta
const LIN_METRICS_CMD: &str = concat!(
    r#"python3 -c "import json,time;"#,
    r#"s1=list(map(int,open('/proc/stat').readline().split()[1:]));"#,
    r#"time.sleep(0.3);"#,
    r#"s2=list(map(int,open('/proc/stat').readline().split()[1:]));"#,
    r#"d=[b-a for a,b in zip(s1,s2)];"#,
    r#"idle=d[3]+(d[4] if len(d)>4 else 0);"#,
    r#"cpu=round((sum(d)-idle)*100/max(sum(d),1),1);"#,
    r#"lines=open('/proc/meminfo').readlines();"#,
    r#"m={l.split(':')[0]:int(l.split()[1]) for l in lines};"#,
    r#"print(json.dumps({'cpu_pct':cpu,'mem_total_mb':m['MemTotal']//1024,'mem_free_mb':m['MemAvailable']//1024}))""#
);

#[tauri::command]
pub async fn cmd_poll_metrics(
    state: State<'_, AppState>,
    machine_id: String,
    platform: String,
) -> CmdResult<MetricsSnapshot> {
    require_operator(&state)?;
    let creds = resolve_ssh_creds(&state, &machine_id)?;
    let out = if platform == "windows" {
        exec_cmd(creds, "powershell.exe -NonInteractive -", Some(WIN_METRICS_PS.as_bytes())).await?
    } else {
        exec_cmd(creds, LIN_METRICS_CMD, None).await?
    };
    let raw: MetricsRaw = serde_json::from_str(out.trim())
        .map_err(|e| CmdError { code: "PARSE", message: format!("{e}: {}", out.trim()) })?;
    Ok(MetricsSnapshot {
        cpu_pct: raw.cpu_pct,
        mem_total_mb: raw.mem_total_mb,
        mem_free_mb: raw.mem_free_mb,
    })
}

// ── Processes ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu_val: f32,
    pub mem_mb: f32,
}

// cpu_val = total CPU seconds on Windows (sort descending = busiest processes)
const WIN_PROCS_PS: &str = concat!(
    r#"@(Get-Process | Select-Object "#,
    r#"@{N='pid';E={$_.Id}},@{N='name';E={$_.ProcessName}},"#,
    r#"@{N='cpu_val';E={[math]::Round([double]($_.CPU),1)}},"#,
    r#"@{N='mem_mb';E={[math]::Round($_.WorkingSet/1MB,1)}} | "#,
    r#"Sort-Object mem_mb -Descending | Select-Object -First 60) | ConvertTo-Json -Compress"#
);

// cpu_val = % since process start on Linux
const LIN_PROCS_CMD: &str = concat!(
    r#"python3 -c "import subprocess,json;"#,
    r#"o=subprocess.check_output(['ps','-eo','pid,comm,%cpu,rss','--sort=-%cpu','--no-headers'],text=True);"#,
    r#"rows=[{'pid':int(p[0]),'name':p[1],'cpu_val':float(p[2]),'mem_mb':round(int(p[3])/1024,1)}"#,
    r#" for l in o.strip().split('\n') if l for p in [l.split(None,3)] if len(p)>=4];"#,
    r#"print(json.dumps(rows[:60]))""#
);

#[tauri::command]
pub async fn cmd_list_processes(
    state: State<'_, AppState>,
    machine_id: String,
    platform: String,
) -> CmdResult<Vec<ProcessInfo>> {
    require_operator(&state)?;
    let creds = resolve_ssh_creds(&state, &machine_id)?;
    let out = if platform == "windows" {
        exec_cmd(creds, "powershell.exe -NonInteractive -", Some(WIN_PROCS_PS.as_bytes())).await?
    } else {
        exec_cmd(creds, LIN_PROCS_CMD, None).await?
    };
    serde_json::from_str(out.trim()).map_err(|e| CmdError {
        code: "PARSE",
        message: format!("{e}: {}", &out[..out.len().min(400)]),
    })
}

#[tauri::command]
pub async fn cmd_kill_process(
    state: State<'_, AppState>,
    machine_id: String,
    pid: u32,
    platform: String,
) -> CmdResult<()> {
    require_operator(&state)?;
    let creds = resolve_ssh_creds(&state, &machine_id)?;
    if platform == "windows" {
        let ps = format!("Stop-Process -Id {} -Force", pid);
        exec_cmd(creds, "powershell.exe -NonInteractive -", Some(ps.as_bytes())).await?;
    } else {
        exec_cmd(creds, &format!("kill -9 {}", pid), None).await?;
    }
    Ok(())
}

// ── Services ──────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct ServiceInfo {
    pub name: String,
    pub display_name: String,
    pub status: String,
    pub start_type: String,
}

const WIN_SVCS_PS: &str = concat!(
    r#"@(Get-Service | Select-Object "#,
    r#"@{N='name';E={$_.Name}},@{N='display_name';E={$_.DisplayName}},"#,
    r#"@{N='status';E={$_.Status.ToString()}},"#,
    r#"@{N='start_type';E={$_.StartType.ToString()}}) | ConvertTo-Json -Compress"#
);

// systemctl list-units — columns: UNIT, LOAD, ACTIVE, SUB, DESCRIPTION
const LIN_SVCS_CMD: &str = concat!(
    r#"python3 -c "import subprocess,json;"#,
    r#"o=subprocess.check_output(['systemctl','list-units','--type=service','--no-legend','--no-pager','--plain'],text=True,stderr=subprocess.DEVNULL);"#,
    r#"rows=[{'name':p[0][:-8] if p[0].endswith('.service') else p[0],'display_name':' '.join(p[4:]) if len(p)>4 else p[0],'status':p[2],'start_type':p[1]}"#,
    r#" for l in o.strip().split('\n') if l for p in [l.split()] if len(p)>=4];"#,
    r#"print(json.dumps(rows))""#
);

#[tauri::command]
pub async fn cmd_list_services(
    state: State<'_, AppState>,
    machine_id: String,
    platform: String,
) -> CmdResult<Vec<ServiceInfo>> {
    require_operator(&state)?;
    let creds = resolve_ssh_creds(&state, &machine_id)?;
    let out = if platform == "windows" {
        exec_cmd(creds, "powershell.exe -NonInteractive -", Some(WIN_SVCS_PS.as_bytes())).await?
    } else {
        exec_cmd(creds, LIN_SVCS_CMD, None).await?
    };
    serde_json::from_str(out.trim()).map_err(|e| CmdError {
        code: "PARSE",
        message: format!("{e}: {}", &out[..out.len().min(400)]),
    })
}

#[tauri::command]
pub async fn cmd_control_service(
    state: State<'_, AppState>,
    machine_id: String,
    name: String,
    action: String,
    platform: String,
) -> CmdResult<()> {
    require_operator(&state)?;
    if !["start", "stop", "restart"].contains(&action.as_str()) {
        return Err(CmdError {
            code: "INVALID_ACTION",
            message: "action must be start|stop|restart".into(),
        });
    }
    let creds = resolve_ssh_creds(&state, &machine_id)?;
    // Strip characters that aren't safe for service names
    let safe: String = name
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | ' '))
        .collect();
    if platform == "windows" {
        let ps = match action.as_str() {
            "start" => format!("Start-Service -Name '{safe}'"),
            "stop" => format!("Stop-Service -Name '{safe}' -Force"),
            _ => format!("Restart-Service -Name '{safe}' -Force"),
        };
        exec_cmd(creds, "powershell.exe -NonInteractive -", Some(ps.as_bytes())).await?;
    } else {
        exec_cmd(creds, &format!("sudo systemctl {} '{safe}'", action), None).await?;
    }
    Ok(())
}
