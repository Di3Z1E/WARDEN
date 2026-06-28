use serde::Serialize;
use tauri::State;

use crate::{
    error::{CmdError, CmdResult},
    AppState,
};

// ── Ping ──────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct PingResult {
    pub alive: bool,
    pub latency_ms: Option<u32>,
    pub host: String,
}

#[tauri::command]
pub async fn cmd_ping_host(
    state: State<'_, AppState>,
    host: String,
) -> CmdResult<PingResult> {
    {
        let user = state.current_user.lock().unwrap();
        if user.is_none() {
            return Err(CmdError { code: "UNAUTHENTICATED", message: "Not logged in".into() });
        }
    }

    let output = tokio::process::Command::new("ping")
        .args(["-n", "1", "-w", "2000", &host])
        .output()
        .await
        .map_err(|e| CmdError { code: "INTERNAL_ERROR", message: format!("ping exec: {e}") })?;

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let alive = output.status.success() && (stdout.contains("TTL=") || stdout.contains("ttl="));

    let latency_ms = if alive {
        stdout
            .lines()
            .find(|l| l.contains("Average"))
            .and_then(|l| l.split("= ").last())
            .and_then(|s| s.trim_end_matches("ms").trim().parse::<u32>().ok())
    } else {
        None
    };

    Ok(PingResult { alive, latency_ms, host })
}

// ── Network share / UNC path browser ─────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct NetFsEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub modified: Option<i64>,
    pub readonly: bool,
}

#[tauri::command]
pub async fn cmd_net_list_dir(
    state: State<'_, AppState>,
    path: String,
) -> CmdResult<Vec<NetFsEntry>> {
    {
        let user = state.current_user.lock().unwrap();
        if user.is_none() {
            return Err(CmdError { code: "UNAUTHENTICATED", message: "Not logged in".into() });
        }
    }

    let dir_iter = std::fs::read_dir(&path).map_err(|e| CmdError {
        code: "NET_FS_ERROR",
        message: format!("Cannot read '{}': {}", path, e),
    })?;

    let mut entries: Vec<NetFsEntry> = dir_iter
        .flatten()
        .map(|entry| {
            let meta = entry.metadata().ok();
            let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
            let size = meta
                .as_ref()
                .and_then(|m| if m.is_file() { Some(m.len()) } else { None });
            let modified = meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64);
            let readonly = meta
                .as_ref()
                .map(|m| m.permissions().readonly())
                .unwrap_or(false);
            NetFsEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                is_dir,
                size,
                modified,
                readonly,
            }
        })
        .collect();

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

// ── OS credential verification + WARDEN password reset ───────────────────────

#[cfg(target_os = "windows")]
fn verify_windows_creds(username: &str, password: &str) -> bool {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::Security::{
        LogonUserW, LOGON32_LOGON_INTERACTIVE, LOGON32_PROVIDER_DEFAULT,
    };
    use windows::core::PCWSTR;

    let user_w: Vec<u16> = username.encode_utf16().chain(Some(0)).collect();
    let pass_w: Vec<u16> = password.encode_utf16().chain(Some(0)).collect();
    let domain_w: Vec<u16> = ".".encode_utf16().chain(Some(0)).collect();

    let mut token = windows::Win32::Foundation::HANDLE::default();
    let ok = unsafe {
        LogonUserW(
            PCWSTR(user_w.as_ptr()),
            PCWSTR(domain_w.as_ptr()),
            PCWSTR(pass_w.as_ptr()),
            LOGON32_LOGON_INTERACTIVE,
            LOGON32_PROVIDER_DEFAULT,
            &mut token,
        )
    };
    if ok.is_ok() {
        unsafe { let _ = CloseHandle(token); }
        true
    } else {
        false
    }
}

#[cfg(not(target_os = "windows"))]
fn verify_windows_creds(_username: &str, _password: &str) -> bool {
    false
}

#[tauri::command]
pub async fn cmd_verify_os_and_reset_password(
    state: State<'_, AppState>,
    os_username: String,
    os_password: String,
    warden_username: String,
    new_password: String,
) -> CmdResult<()> {
    if new_password.len() < 6 {
        return Err(CmdError {
            code: "VALIDATION_ERROR",
            message: "New password must be at least 6 characters".into(),
        });
    }

    let os_user = os_username.clone();
    let os_pass = os_password.clone();
    let verified = tokio::task::spawn_blocking(move || verify_windows_creds(&os_user, &os_pass))
        .await
        .unwrap_or(false);

    if !verified {
        return Err(CmdError {
            code: "AUTH_FAILED",
            message: "Windows credential verification failed. Check your OS username and password.".into(),
        });
    }

    let new_hash = crate::iam::hash_password(&new_password)
        .map_err(|e| CmdError { code: "INTERNAL_ERROR", message: e.to_string() })?;

    let db = state.db.lock().unwrap();
    let rows = db
        .execute(
            "UPDATE users SET password_hash = ?1, updated_at = datetime('now') \
             WHERE username = ?2 AND role = 'Admin'",
            rusqlite::params![new_hash, warden_username],
        )
        .map_err(|e| CmdError { code: "DB_ERROR", message: e.to_string() })?;

    if rows == 0 {
        return Err(CmdError {
            code: "NOT_FOUND",
            message: format!("Admin user '{}' not found", warden_username),
        });
    }

    Ok(())
}
