use anyhow::Result;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;

use crate::protocols::{data_event, status_event, SessionHandle, SessionProtocol};

pub struct TelnetParams {
    pub host: String,
    pub port: u32,
}

// Process incoming telnet bytes: strip IAC negotiation, queue responses for server.
fn process_telnet(input: &[u8], responses: &mut Vec<u8>) -> Vec<u8> {
    const IAC: u8 = 0xFF;
    const WILL: u8 = 0xFB;
    const WONT: u8 = 0xFC;
    const DO: u8 = 0xFD;
    const DONT: u8 = 0xFE;
    const SB: u8 = 0xFA;
    const SE: u8 = 0xF0;

    let mut out = Vec::with_capacity(input.len());
    let mut i = 0;

    while i < input.len() {
        if input[i] != IAC {
            out.push(input[i]);
            i += 1;
            continue;
        }

        i += 1; // skip IAC
        if i >= input.len() {
            break;
        }

        match input[i] {
            IAC => {
                // Escaped 0xFF literal
                out.push(IAC);
                i += 1;
            }
            WILL => {
                i += 1;
                if i < input.len() {
                    // Reject all server WILLs with DON'T
                    responses.extend_from_slice(&[IAC, DONT, input[i]]);
                    i += 1;
                }
            }
            DO => {
                i += 1;
                if i < input.len() {
                    // Reject all server DOs with WON'T
                    responses.extend_from_slice(&[IAC, WONT, input[i]]);
                    i += 1;
                }
            }
            WONT | DONT => {
                i += 1; // skip option byte, no response needed
                if i < input.len() {
                    i += 1;
                }
            }
            SB => {
                // Skip subnegotiation: IAC SB <opt> <data…> IAC SE
                i += 1;
                while i + 1 < input.len() {
                    if input[i] == IAC && input[i + 1] == SE {
                        i += 2;
                        break;
                    }
                    i += 1;
                }
            }
            _ => {
                i += 1; // skip unknown command byte
            }
        }
    }

    out
}

pub async fn connect(
    params: TelnetParams,
    session_id: String,
    app: AppHandle,
) -> Result<SessionHandle> {
    let addr = format!("{}:{}", params.host, params.port);
    let stream = TcpStream::connect(&addr).await?;
    let (mut reader, mut writer) = tokio::io::split(stream);

    let (input_tx, mut input_rx) = mpsc::channel::<Vec<u8>>(256);

    let sid = session_id.clone();
    let app_clone = app.clone();

    let task = tokio::spawn(async move {
        let mut buf = [0u8; 4096];

        loop {
            tokio::select! {
                result = reader.read(&mut buf) => {
                    match result {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            let raw = &buf[..n];
                            let mut iac_resp = Vec::new();
                            let clean = process_telnet(raw, &mut iac_resp);

                            // Send IAC negotiation responses back to server
                            if !iac_resp.is_empty() {
                                let _ = writer.write_all(&iac_resp).await;
                            }

                            if !clean.is_empty() {
                                let _ = app_clone.emit(&data_event(&sid), clean);
                            }
                        }
                    }
                }
                msg = input_rx.recv() => {
                    match msg {
                        None => break,
                        Some(data) => {
                            if writer.write_all(&data).await.is_err() {
                                break;
                            }
                        }
                    }
                }
            }
        }

        let _ = app_clone.emit(&status_event(&sid), "disconnected");
    });

    Ok(SessionHandle::new(session_id, SessionProtocol::Telnet, input_tx, task))
}
