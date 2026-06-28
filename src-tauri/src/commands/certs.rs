use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use der::{Decode, Encode};
use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::net::TcpStream;
use tokio_rustls::rustls::{
    self,
    client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
    pki_types::{CertificateDer, ServerName as RustlsServerName, UnixTime},
    DigitallySignedStruct, Error as TlsError, SignatureScheme,
};
use tokio_rustls::TlsConnector;

use crate::{
    error::{CmdError, CmdResult},
    scripts::{self, CertMonitor},
    AppState,
};

fn require_operator(state: &AppState) -> Result<crate::iam::AuthenticatedUser, CmdError> {
    state
        .current_user
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| CmdError { code: "UNAUTHENTICATED", message: "Not logged in".into() })
        .and_then(|u| {
            if u.role.can_connect() {
                Ok(u)
            } else {
                Err(CmdError {
                    code: "FORBIDDEN",
                    message: "Operator or Admin role required".into(),
                })
            }
        })
}

// ── TOFU verifier — we check cert metadata, not chain validity ────────────────

#[derive(Debug)]
struct AcceptAny;

impl ServerCertVerifier for AcceptAny {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &RustlsServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, TlsError> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        vec![
            SignatureScheme::RSA_PKCS1_SHA256,
            SignatureScheme::RSA_PKCS1_SHA384,
            SignatureScheme::RSA_PKCS1_SHA512,
            SignatureScheme::ECDSA_NISTP256_SHA256,
            SignatureScheme::ECDSA_NISTP384_SHA384,
            SignatureScheme::RSA_PSS_SHA256,
            SignatureScheme::RSA_PSS_SHA384,
            SignatureScheme::RSA_PSS_SHA512,
            SignatureScheme::ED25519,
        ]
    }
}

// ── TLS cert check ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct CertInfo {
    pub host: String,
    pub port: u16,
    pub subject: String,
    pub issuer: String,
    pub not_after: String,
    pub days_remaining: i64,
    pub sans: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct CheckCertInput {
    pub host: String,
    pub port: Option<u16>,
}

#[tauri::command]
pub async fn cmd_check_tls_cert(
    state: State<'_, AppState>,
    input: CheckCertInput,
) -> CmdResult<CertInfo> {
    require_operator(&state)?;
    let port = input.port.unwrap_or(443);
    check_cert_inner(&input.host, port).await.map_err(|e| CmdError {
        code: "CERT_CHECK_ERROR",
        message: e.to_string(),
    })
}

async fn check_cert_inner(host: &str, port: u16) -> anyhow::Result<CertInfo> {
    let tls_config = Arc::new(
        rustls::ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(AcceptAny))
            .with_no_client_auth(),
    );
    let connector = TlsConnector::from(tls_config);

    let tcp = TcpStream::connect(format!("{}:{}", host, port)).await?;
    let server_name = RustlsServerName::try_from(host)
        .map_err(|_| anyhow::anyhow!("Invalid DNS name: {}", host))?
        .to_owned();

    let tls = connector.connect(server_name, tcp).await?;
    let (_, session) = tls.get_ref();

    let certs = session
        .peer_certificates()
        .ok_or_else(|| anyhow::anyhow!("No peer certificates received"))?;
    let raw = certs.first().ok_or_else(|| anyhow::anyhow!("Empty certificate chain"))?;

    let cert = x509_cert::Certificate::from_der(raw.as_ref())
        .map_err(|e| anyhow::anyhow!("DER decode failed: {}", e))?;

    let tbs = &cert.tbs_certificate;
    let subject = tbs.subject.to_string();
    let issuer = tbs.issuer.to_string();

    let not_after_epoch = der_time_to_epoch(&tbs.validity.not_after)?;
    let not_after_display = epoch_to_display(not_after_epoch);
    let now_secs = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() as i64;
    let days_remaining = (not_after_epoch - now_secs) / 86400;

    // SANs (best-effort: skip gracefully on decode error)
    let sans = extract_sans(&cert);

    Ok(CertInfo {
        host: host.to_owned(),
        port,
        subject,
        issuer,
        not_after: not_after_display,
        days_remaining,
        sans,
    })
}

