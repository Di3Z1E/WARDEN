use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::error::AppError;

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Role {
    Admin,
    Operator,
    Auditor,
    ReadOnly,
}

impl Role {
    pub fn as_str(&self) -> &'static str {
        match self {
            Role::Admin => "Admin",
            Role::Operator => "Operator",
            Role::Auditor => "Auditor",
            Role::ReadOnly => "ReadOnly",
        }
    }

    pub fn from_name(s: &str) -> Option<Self> {
        match s {
            "Admin" => Some(Role::Admin),
            "Operator" => Some(Role::Operator),
            "Auditor" => Some(Role::Auditor),
            "ReadOnly" => Some(Role::ReadOnly),
            _ => None,
        }
    }

    /// Returns true if this role can perform admin-level operations.
    pub fn is_admin(&self) -> bool {
        matches!(self, Role::Admin)
    }

    /// Returns true if this role can open sessions.
    pub fn can_connect(&self) -> bool {
        matches!(self, Role::Admin | Role::Operator)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppUser {
    pub id: String,
    pub username: String,
    pub role: Role,
    pub mfa_secret_ref: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Lightweight session token stored in AppState — never serialized to disk.
#[derive(Debug, Clone)]
pub struct AuthenticatedUser {
    pub id: String,
    pub username: String,
    pub role: Role,
}

// ── Password hashing ─────────────────────────────────────────────────────────

pub fn hash_password(password: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(hash.to_string())
}

pub fn verify_password(password: &str, hash: &str) -> Result<bool, AppError> {
    let parsed = PasswordHash::new(hash).map_err(|e| AppError::Other(e.to_string()))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

pub fn create_user(
    conn: &Connection,
    username: &str,
    password: &str,
    role: Role,
) -> Result<AppUser, AppError> {
    let secret = Zeroizing::new(password.to_string());
    let hash = hash_password(&secret)?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO app_users(id,username,password_hash,role,status,created_at,updated_at)
         VALUES(?1,?2,?3,?4,'active',?5,?5)",
        params![id, username, hash, role.as_str(), now],
    )
    .map_err(|e| match e {
        rusqlite::Error::SqliteFailure(ref fe, _)
            if fe.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            AppError::Other(format!("Username '{}' already exists", username))
        }
        other => AppError::Db(other),
    })?;

    Ok(AppUser {
        id,
        username: username.to_string(),
        role,
        mfa_secret_ref: None,
        status: "active".to_string(),
        created_at: now.clone(),
        updated_at: now,
    })
}

pub fn authenticate(
    conn: &Connection,
    username: &str,
    password: &str,
) -> Result<AuthenticatedUser, AppError> {
    let row = conn
        .query_row(
            "SELECT id, username, password_hash, role, status
             FROM app_users WHERE username=?1",
            params![username],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                ))
            },
        )
        .map_err(|_| AppError::AuthFailed("Invalid username or password".into()))?;

    let (id, uname, hash, role_str, status) = row;

    if status != "active" {
        return Err(AppError::AuthFailed("Account is disabled".into()));
    }

    if !verify_password(password, &hash)? {
        return Err(AppError::AuthFailed("Invalid username or password".into()));
    }

    let role = Role::from_name(&role_str)
        .ok_or_else(|| AppError::Other(format!("Unknown role: {}", role_str)))?;

    Ok(AuthenticatedUser {
        id,
        username: uname,
        role,
    })
}

pub fn list_users(conn: &Connection) -> Result<Vec<AppUser>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id,username,role,mfa_secret_ref,status,created_at,updated_at
         FROM app_users ORDER BY username",
    )?;
    let users = stmt
        .query_map([], |r| {
            let role_str: String = r.get(2)?;
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                role_str,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
            ))
        })?
        .filter_map(|row| {
            row.ok().and_then(|(id, username, role_str, mfa, status, ca, ua)| {
                Role::from_name(&role_str).map(|role| AppUser {
                    id,
                    username,
                    role,
                    mfa_secret_ref: mfa,
                    status,
                    created_at: ca,
                    updated_at: ua,
                })
            })
        })
        .collect();
    Ok(users)
}

pub fn get_user_by_id(conn: &Connection, id: &str) -> Result<AppUser, AppError> {
    conn.query_row(
        "SELECT id,username,role,mfa_secret_ref,status,created_at,updated_at
         FROM app_users WHERE id=?1",
        params![id],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
            ))
        },
    )
    .map_err(|_| AppError::NotFound(format!("User not found: {}", id)))
    .and_then(|(id, username, role_str, mfa, status, ca, ua)| {
        Role::from_name(&role_str)
            .ok_or_else(|| AppError::Other("Unknown role".into()))
            .map(|role| AppUser {
                id,
                username,
                role,
                mfa_secret_ref: mfa,
                status,
                created_at: ca,
                updated_at: ua,
            })
    })
}

pub fn update_user_role(
    conn: &Connection,
    id: &str,
    role: Role,
) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let affected = conn.execute(
        "UPDATE app_users SET role=?1, updated_at=?2 WHERE id=?3",
        params![role.as_str(), now, id],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("User not found: {}", id)));
    }
    Ok(())
}

pub fn set_user_status(
    conn: &Connection,
    id: &str,
    status: &str,
) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE app_users SET status=?1, updated_at=?2 WHERE id=?3",
        params![status, now, id],
    )?;
    Ok(())
}

pub fn delete_user(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM app_users WHERE id=?1", params![id])?;
    Ok(())
}

pub fn reset_password(
    conn: &Connection,
    id: &str,
    new_password: &str,
) -> Result<(), AppError> {
    let secret = Zeroizing::new(new_password.to_string());
    let hash = hash_password(&secret)?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE app_users SET password_hash=?1, updated_at=?2 WHERE id=?3",
        params![hash, now, id],
    )?;
    Ok(())
}

pub fn update_username(
    conn: &Connection,
    id: &str,
    new_username: &str,
) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE app_users SET username=?1, updated_at=?2 WHERE id=?3",
        params![new_username, now, id],
    )
    .map_err(|e| match e {
        rusqlite::Error::SqliteFailure(ref fe, _)
            if fe.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            AppError::Other(format!("Username '{}' is already taken", new_username))
        }
        other => AppError::Db(other),
    })?;
    Ok(())
}
