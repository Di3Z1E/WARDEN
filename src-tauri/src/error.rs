use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("SSH error: {0}")]
    Ssh(#[from] russh::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Auth failed: {0}")]
    AuthFailed(String),

    #[error("Forbidden: insufficient privileges")]
    Forbidden,

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Vault error: {0}")]
    Vault(String),

    #[error("Serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("{0}")]
    Other(String),
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        AppError::Other(e.to_string())
    }
}

/// Tauri commands must return a serializable error type.
#[derive(Debug, Serialize)]
pub struct CmdError {
    pub code: &'static str,
    pub message: String,
}

impl From<AppError> for CmdError {
    fn from(e: AppError) -> Self {
        let code = match &e {
            AppError::AuthFailed(_) => "AUTH_FAILED",
            AppError::Forbidden => "FORBIDDEN",
            AppError::NotFound(_) => "NOT_FOUND",
            AppError::Vault(_) => "VAULT_ERROR",
            AppError::Db(_) => "DB_ERROR",
            AppError::Ssh(_) => "SSH_ERROR",
            _ => "INTERNAL_ERROR",
        };
        CmdError {
            code,
            message: e.to_string(),
        }
    }
}

pub type CmdResult<T> = Result<T, CmdError>;
