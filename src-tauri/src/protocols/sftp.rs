use std::sync::Arc;

use async_trait::async_trait;
use russh::client;
use russh_sftp::client::SftpSession;
use serde::Serialize;
use tokio::sync::Mutex;

use crate::protocols::ssh::SshAuth;

// ── SSH handler (TOFU) ────────────────────────────────────────────────────────

pub struct SftpHandler;

#[async_trait]
impl client::Handler for SftpHandler {
    type Error = russh::Error;

    fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKey,
    ) -> impl std::future::Future<Output = Result<bool, Self::Error>> + Send {
        // TODO: verify against known_hosts (TOFU for now)
        std::future::ready(Ok(true))
    }
}

// ── Types ─────────────────────────────────────────────────────────────────────

pub struct SftpConnectParams {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
}

pub struct SftpEntry {
    /// Keep SSH client alive for the duration of the SFTP session.
    pub _ssh: client::Handle<SftpHandler>,
    pub sftp: Arc<Mutex<SftpSession>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DirEntryDto {
    pub name: String,
    pub is_dir: bool,
    pub is_link: bool,
    pub size: Option<u64>,
    pub modified: Option<u64>,
    pub permissions: Option<u32>,
}

// ── Connect ───────────────────────────────────────────────────────────────────

pub async fn connect(params: SftpConnectParams) -> anyhow::Result<SftpEntry> {
    let config = Arc::new(client::Config::default());
    let addr = format!("{}:{}", params.host, params.port);

    let mut handle = client::connect(config, addr.as_str(), SftpHandler)
        .await
        .map_err(|e| anyhow::anyhow!("SSH connect: {}", e))?;

    let authed = match &params.auth {
        SshAuth::Password(pw) => handle
            .authenticate_password(&params.username, pw.as_str())
            .await
            .map_err(|e| anyhow::anyhow!("Auth: {}", e))?,

        SshAuth::PublicKey { private_key_pem, passphrase } => {
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
                .map_err(|e| anyhow::anyhow!("Auth: {}", e))?
        }
    };

    if !authed.success() {
        return Err(anyhow::anyhow!("Authentication failed"));
    }

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| anyhow::anyhow!("Channel open: {}", e))?;

    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| anyhow::anyhow!("SFTP subsystem: {}", e))?;

    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| anyhow::anyhow!("SFTP init: {}", e))?;

    Ok(SftpEntry {
        _ssh: handle,
        sftp: Arc::new(Mutex::new(sftp)),
    })
}

/// Convert Unix permission bits to type flags.
/// 0o040000 = directory, 0o120000 = symlink.
pub fn perms_is_dir(perms: u32) -> bool {
    (perms & 0o170000) == 0o040000
}

pub fn perms_is_link(perms: u32) -> bool {
    (perms & 0o170000) == 0o120000
}
