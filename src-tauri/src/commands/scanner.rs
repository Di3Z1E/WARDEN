use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::net::TcpStream;
use tokio::time::timeout;
use uuid::Uuid;

use crate::{
    error::{CmdError, CmdResult},
    AppState,
};

fn require_operator(state: &AppState) -> Result<(), CmdError> {
    state
        .current_user
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| CmdError { code: "UNAUTHENTICATED", message: "Not logged in".into() })?;
    Ok(())
}

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct ScanHost {
    pub ip: String,
    pub open_ports: Vec<u16>,
    pub latency_ms: u64,
}

// ── CIDR parsing ──────────────────────────────────────────────────────────────

fn parse_cidr(cidr: &str) -> anyhow::Result<Vec<Ipv4Addr>> {
    let (addr_str, prefix_str) = cidr.split_once('/').ok_or_else(|| {
        anyhow::anyhow!("Invalid CIDR — expected x.x.x.x/prefix")
    })?;
    let base: Ipv4Addr = addr_str
        .parse()
        .map_err(|_| anyhow::anyhow!("Invalid IP address: {addr_str}"))?;
    let prefix: u32 = prefix_str
        .parse()
        .map_err(|_| anyhow::anyhow!("Invalid prefix length: {prefix_str}"))?;
    if !(8..=30).contains(&prefix) {
        anyhow::bail!("Prefix must be between /8 and /30");
    }
    let host_bits = 32 - prefix;
    let num_hosts = (1u32 << host_bits).saturating_sub(2);
    let base_u32 = u32::from(base);
    let network_u32 = base_u32 & (u32::MAX << host_bits);
    Ok((1..=num_hosts).map(|i| Ipv4Addr::from(network_u32 | i)).collect())
}

// ── Port probe ────────────────────────────────────────────────────────────────

const DEFAULT_PORTS: &[u16] = &[22, 80, 443, 135, 445, 3389, 5900, 8080, 8443];

async fn probe_host(ip: Ipv4Addr, ports: &[u16], timeout_ms: u64) -> Option<ScanHost> {
    let dur = Duration::from_millis(timeout_ms);
    let t0 = Instant::now();

    let mut set = tokio::task::JoinSet::new();
    for &port in ports {
        let addr = SocketAddr::new(IpAddr::V4(ip), port);
        set.spawn(async move {
            timeout(dur, TcpStream::connect(addr))
                .await
                .is_ok_and(|r| r.is_ok())
                .then_some(port)
        });
    }

    let mut open_ports = Vec::new();
    while let Some(res) = set.join_next().await {
        if let Ok(Some(port)) = res {
            open_ports.push(port);
        }
    }

    if open_ports.is_empty() {
        return None;
    }
    open_ports.sort_unstable();
    Some(ScanHost { ip: ip.to_string(), open_ports, latency_ms: t0.elapsed().as_millis() as u64 })
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cmd_scan_subnet(
    state: State<'_, AppState>,
    app: AppHandle,
    cidr: String,
    ports: Option<Vec<u16>>,
    timeout_ms: Option<u64>,
) -> CmdResult<String> {
    require_operator(&state)?;

    let hosts = parse_cidr(&cidr)
        .map_err(|e| CmdError { code: "INVALID_CIDR", message: e.to_string() })?;

    let scan_id = Uuid::new_v4().to_string();
    let ports = ports.unwrap_or_else(|| DEFAULT_PORTS.to_vec());
    let timeout_ms = timeout_ms.unwrap_or(1500);
    let sid = scan_id.clone();

    let handle = tokio::spawn(async move {
        let mut set = tokio::task::JoinSet::new();
        const MAX_CONCURRENT: usize = 50;

        for ip in hosts {
            let p = ports.clone();
            set.spawn(async move { probe_host(ip, &p, timeout_ms).await });

            // Drain whenever we hit the concurrency ceiling
            while set.len() >= MAX_CONCURRENT {
                if let Some(Ok(Some(host))) = set.join_next().await {
                    app.emit(&format!("scanner:result:{sid}"), &host).ok();
                }
            }
        }

        // Drain remaining
        while let Some(res) = set.join_next().await {
            if let Ok(Some(host)) = res {
                app.emit(&format!("scanner:result:{sid}"), &host).ok();
            }
        }

        app.emit(&format!("scanner:done:{sid}"), ()).ok();
    });

    state.scan_tasks.lock().unwrap().insert(scan_id.clone(), handle);
    Ok(scan_id)
}

#[tauri::command]
pub fn cmd_cancel_scan(state: State<'_, AppState>, scan_id: String) -> CmdResult<()> {
    require_operator(&state)?;
    if let Some(handle) = state.scan_tasks.lock().unwrap().remove(&scan_id) {
        handle.abort();
    }
    Ok(())
}
