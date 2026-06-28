pub mod rdp;
pub mod sftp;
pub mod ssh;
pub mod telnet;

use tokio::sync::mpsc;

/// Opaque handle to a live remote session.
pub struct SessionHandle {
    pub id: String,
    pub protocol: SessionProtocol,
    /// Send raw bytes into the remote session (keyboard input, etc.).
    pub input_tx: mpsc::Sender<Vec<u8>>,
    /// Background task — aborted when this handle is dropped.
    task: tokio::task::JoinHandle<()>,
}

impl Drop for SessionHandle {
    fn drop(&mut self) {
        self.task.abort();
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionProtocol {
    Ssh,
    Telnet,
    Rdp,
    Vnc,
}

impl SessionHandle {
    pub fn new(
        id: String,
        protocol: SessionProtocol,
        input_tx: mpsc::Sender<Vec<u8>>,
        task: tokio::task::JoinHandle<()>,
    ) -> Self {
        Self { id, protocol, input_tx, task }
    }

    pub async fn send_input(&self, data: Vec<u8>) -> anyhow::Result<()> {
        self.input_tx
            .send(data)
            .await
            .map_err(|_| anyhow::anyhow!("Session input channel closed"))?;
        Ok(())
    }
}

/// Tauri event names emitted per session.
pub fn data_event(session_id: &str) -> String {
    format!("session:data:{}", session_id)
}

pub fn status_event(session_id: &str) -> String {
    format!("session:status:{}", session_id)
}