/// Convert a DER-encoded ASN.1 time value to Unix seconds via byte-level parsing.
/// Avoids dependency on `time` feature flags in `der`.
fn der_time_to_epoch(t: &x509_cert::time::Time) -> anyhow::Result<i64> {
    let raw = t.to_der().map_err(|e| anyhow::anyhow!("DER encode time: {}", e))?;
    // raw = [tag, len, ascii_bytes...]
    // tag 0x17 = UTCTime "YYMMDDHHMMSSZ", tag 0x18 = GeneralizedTime "YYYYMMDDHHMMSSZ"
    if raw.len() < 4 {
        return Err(anyhow::anyhow!("Time DER too short"));
    }
    let tag = raw[0];
    let ascii = std::str::from_utf8(&raw[2..])?.trim_end_matches('Z');
    let dt = match tag {
        0x17 => {
            // YY MMDD HHMMSS — Y in [0,99], >= 50 means 19xx else 20xx
            let yy: i32 = ascii[..2].parse()?;
            let year = if yy >= 50 { 1900 + yy } else { 2000 + yy };
            let full = format!("{year:04}{}", &ascii[2..]);
            chrono::NaiveDateTime::parse_from_str(&full, "%Y%m%d%H%M%S")?
        }
        0x18 => chrono::NaiveDateTime::parse_from_str(ascii, "%Y%m%d%H%M%S")?,
        t => return Err(anyhow::anyhow!("Unknown time tag 0x{t:02x}")),
    };
    Ok(dt.and_utc().timestamp())
}

fn epoch_to_display(epoch: i64) -> String {
    use chrono::TimeZone;
    chrono::Utc.timestamp_opt(epoch, 0)
        .single()
        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S UTC").to_string())
        .unwrap_or_else(|| epoch.to_string())
}

fn extract_sans(cert: &x509_cert::Certificate) -> Vec<String> {
    use x509_cert::ext::pkix::{name::GeneralName, SubjectAltName};
    let mut sans = Vec::new();
    if let Some(exts) = &cert.tbs_certificate.extensions {
        for ext in exts {
            // OID 2.5.29.17 = SubjectAltName
            if ext.extn_id.to_string() == "2.5.29.17" {
                if let Ok(san) = SubjectAltName::from_der(ext.extn_value.as_bytes()) {
                    for name in san.0 {
                        match name {
                            GeneralName::DnsName(dns) => sans.push(dns.to_string()),
                            GeneralName::IpAddress(ip) => match ip.as_bytes() {
                                [a, b, c, d] => sans.push(format!("{a}.{b}.{c}.{d}")),
                                bytes => sans.push(hex::encode(bytes)),
                            },
                            _ => {}
                        }
                    }
                }
                break;
            }
        }
    }
    sans
}

// ── Cert monitor CRUD ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn cmd_list_cert_monitors(state: State<'_, AppState>) -> CmdResult<Vec<CertMonitor>> {
    require_operator(&state)?;
    let conn = state.db.lock().unwrap();
    scripts::list_cert_monitors(&conn).map_err(CmdError::from)
}

#[derive(Debug, Deserialize)]
pub struct UpsertCertMonitorInput {
    pub id: Option<String>,
    pub host: String,
    pub port: Option<u16>,
    pub label: Option<String>,
}

#[tauri::command]
pub fn cmd_upsert_cert_monitor(
    state: State<'_, AppState>,
    input: UpsertCertMonitorInput,
) -> CmdResult<CertMonitor> {
    require_operator(&state)?;
    let conn = state.db.lock().unwrap();
    scripts::upsert_cert_monitor(
        &conn,
        input.id.as_deref(),
        &input.host,
        input.port.unwrap_or(443),
        input.label.as_deref(),
    )
    .map_err(CmdError::from)
}

#[tauri::command]
pub fn cmd_delete_cert_monitor(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    require_operator(&state)?;
    let conn = state.db.lock().unwrap();
    scripts::delete_cert_monitor(&conn, &id).map_err(CmdError::from)
}

#[tauri::command]
pub async fn cmd_refresh_cert_monitor(
    state: State<'_, AppState>,
    id: String,
) -> CmdResult<CertInfo> {
    require_operator(&state)?;

    let (host, port) = {
        let conn = state.db.lock().unwrap();
        let monitors = scripts::list_cert_monitors(&conn).map_err(CmdError::from)?;
        let m = monitors
            .into_iter()
            .find(|m| m.id == id)
            .ok_or_else(|| CmdError { code: "NOT_FOUND", message: "Monitor not found".into() })?;
        (m.host, m.port)
    };

    let info = check_cert_inner(&host, port).await.map_err(|e| CmdError {
        code: "CERT_CHECK_ERROR",
        message: e.to_string(),
    })?;

    {
        let conn = state.db.lock().unwrap();
        scripts::update_cert_check_result(
            &conn,
            &id,
            &info.subject,
            &info.not_after,
            info.days_remaining,
        )
        .map_err(CmdError::from)?;
    }

    Ok(info)
}
