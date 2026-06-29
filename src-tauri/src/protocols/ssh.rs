//! SSH session engine using russh 0.44.
//!
//! Architecture:
//!   • One tokio task per interactive session.
//!   • SSH → frontend: emits Tauri event "session:data:<id>" with Vec<u8> payload.
//!   • Frontend → SSH: receives bytes through input_tx channel.
//!   • Resize: special prefix b"\x00RESIZE:<cols>:<rows>" on input channel.
//!   • run_command(): non-PTY exec channel for script/bulk-exec use.

use std::sync::Arc;

use async_trait::async_trait;
use russh::client;
use russh::ChannelMsg;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use zeroize::Zeroizing;

use crate::protocols::{data_event, status_event, SessionHandle, SessionProtocol};

// ── One-shot exec result ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct ExecChunk {
    /// "stdout" | "stderr" | "exit"
    pub kind: String,
    pub data: String,
}

/// Open a fresh SSH connection, run `command` (feeding `stdin_data` if provided),
/// and stream output chunks via `tauri::Emitter` event `event_name`.
/// Returns (stdout, stderr, exit_code) for callers that want aggregated results.
#[allow(clippy::too_many_arguments)]
pub async fn run_command(
    host: &str,
    port: u16,
    username: &str,
    auth: SshAuth,
    command: &str,
    stdin_data: Option<&[u8]>,
    app: Option<&AppHandle>,
    event_name: Option<&str>,
) -> anyhow::Result<(String, String, i32)> {
    let config = Arc::new(client::Config::default());
    let addr = format!("{}:{}", host, port);

    let mut handle = client::connect(config, addr.as_str(), SshHandler)
        .await
        .map_err(|e| anyhow::anyhow!("SSH connect: {}", e))?;

    let authed = match auth {
        SshAuth::Password(pw) => handle
            .authenticate_password(username, pw.as_str())
            .await
            .map_err(|e| anyhow::anyhow!("SSH auth: {}", e))?,
        SshAuth::PublicKey { private_key_pem, passphrase } => {
            let key = russh::keys::decode_secret_key(
                private_key_pem.as_str(),
                passphrase.as_deref().map(|s| s.as_str()),
            )
            .map_err(|e| anyhow::anyhow!("Key decode: {}", e))?;
            handle
                .authenticate_publickey(
                    username,
                    russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key), None),
                )
                .await
                .map_err(|e| anyhow::anyhow!("SSH auth: {}", e))?
        }
    };

    if !authed.success() {
        return Err(anyhow::anyhow!("SSH authentication failed"));
    }

    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|e| anyhow::anyhow!("Channel open: {}", e))?;

    channel
        .exec(true, command)
        .await
        .map_err(|e| anyhow::anyhow!("Exec: {}", e))?;

    // Feed stdin (script body) then close the write side
    if let Some(data) = stdin_data {
        channel.data(data).await.ok();
    }
    channel.eof().await.ok();

    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut exit_code: i32 = 0;

    loop {
        match channel.wait().await {
            Some(ChannelMsg::Data { data }) => {
                let chunk = String::from_utf8_lossy(&data).into_owned();
                stdout.push_str(&chunk);
                if let (Some(app), Some(ev)) = (app, event_name) {
                    app.emit(ev, ExecChunk { kind: "stdout".into(), data: chunk }).ok();
                }
            }
            Some(ChannelMsg::ExtendedData { data, .. }) => {
                let chunk = String::from_utf8_lossy(&data).into_owned();
                stderr.push_str(&chunk);
                if let (Some(app), Some(ev)) = (app, event_name) {
                    app.emit(ev, ExecChunk { kind: "stderr".into(), data: chunk }).ok();
                }
            }
            Some(ChannelMsg::ExitStatus { exit_status }) => {
                exit_code = exit_status as i32;
            }
            None => break,
            _ => {}
        }
    }

    Ok((stdout, stderr, exit_code))
}

// ── SSH Client handler ────────────────────────────────────────────────────────

struct SshHandler;

#[async_trait]
impl client::Handler for SshHandler {
    type Error = russh::Error;

    fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKey,
    ) -> impl std::future::Future<Output = Result<bool, Self::Error>> + Send {
        // TODO (NFR-SEC-003): implement TOFU + host key pinning
        std::future::ready(Ok(true))
    }
}

// ── Connection parameters ─────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct SshParams {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
    pub term: String,
    pub cols: u32,
    pub rows: u32,
}

