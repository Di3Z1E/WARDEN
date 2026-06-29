use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;

// ── Machine types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum MachineType {
    WindowsServer,
    WindowsClient,
    Linux,
    EsxiVsphere,
    IpmiIdrac,
    NetworkDevice,
    GenericSsh,
    Generic,
}

impl MachineType {
    pub fn as_str(&self) -> &'static str {
        match self {
            MachineType::WindowsServer => "WindowsServer",
            MachineType::WindowsClient => "WindowsClient",
            MachineType::Linux => "Linux",
            MachineType::EsxiVsphere => "EsxiVsphere",
            MachineType::IpmiIdrac => "IpmiIdrac",
            MachineType::NetworkDevice => "NetworkDevice",
            MachineType::GenericSsh => "GenericSsh",
            MachineType::Generic => "Generic",
        }
    }

    pub fn from_name(s: &str) -> Option<Self> {
        match s {
            "WindowsServer" => Some(MachineType::WindowsServer),
            "WindowsClient" => Some(MachineType::WindowsClient),
            "Linux" => Some(MachineType::Linux),
            "EsxiVsphere" => Some(MachineType::EsxiVsphere),
            "IpmiIdrac" => Some(MachineType::IpmiIdrac),
            "NetworkDevice" => Some(MachineType::NetworkDevice),
            "GenericSsh" => Some(MachineType::GenericSsh),
            "Generic" => Some(MachineType::Generic),
            _ => None,
        }
    }
}

// ── Entities ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub dynamic_filter: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Machine {
    pub id: String,
    pub name: String,
    pub machine_type: MachineType,
    pub folder_id: Option<String>,
    pub tags: Vec<String>,
    pub notes: Option<String>,
    pub last_connected_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionProfile {
    pub id: String,
    pub machine_id: String,
    pub label: String,
    pub protocol: String,
    pub host: String,
    pub port: u16,
    pub options: serde_json::Value,
    pub credential_set_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialSetMeta {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub vault_ref: String,
    pub username: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub expires_at: Option<String>,
}

// ── Folders ───────────────────────────────────────────────────────────────────

pub fn list_folders(conn: &Connection) -> Result<Vec<Folder>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id,parent_id,name,dynamic_filter,created_at FROM folders ORDER BY name",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Folder {
            id: r.get(0)?,
            parent_id: r.get(1)?,
            name: r.get(2)?,
            dynamic_filter: r.get(3)?,
            created_at: r.get(4)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn create_folder(
    conn: &Connection,
    name: &str,
    parent_id: Option<&str>,
) -> Result<Folder, AppError> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO folders(id,parent_id,name,created_at) VALUES(?1,?2,?3,?4)",
        params![id, parent_id, name, now],
    )?;
    Ok(Folder {
        id,
        parent_id: parent_id.map(String::from),
        name: name.to_string(),
        dynamic_filter: None,
        created_at: now,
    })
}

pub fn delete_folder(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM folders WHERE id=?1", params![id])?;
    Ok(())
}

// ── Machines ──────────────────────────────────────────────────────────────────

pub fn list_machines(conn: &Connection) -> Result<Vec<Machine>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id,name,machine_type,folder_id,tags,notes,last_connected_at,created_at,updated_at
         FROM machines ORDER BY name",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, Option<String>>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, Option<String>>(5)?,
            r.get::<_, Option<String>>(6)?,
            r.get::<_, String>(7)?,
            r.get::<_, String>(8)?,
        ))
    })?;

    Ok(rows
        .filter_map(|r| r.ok())
        .filter_map(|(id, name, mt_str, folder_id, tags_json, notes, lca, ca, ua)| {
            let machine_type = MachineType::from_name(&mt_str)?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            Some(Machine {
                id,
                name,
                machine_type,
                folder_id,
                tags,
                notes,
                last_connected_at: lca,
                created_at: ca,
                updated_at: ua,
            })
        })
        .collect())
}

pub fn get_machine(conn: &Connection, id: &str) -> Result<Machine, AppError> {
    conn.query_row(
        "SELECT id,name,machine_type,folder_id,tags,notes,last_connected_at,created_at,updated_at
         FROM machines WHERE id=?1",
        params![id],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, Option<String>>(6)?,
                r.get::<_, String>(7)?,
                r.get::<_, String>(8)?,
            ))
        },
    )
    .map_err(|_| AppError::NotFound(format!("Machine not found: {}", id)))
    .and_then(|(id, name, mt_str, folder_id, tags_json, notes, lca, ca, ua)| {
        let machine_type = MachineType::from_name(&mt_str)
            .ok_or_else(|| AppError::Other("Unknown machine type".into()))?;
        let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
        Ok(Machine {
            id,
            name,
            machine_type,
            folder_id,
            tags,
            notes,
            last_connected_at: lca,
            created_at: ca,
            updated_at: ua,
        })
    })
}

