//! Power & out-of-band management.
//! FR-PWR-001: Wake-on-LAN magic packet (P0)
//! FR-PWR-003: OOB via Redfish/IPMI (P1 stubs)

use std::net::{SocketAddr, UdpSocket};

use serde::{Deserialize, Serialize};

use crate::error::AppError;

// ── Wake-on-LAN ───────────────────────────────────────────────────────────────

/// Send a WoL magic packet to the given MAC address via UDP broadcast on port 9.
pub fn wake_on_lan(mac: &str, broadcast: Option<&str>) -> Result<(), AppError> {
    let mac_bytes = parse_mac(mac)?;
    let packet = build_magic_packet(&mac_bytes);

    let broadcast_addr: SocketAddr = format!("{}:9", broadcast.unwrap_or("255.255.255.255"))
        .parse()
        .map_err(|e| AppError::Other(format!("Invalid broadcast address: {}", e)))?;

    let socket = UdpSocket::bind("0.0.0.0:0")
        .map_err(|e| AppError::Io(e))?;
    socket
        .set_broadcast(true)
        .map_err(|e| AppError::Io(e))?;
    socket
        .send_to(&packet, broadcast_addr)
        .map_err(|e| AppError::Io(e))?;

    log::info!("WoL magic packet sent to MAC {} via {}", mac, broadcast_addr);
    Ok(())
}

fn parse_mac(mac: &str) -> Result<[u8; 6], AppError> {
    let hex_parts: Vec<&str> = mac.split(|c| c == ':' || c == '-').collect();
    if hex_parts.len() != 6 {
        return Err(AppError::Other(format!("Invalid MAC address: {}", mac)));
    }
    let mut bytes = [0u8; 6];
    for (i, part) in hex_parts.iter().enumerate() {
        bytes[i] = u8::from_str_radix(part, 16)
            .map_err(|_| AppError::Other(format!("Invalid MAC octet: {}", part)))?;
    }
    Ok(bytes)
}

fn build_magic_packet(mac: &[u8; 6]) -> Vec<u8> {
    let mut packet = Vec::with_capacity(102);
    packet.extend_from_slice(&[0xFF; 6]);
    for _ in 0..16 {
        packet.extend_from_slice(mac);
    }
    packet
}

// ── OOB / Redfish (P1 stubs) ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PowerAction {
    On,
    Off,
    ForceOff,
    Restart,
    ForceRestart,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OobProvider {
    Redfish { base_url: String },
    Ipmi { host: String, port: u16 },
    Idrac { host: String },
    Vsphere { host: String, vm_id: String },
}

/// Execute an OOB power action (stub — returns error until implemented).
pub async fn oob_power(
    _provider: OobProvider,
    _action: PowerAction,
    _username: &str,
    _password: &str,
) -> Result<(), AppError> {
    Err(AppError::Other(
        "OOB power control not yet implemented (P1 feature)".into(),
    ))
}
