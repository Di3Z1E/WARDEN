use std::net::SocketAddr;
use std::sync::Arc;

use der::Decode;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use ironrdp_connector::{
    ClientConnector, Config, Credentials, DesktopSize, ServerName,
};
use ironrdp_pdu::gcc::KeyboardType;
use ironrdp_pdu::geometry::Rectangle;
use ironrdp_pdu::rdp::capability_sets::MajorPlatformType;
use ironrdp_pdu::rdp::client_info::{PerformanceFlags, TimezoneInfo};
use ironrdp_graphics::image_processing::PixelFormat;
use ironrdp_session::image::DecodedImage;
use ironrdp_session::{ActiveStage, ActiveStageOutput};
use ironrdp_tokio::reqwest::ReqwestNetworkClient;
use ironrdp_tokio::{FramedWrite, TokioFramed, connect_begin, connect_finalize, mark_as_upgraded};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_rustls::TlsConnector;
use tokio_rustls::rustls::{
    self,
    client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
    pki_types::{CertificateDer, ServerName as RustlsServerName, UnixTime},
    DigitallySignedStruct, Error as TlsError, SignatureScheme,
};
use zeroize::Zeroizing;

use crate::protocols::{status_event, SessionHandle, SessionProtocol};

// ── TOFU certificate verifier (accept all, like SSH TOFU) ────────────────────

#[derive(Debug)]
struct TofuCertVerifier;

impl ServerCertVerifier for TofuCertVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &RustlsServerName<'_>,
        _ocsp_response: &[u8],
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

// ── Types ─────────────────────────────────────────────────────────────────────

pub fn frame_event(session_id: &str) -> String {
    format!("rdp:frame:{}", session_id)
}

#[derive(Debug, Clone, Serialize)]
pub struct RdpFrameEvent {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
    /// Base64-encoded RGBA pixel bytes for the updated region (compact, no stride padding).
    pub data: String,
}

pub struct RdpParams {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Zeroizing<String>,
    pub domain: Option<String>,
    pub width: u16,
    pub height: u16,
    /// When false, skip CredSSP/NLA and use TLS-only security.
    /// Needed for servers that do not enforce Network Level Authentication.
    pub enable_nla: bool,
}

// ── Session spawner ───────────────────────────────────────────────────────────

pub async fn connect(
    params: RdpParams,
    session_id: String,
    app_handle: AppHandle,
) -> anyhow::Result<SessionHandle> {
    let (input_tx, mut input_rx) = mpsc::channel::<Vec<u8>>(256);
    let sid = session_id.clone();
    let ah = app_handle.clone();

    let task = tokio::spawn(async move {
        match run_session(params, &sid, ah.clone(), &mut input_rx).await {
            Ok(()) => {
                ah.emit(&status_event(&sid), "disconnected").ok();
            }
            Err(e) => {
                // Surface the full error chain to the frontend so the user can see
                // exactly which phase failed (TCP / TLS / CredSSP / active-stage).
                let msg = format!("error:{:#}", e);
                log::error!("[RDP {}] {}", sid, &msg[6..]);
                ah.emit(&status_event(&sid), msg).ok();
            }
        }
    });

    Ok(SessionHandle::new(
        session_id,
        SessionProtocol::Rdp,
        input_tx,
        task,
    ))
}

