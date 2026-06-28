use std::time::Instant;

use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration};
use uuid::Uuid;

use crate::error::AppError;
use crate::inventory;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorEvent {
    pub id: String,
    pub machine_id: String,
    pub ts: String,
    pub state: String, // "up" | "down"
    pub latency_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorRule {
    pub machine_id: String,
    pub check_interval_secs: i64,
    pub enabled: bool,
    pub notify_desktop: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LivenessResult {
    pub machine_id: String,
    pub is_up: bool,
    pub latency_ms: Option<i64>,
    pub checked_at: String,
    pub host: String,
    pub port: u16,
}

// ── TCP connectivity check ────────────────────────────────────────────────────

pub async fn check_tcp(host: &str, port: u16, timeout_secs: u64) -> (bool, Option<i64>) {
    let addr = format!("{}:{}", host, port);
    let start = Instant::now();
    match timeout(Duration::from_secs(timeout_secs), TcpStream::connect(&addr)).await {
        Ok(Ok(_)) => (true, Some(start.elapsed().as_millis() as i64)),
        _ => (false, None),
    }
}

/// Pick the best host:port to probe for a machine (SSH > RDP > any).
pub fn resolve_check_target(conn: &Connection, machine_id: &str) -> Option<(String, u16)> {
    let mut profiles = inventory::list_profiles(conn, machine_id).ok()?;
    profiles.sort_by_key(|p| match p.protocol.as_str() {
        "SSH" | "SFTP" => 0,
        "RDP" => 1,
        _ => 2,
    });
    profiles.into_iter().next().map(|p| (p.host, p.port))
}

// ── DB helpers ────────────────────────────────────────────────────────────────

pub fn get_recent_events(
    conn: &Connection,
    machine_id: &str,
    limit: i64,
) -> Result<Vec<MonitorEvent>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, machine_id, ts, state, latency_ms
         FROM monitor_events WHERE machine_id=?1 ORDER BY ts DESC LIMIT ?2",
    )?;
    let mut events: Vec<MonitorEvent> = stmt
        .query_map(params![machine_id, limit], |r| {
            Ok(MonitorEvent {
                id: r.get(0)?,
                machine_id: r.get(1)?,
                ts: r.get(2)?,
                state: r.get(3)?,
                latency_ms: r.get(4)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    events.reverse(); // oldest-first for sparkline
    Ok(events)
}

pub fn get_latest_state(conn: &Connection, machine_id: &str) -> Option<String> {
    conn.query_row(
        "SELECT state FROM monitor_events WHERE machine_id=?1 ORDER BY ts DESC LIMIT 1",
        params![machine_id],
        |r| r.get(0),
    )
    .ok()
}

pub fn record_event(
    conn: &Connection,
    machine_id: &str,
    is_up: bool,
    latency_ms: Option<i64>,
) -> Result<(), AppError> {
    let id = Uuid::new_v4().to_string();
    let ts = Utc::now().to_rfc3339();
    let state = if is_up { "up" } else { "down" };
    conn.execute(
        "INSERT INTO monitor_events(id,machine_id,ts,state,latency_ms) VALUES(?1,?2,?3,?4,?5)",
        params![id, machine_id, ts, state, latency_ms],
    )?;
    Ok(())
}

pub fn get_all_latest_statuses(conn: &Connection) -> Result<Vec<MonitorEvent>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT me.id, me.machine_id, me.ts, me.state, me.latency_ms
         FROM monitor_events me
         INNER JOIN (
             SELECT machine_id, MAX(ts) AS max_ts FROM monitor_events GROUP BY machine_id
         ) latest ON me.machine_id = latest.machine_id AND me.ts = latest.max_ts",
    )?;
    let events = stmt
        .query_map([], |r| {
            Ok(MonitorEvent {
                id: r.get(0)?,
                machine_id: r.get(1)?,
                ts: r.get(2)?,
                state: r.get(3)?,
                latency_ms: r.get(4)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(events)
}

pub fn get_rule(conn: &Connection, machine_id: &str) -> Result<Option<MonitorRule>, AppError> {
    match conn.query_row(
        "SELECT machine_id, check_interval_secs, enabled, notify_desktop, created_at
         FROM monitor_rules WHERE machine_id=?1 LIMIT 1",
        params![machine_id],
        |r| {
            Ok(MonitorRule {
                machine_id: r.get(0)?,
                check_interval_secs: r.get(1)?,
                enabled: r.get::<_, i64>(2)? != 0,
                notify_desktop: r.get::<_, i64>(3)? != 0,
                created_at: r.get(4)?,
            })
        },
    ) {
        Ok(r) => Ok(Some(r)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Db(e)),
    }
}

pub fn upsert_rule(
    conn: &Connection,
    machine_id: &str,
    enabled: bool,
    notify_desktop: bool,
    interval_secs: i64,
) -> Result<MonitorRule, AppError> {
    let now = Utc::now().to_rfc3339();
    let existing_id: Option<String> = conn
        .query_row(
            "SELECT id FROM monitor_rules WHERE machine_id=?1 LIMIT 1",
            params![machine_id],
            |r| r.get(0),
        )
        .ok();

    if let Some(rule_id) = existing_id {
        conn.execute(
            "UPDATE monitor_rules SET enabled=?1, notify_desktop=?2, check_interval_secs=?3 WHERE id=?4",
            params![enabled as i64, notify_desktop as i64, interval_secs, rule_id],
        )?;
    } else {
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO monitor_rules(id,machine_id,check_interval_secs,consecutive_failures_threshold,enabled,notify_desktop,created_at)
             VALUES(?1,?2,?3,3,?4,?5,?6)",
            params![id, machine_id, interval_secs, enabled as i64, notify_desktop as i64, now],
        )?;
    }

    get_rule(conn, machine_id)?.ok_or_else(|| AppError::Other("Rule not found after upsert".into()))
}

// ── Ansible YAML export ───────────────────────────────────────────────────────

pub fn export_ansible_inventory(conn: &Connection) -> Result<String, AppError> {
    let machines = inventory::list_machines(conn)?;
    let mut yaml = String::from("---\nall:\n  children:\n");

    let groups: &[(&str, &[&str])] = &[
        ("windows_servers", &["WindowsServer"]),
        ("windows_clients", &["WindowsClient"]),
        ("linux", &["Linux"]),
        ("esxi_vsphere", &["EsxiVsphere"]),
        ("ipmi_idrac", &["IpmiIdrac"]),
        ("network_devices", &["NetworkDevice"]),
        ("generic", &["GenericSsh", "Generic"]),
    ];

    for (group_name, types) in groups {
        let members: Vec<_> = machines
            .iter()
            .filter(|m| types.contains(&m.machine_type.as_str()))
            .collect();
        if members.is_empty() {
            continue;
        }

        yaml.push_str(&format!("    {}:\n      hosts:\n", group_name));
        for machine in members {
            let profiles = inventory::list_profiles(conn, &machine.id).unwrap_or_default();
            let ssh = profiles.iter().find(|p| p.protocol == "SSH" || p.protocol == "SFTP");
            let best = ssh.or_else(|| profiles.first());

            let host = best.map(|p| p.host.as_str()).unwrap_or("unknown");
            let port = best.map(|p| p.port).unwrap_or(22);

            // YAML-safe key: lowercase, only alphanumeric + underscore
            let key: String = machine
                .name
                .chars()
                .map(|c| if c.is_alphanumeric() { c.to_ascii_lowercase() } else { '_' })
                .collect();

            yaml.push_str(&format!("        {}:\n", key));
            yaml.push_str(&format!("          ansible_host: {}\n", host));
            yaml.push_str(&format!("          ansible_port: {}\n", port));
            if let Some(notes) = &machine.notes {
                if !notes.is_empty() {
                    let safe = notes.replace('"', "'").replace('\n', " ");
                    yaml.push_str(&format!("          # {}\n", safe));
                }
            }
        }
    }

    Ok(yaml)
}