#[derive(Debug, Clone)]
pub enum SshAuth {
    Password(Zeroizing<String>),
    PublicKey {
        private_key_pem: Zeroizing<String>,
        passphrase: Option<Zeroizing<String>>,
    },
}

// ── Session spawner ───────────────────────────────────────────────────────────

pub async fn connect(
    params: SshParams,
    session_id: String,
    app_handle: AppHandle,
) -> anyhow::Result<SessionHandle> {
    let (input_tx, mut input_rx) = mpsc::channel::<Vec<u8>>(256);
    let sid = session_id.clone();
    let ah = app_handle.clone();

    let task = tokio::spawn(async move {
        if let Err(e) = run_session(params, &sid, ah.clone(), &mut input_rx).await {
            log::error!("[SSH {}] session error: {}", sid, e);
        }
        ah.emit(&status_event(&sid), "disconnected").ok();
    });

    Ok(SessionHandle::new(
        session_id,
        SessionProtocol::Ssh,
        input_tx,
        task,
    ))
}

async fn run_session(
    params: SshParams,
    session_id: &str,
    app: AppHandle,
    input_rx: &mut mpsc::Receiver<Vec<u8>>,
) -> anyhow::Result<()> {
    let config = Arc::new(client::Config::default());
    let addr = format!("{}:{}", params.host, params.port);

    // Connect
    let mut handle = client::connect(config, addr.as_str(), SshHandler)
        .await
        .map_err(|e| anyhow::anyhow!("SSH connect: {}", e))?;

    // Authenticate
    let authed = match &params.auth {
        SshAuth::Password(pw) => handle
            .authenticate_password(&params.username, pw.as_str())
            .await
            .map_err(|e| anyhow::anyhow!("SSH auth: {}", e))?,

        SshAuth::PublicKey {
            private_key_pem,
            passphrase,
        } => {
            let key = russh::keys::decode_secret_key(
                private_key_pem.as_str(),
                passphrase.as_deref().map(|s| s.as_str()),
            )
            .map_err(|e| anyhow::anyhow!("Key decode: {}", e))?;
            handle
                .authenticate_publickey(
                    &params.username,
                    russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key), None),
                )
                .await
                .map_err(|e| anyhow::anyhow!("SSH auth: {}", e))?
        }
    };

    if !authed.success() {
        return Err(anyhow::anyhow!("SSH authentication failed"));
    }

    // Open a session channel
    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|e| anyhow::anyhow!("Channel open: {}", e))?;

    // Request PTY
    channel
        .request_pty(false, &params.term, params.cols, params.rows, 0, 0, &[])
        .await
        .map_err(|e| anyhow::anyhow!("PTY request: {}", e))?;

    // Start shell
    channel
        .request_shell(false)
        .await
        .map_err(|e| anyhow::anyhow!("Shell request: {}", e))?;

    app.emit(&status_event(session_id), "connected").ok();

    // Bidirectional I/O loop
    loop {
        tokio::select! {
            // SSH → frontend
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { data }) => {
                        let bytes: Vec<u8> = data.to_vec();
                        app.emit(&data_event(session_id), bytes).ok();
                    }
                    Some(ChannelMsg::ExtendedData { data, .. }) => {
                        // stderr — send it too so the terminal shows it
                        let bytes: Vec<u8> = data.to_vec();
                        app.emit(&data_event(session_id), bytes).ok();
                    }
                    Some(ChannelMsg::ExitStatus { .. }) | None => break,
                    _ => {}
                }
            }
            // Frontend → SSH
            Some(data) = input_rx.recv() => {
                if let Some(rest) = data.strip_prefix(b"\x00RESIZE:") {
                    // Handle resize: \x00RESIZE:<cols>:<rows>
                    if let Ok(s) = std::str::from_utf8(rest) {
                        let mut parts = s.splitn(2, ':');
                        if let (Some(c), Some(r)) = (parts.next(), parts.next()) {
                            if let (Ok(cols), Ok(rows)) = (c.parse::<u32>(), r.parse::<u32>()) {
                                channel.window_change(cols, rows, 0, 0).await.ok();
                            }
                        }
                    }
                } else if let Err(e) = channel.data(data.as_ref()).await {
                    log::warn!("[SSH {}] write error: {}", session_id, e);
                    break;
                }
            }
        }
    }

    Ok(())
}