#[derive(Debug, Deserialize)]
pub struct CreateMachineInput {
    pub name: String,
    pub machine_type: String,
    pub folder_id: Option<String>,
    pub tags: Vec<String>,
    pub notes: Option<String>,
}

pub fn create_machine(
    conn: &Connection,
    input: &CreateMachineInput,
) -> Result<Machine, AppError> {
    let mt = MachineType::from_name(&input.machine_type)
        .ok_or_else(|| AppError::Other(format!("Unknown type: {}", input.machine_type)))?;

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let tags_json = serde_json::to_string(&input.tags)?;

    conn.execute(
        "INSERT INTO machines(id,name,machine_type,folder_id,tags,notes,created_at,updated_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?7)",
        params![
            id,
            input.name,
            mt.as_str(),
            input.folder_id,
            tags_json,
            input.notes,
            now
        ],
    )?;

    Ok(Machine {
        id,
        name: input.name.clone(),
        machine_type: mt,
        folder_id: input.folder_id.clone(),
        tags: input.tags.clone(),
        notes: input.notes.clone(),
        last_connected_at: None,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[derive(Debug, Deserialize)]
pub struct UpdateMachineInput {
    pub name: Option<String>,
    pub folder_id: Option<Option<String>>,
    pub tags: Option<Vec<String>>,
    pub notes: Option<Option<String>>,
}

pub fn update_machine(
    conn: &Connection,
    id: &str,
    input: &UpdateMachineInput,
) -> Result<Machine, AppError> {
    let now = Utc::now().to_rfc3339();

    if let Some(ref name) = input.name {
        conn.execute(
            "UPDATE machines SET name=?1, updated_at=?2 WHERE id=?3",
            params![name, now, id],
        )?;
    }
    if let Some(ref folder_id) = input.folder_id {
        conn.execute(
            "UPDATE machines SET folder_id=?1, updated_at=?2 WHERE id=?3",
            params![folder_id.as_deref(), now, id],
        )?;
    }
    if let Some(ref tags) = input.tags {
        let json = serde_json::to_string(tags)?;
        conn.execute(
            "UPDATE machines SET tags=?1, updated_at=?2 WHERE id=?3",
            params![json, now, id],
        )?;
    }
    if let Some(ref notes) = input.notes {
        conn.execute(
            "UPDATE machines SET notes=?1, updated_at=?2 WHERE id=?3",
            params![notes.as_deref(), now, id],
        )?;
    }

    get_machine(conn, id)
}

pub fn delete_machine(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM machines WHERE id=?1", params![id])?;
    Ok(())
}

pub fn touch_machine(conn: &Connection, id: &str) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE machines SET last_connected_at=?1 WHERE id=?2",
        params![now, id],
    )?;
    Ok(())
}

// ── Connection profiles ───────────────────────────────────────────────────────

pub fn list_profiles(
    conn: &Connection,
    machine_id: &str,
) -> Result<Vec<ConnectionProfile>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id,machine_id,label,protocol,host,port,options,credential_set_id,created_at,updated_at
         FROM connection_profiles WHERE machine_id=?1 ORDER BY label",
    )?;
    let rows = stmt.query_map(params![machine_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, i64>(5)?,
            r.get::<_, String>(6)?,
            r.get::<_, Option<String>>(7)?,
            r.get::<_, String>(8)?,
            r.get::<_, String>(9)?,
        ))
    })?;

    Ok(rows
        .filter_map(|r| r.ok())
        .map(|(id, mid, label, proto, host, port, opts_json, cred_id, ca, ua)| {
            let options: serde_json::Value =
                serde_json::from_str(&opts_json).unwrap_or(serde_json::Value::Object(Default::default()));
            ConnectionProfile {
                id,
                machine_id: mid,
                label,
                protocol: proto,
                host,
                port: port as u16,
                options,
                credential_set_id: cred_id,
                created_at: ca,
                updated_at: ua,
            }
        })
        .collect())
}

#[derive(Debug, Deserialize)]
pub struct CreateProfileInput {
    pub machine_id: String,
    pub label: String,
    pub protocol: String,
    pub host: String,
    pub port: u16,
    pub options: Option<serde_json::Value>,
    pub credential_set_id: Option<String>,
}

pub fn create_profile(
    conn: &Connection,
    input: &CreateProfileInput,
) -> Result<ConnectionProfile, AppError> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let opts =
        serde_json::to_string(input.options.as_ref().unwrap_or(&serde_json::Value::Object(Default::default())))?;

    conn.execute(
        "INSERT INTO connection_profiles(id,machine_id,label,protocol,host,port,options,credential_set_id,created_at,updated_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)",
        params![
            id,
            input.machine_id,
            input.label,
            input.protocol,
            input.host,
            input.port as i64,
            opts,
            input.credential_set_id,
            now
        ],
    )?;

    Ok(ConnectionProfile {
        id,
        machine_id: input.machine_id.clone(),
        label: input.label.clone(),
        protocol: input.protocol.clone(),
        host: input.host.clone(),
        port: input.port,
        options: input.options.clone().unwrap_or_default(),
        credential_set_id: input.credential_set_id.clone(),
        created_at: now.clone(),
        updated_at: now,
    })
}