async fn run_session(
    params: RdpParams,
    session_id: &str,
    app: AppHandle,
    input_rx: &mut mpsc::Receiver<Vec<u8>>,
) -> anyhow::Result<()> {
    // ── Phase 1: TCP connect + initial RDP handshake ───────────────────────
    let addr = format!("{}:{}", params.host, params.port);
    let tcp_stream = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        TcpStream::connect(&addr),
    )
    .await
    .map_err(|_| anyhow::anyhow!("TCP connect timed out after 10 s"))?
    .map_err(|e| anyhow::anyhow!("TCP connect: {}", e))?;
    let client_addr: SocketAddr = tcp_stream.local_addr()
        .unwrap_or_else(|_| "127.0.0.1:0".parse().unwrap());

    let config = build_config(&params);
    let mut connector = ClientConnector::new(config, client_addr);

    let mut plain_framed: TokioFramed<TcpStream> = TokioFramed::new(tcp_stream);
    let should_upgrade = connect_begin(&mut plain_framed, &mut connector)
        .await
        .map_err(|e| anyhow::anyhow!("RDP connect_begin: {}", e))?;

    // ── Phase 2: TLS upgrade ───────────────────────────────────────────────
    let (tcp_stream, leftover) = plain_framed.into_inner();

    let tls_config = Arc::new(
        rustls::ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(TofuCertVerifier))
            .with_no_client_auth(),
    );
    let tls_connector = TlsConnector::from(tls_config);
    let rustls_server_name = rustls::pki_types::ServerName::try_from(params.host.as_str())
        .map_err(|e| anyhow::anyhow!("Invalid hostname for TLS: {}", e))?
        .to_owned();
    let tls_stream = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        tls_connector.connect(rustls_server_name, tcp_stream),
    )
    .await
    .map_err(|_| anyhow::anyhow!("TLS handshake timed out after 10 s"))?
    .map_err(|e| anyhow::anyhow!("TLS handshake: {}", e))?;

    // Extract the server's SubjectPublicKey bytes for CredSSP channel binding.
    // CredSSP's pubKeyAuth is computed over the raw public key bytes (not the full certificate DER).
    // Passing the whole certificate would cause the server's binding check to fail and drop the connection.
    let server_public_key = tls_stream
        .get_ref()
        .1
        .peer_certificates()
        .and_then(|certs| certs.first())
        .and_then(|cert_der| {
            x509_cert::Certificate::from_der(cert_der.as_ref()).ok()
        })
        .and_then(|cert| {
            cert.tbs_certificate
                .subject_public_key_info
                .subject_public_key
                .as_bytes()
                .map(|b| b.to_vec())
        })
        .unwrap_or_default();

    let mut tls_framed: TokioFramed<tokio_rustls::client::TlsStream<TcpStream>> =
        TokioFramed::new_with_leftover(tls_stream, leftover);

    // ── Phase 3: finalize RDP connection (CredSSP / capabilities) ─────────
    let upgraded = mark_as_upgraded(should_upgrade, &mut connector);
    let mut network_client = ReqwestNetworkClient::new();
    let server_name = ServerName::from(params.host.as_str());

    let connection_result = connect_finalize(
        upgraded,
        connector,
        &mut tls_framed,
        &mut network_client,
        server_name,
        server_public_key,
        None, // kerberos_config — None = NTLM
    )
    .await
    .map_err(|e| anyhow::anyhow!("RDP finalize: {}", e))?;

    // ── Phase 4: active session ────────────────────────────────────────────
    let mut image = DecodedImage::new(PixelFormat::RgbA32, params.width, params.height);
    let mut active_stage = ActiveStage::new(connection_result);

    app.emit(&status_event(session_id), "connected").ok();

    loop {
        tokio::select! {
            // RDP server → frontend (frame updates)
            result = tls_framed.read_pdu() => {
                let (action, payload) = result
                    .map_err(|e| anyhow::anyhow!("RDP read: {}", e))?;

                let outputs = active_stage
                    .process(&mut image, action, &payload)
                    .map_err(|e| anyhow::anyhow!("RDP process: {}", e))?;

                for output in outputs {
                    match output {
                        ActiveStageOutput::ResponseFrame(frame) => {
                            tls_framed
                                .write_all(&frame)
                                .await
                                .map_err(|e| anyhow::anyhow!("RDP response write: {}", e))?;
                        }
                        ActiveStageOutput::GraphicsUpdate(region) => {
                            // Extract the updated rect's pixels row-by-row (skip stride padding)
                            let x = region.left as usize;
                            let y = region.top as usize;
                            let w = region.width() as usize;
                            let h = region.height() as usize;
                            let bpp = image.bytes_per_pixel();
                            let stride = image.stride();
                            let raw = image.data();

                            let img_w = image.width() as usize;
                            let img_h = image.height() as usize;

                            // Clip update region to image bounds to prevent out-of-bounds panics
                            let x_start = x.min(img_w);
                            let x_end = (x + w).min(img_w);
                            let y_start = y.min(img_h);
                            let y_end = (y + h).min(img_h);

                            let copy_w = x_end.saturating_sub(x_start);
                            let copy_h = y_end.saturating_sub(y_start);

                            if copy_w > 0 && copy_h > 0 {
                                let mut pixels = vec![0u8; copy_w * copy_h * bpp];
                                for row in 0..copy_h {
                                    let src_off = (y_start + row) * stride + x_start * bpp;
                                    let dst_off = row * copy_w * bpp;
                                    let nbytes  = copy_w * bpp;
                                    // PixelFormat::RgbA32 stores bytes as RGBA — copy directly,
                                    // no channel reordering needed for Canvas ImageData (RGBA).
                                    if src_off + nbytes <= raw.len() {
                                        pixels[dst_off..dst_off + nbytes]
                                            .copy_from_slice(&raw[src_off..src_off + nbytes]);
                                    }
                                }

                                let event = RdpFrameEvent {
                                    x: x_start as u32,
                                    y: y_start as u32,
                                    w: copy_w as u32,
                                    h: copy_h as u32,
                                    data: STANDARD.encode(&pixels),
                                };
                                app.emit(&frame_event(session_id), event).ok();
                            }
                        }
                        ActiveStageOutput::Terminate(_reason) => return Ok(()),
                        _ => {} // pointer events — ignored for now
                    }
                }
            }

            // Frontend → RDP server (pre-encoded input PDUs)
            Some(input) = input_rx.recv() => {
                if !input.is_empty() {
                    tls_framed
                        .write_all(&input)
                        .await
                        .map_err(|e| anyhow::anyhow!("RDP input write: {}", e))?;
                }
            }
        }
    }
}

// ── Config builder ────────────────────────────────────────────────────────────

fn build_config(params: &RdpParams) -> Config {
    Config {
        desktop_size: DesktopSize { width: params.width, height: params.height },
        desktop_scale_factor: 0,
        enable_tls: true,
        enable_credssp: params.enable_nla,
        credentials: Credentials::UsernamePassword {
            username: params.username.clone(),
            password: params.password.as_str().to_owned(),
        },
        domain: params.domain.clone(),
        client_build: 19041, // Windows 10 RTM
        client_name: "WARDEN".to_string(),
        keyboard_type: KeyboardType::IbmEnhanced,
        keyboard_subtype: 0,
        keyboard_functional_keys_count: 12,
        keyboard_layout: 0x0409, // en-US
        ime_file_name: String::new(),
        bitmap: None,
        dig_product_id: String::new(),
        client_dir: String::new(),
        alternate_shell: String::new(),
        work_dir: String::new(),
        platform: MajorPlatformType::WINDOWS,
        hardware_id: None,
        request_data: None,
        autologon: true,
        enable_audio_playback: false,
        performance_flags: PerformanceFlags::default(),
        license_cache: None,
        timezone_info: TimezoneInfo::default(),
        compression_type: None,
        enable_server_pointer: true,
        pointer_software_rendering: false,
        multitransport_flags: None,
    }
}