pub fn delete_profile(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM connection_profiles WHERE id=?1", params![id])?;
    Ok(())
}

pub fn update_profile(
    conn: &Connection,
    id: &str,
    input: &CreateProfileInput,
) -> Result<ConnectionProfile, AppError> {
    let now = Utc::now().to_rfc3339();
    let opts = serde_json::to_string(
        input.options.as_ref().unwrap_or(&serde_json::Value::Object(Default::default())),
    )?;
    conn.execute(
        "UPDATE connection_profiles SET label=?1,protocol=?2,host=?3,port=?4,options=?5,credential_set_id=?6,updated_at=?7
         WHERE id=?8",
        params![
            input.label,
            input.protocol,
            input.host,
            input.port as i64,
            opts,
            input.credential_set_id,
            now,
            id
        ],
    )?;

    conn.query_row(
        "SELECT id,machine_id,label,protocol,host,port,options,credential_set_id,created_at,updated_at
         FROM connection_profiles WHERE id=?1",
        params![id],
        |r| {
            Ok(ConnectionProfile {
                id: r.get(0)?,
                machine_id: r.get(1)?,
                label: r.get(2)?,
                protocol: r.get(3)?,
                host: r.get(4)?,
                port: r.get::<_, i64>(5)? as u16,
                options: serde_json::from_str(&r.get::<_, String>(6)?)
                    .unwrap_or_default(),
                credential_set_id: r.get(7)?,
                created_at: r.get(8)?,
                updated_at: r.get(9)?,
            })
        },
    )
    .map_err(AppError::Db)
}

// ── Credential sets (metadata only) ──────────────────────────────────────────

pub fn list_credential_sets(conn: &Connection) -> Result<Vec<CredentialSetMeta>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id,name,kind,vault_ref,username,created_at,updated_at,expires_at
         FROM credential_sets ORDER BY name",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(CredentialSetMeta {
            id: r.get(0)?,
            name: r.get(1)?,
            kind: r.get(2)?,
            vault_ref: r.get(3)?,
            username: r.get(4)?,
            created_at: r.get(5)?,
            updated_at: r.get(6)?,
            expires_at: r.get(7)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn create_credential_set(
    conn: &Connection,
    name: &str,
    kind: &str,
    vault_ref: &str,
    username: Option<&str>,
) -> Result<CredentialSetMeta, AppError> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO credential_sets(id,name,kind,vault_ref,username,created_at,updated_at)
         VALUES(?1,?2,?3,?4,?5,?6,?6)",
        params![id, name, kind, vault_ref, username, now],
    )?;
    Ok(CredentialSetMeta {
        id,
        name: name.to_string(),
        kind: kind.to_string(),
        vault_ref: vault_ref.to_string(),
        username: username.map(String::from),
        created_at: now.clone(),
        updated_at: now,
        expires_at: None,
    })
}

pub fn set_credential_expiry(
    conn: &Connection,
    id: &str,
    expires_at: Option<&str>,
) -> Result<(), AppError> {
    conn.execute(
        "UPDATE credential_sets SET expires_at=?1, updated_at=datetime('now') WHERE id=?2",
        params![expires_at, id],
    )?;
    Ok(())
}

pub fn get_expiring_credentials(
    conn: &Connection,
    days: i64,
) -> Result<Vec<CredentialSetMeta>, AppError> {
    let threshold = format!("+{days} days");
    let mut stmt = conn.prepare(
        "SELECT id,name,kind,vault_ref,username,created_at,updated_at,expires_at
         FROM credential_sets
         WHERE expires_at IS NOT NULL AND date(expires_at) <= date('now', ?1)
         ORDER BY expires_at ASC",
    )?;
    let rows = stmt.query_map(params![threshold], |r| {
        Ok(CredentialSetMeta {
            id: r.get(0)?,
            name: r.get(1)?,
            kind: r.get(2)?,
            vault_ref: r.get(3)?,
            username: r.get(4)?,
            created_at: r.get(5)?,
            updated_at: r.get(6)?,
            expires_at: r.get(7)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn delete_credential_set(conn: &Connection, id: &str) -> Result<String, AppError> {
    let vault_ref: String = conn
        .query_row(
            "SELECT vault_ref FROM credential_sets WHERE id=?1",
            params![id],
            |r| r.get(0),
        )
        .map_err(|_| AppError::NotFound(format!("CredentialSet not found: {}", id)))?;

    conn.execute("DELETE FROM credential_sets WHERE id=?1", params![id])?;
    Ok(vault_ref)
}
