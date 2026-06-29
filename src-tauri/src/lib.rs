pub mod audit;
pub mod commands;
pub mod db;
pub mod error;
pub mod iam;
pub mod inventory;
pub mod monitoring;
pub mod power;
pub mod protocols;
pub mod scripts;
pub mod vault;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::Manager;

use crate::protocols::{sftp::SftpEntry, SessionHandle};

/// Ephemeral MFA challenge: lives in memory only for 5 minutes after password check.
pub struct PendingMfa {
    pub user: iam::AuthenticatedUser,
    pub expires_at: std::time::Instant,
}

/// Shared application state — managed by Tauri, accessible in every command.
pub struct AppState {
    /// Opened SQLite connection (single writer, mutex-guarded).
    pub db: Mutex<rusqlite::Connection>,
    /// Active terminal sessions (SSH, Telnet, RDP) keyed by session UUID.
    pub sessions: Mutex<HashMap<String, SessionHandle>>,
    /// Active SFTP sessions keyed by session UUID.
    pub sftp_sessions: Mutex<HashMap<String, SftpEntry>>,
    /// Currently authenticated application user (None = not logged in).
    pub current_user: Mutex<Option<iam::AuthenticatedUser>>,
    /// Background log-tail tasks keyed by tail UUID — abort handle to stop streaming.
    pub tail_tasks: Mutex<HashMap<String, tokio::task::JoinHandle<()>>>,
    /// In-flight MFA challenges: ephemeral_token → PendingMfa (5-min TTL).
    pub pending_mfa: Mutex<HashMap<String, PendingMfa>>,
    /// Running subnet scan tasks keyed by scan UUID — abortable on cancel.
    pub scan_tasks: Mutex<HashMap<String, tokio::task::JoinHandle<()>>>,
}

pub fn run() {
    env_logger::init();

    // Install default crypto provider for rustls 0.23 to avoid panic when both aws-lc-rs and ring features are active
    let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = app_data_dir(app.handle());
            std::fs::create_dir_all(&data_dir)?;

            let db_path = data_dir.join("warden.db");
            let conn = db::open(&db_path)?;

            let state = AppState {
                db: Mutex::new(conn),
                sessions: Mutex::new(HashMap::new()),
                sftp_sessions: Mutex::new(HashMap::new()),
                current_user: Mutex::new(None),
                tail_tasks: Mutex::new(HashMap::new()),
                pending_mfa: Mutex::new(HashMap::new()),
                scan_tasks: Mutex::new(HashMap::new()),
            };

            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // MFA
            commands::mfa::cmd_mfa_provision,
            commands::mfa::cmd_mfa_verify_and_enable,
            commands::mfa::cmd_mfa_disable,
            commands::mfa::cmd_login_mfa,
            commands::mfa::cmd_get_mfa_status,
            commands::mfa::cmd_admin_reset_mfa,
            // IAM
            commands::iam::cmd_first_run_check,
            commands::iam::cmd_setup_admin,
            commands::iam::cmd_login,
            commands::iam::cmd_logout,
            commands::iam::cmd_get_current_user,
            commands::iam::cmd_list_users,
            commands::iam::cmd_create_user,
            commands::iam::cmd_update_user,
            commands::iam::cmd_delete_user,
            commands::iam::cmd_update_own_profile,
            // Inventory
            commands::inventory::cmd_list_folders,
            commands::inventory::cmd_create_folder,
            commands::inventory::cmd_delete_folder,
            commands::inventory::cmd_list_machines,
            commands::inventory::cmd_get_machine,
            commands::inventory::cmd_create_machine,
            commands::inventory::cmd_update_machine,
            commands::inventory::cmd_delete_machine,
            commands::inventory::cmd_list_profiles,
            commands::inventory::cmd_create_profile,
            commands::inventory::cmd_update_profile,
            commands::inventory::cmd_delete_profile,
            // Vault
            commands::vault::cmd_list_credential_sets,
            commands::vault::cmd_create_credential_set,
            commands::vault::cmd_delete_credential_set,
            commands::vault::cmd_upload_ssh_key,
            commands::vault::cmd_generate_ssh_key,
            commands::vault::cmd_get_public_key,
            commands::vault::cmd_deploy_public_key,
            // Sessions
            commands::sessions::cmd_connect_ssh,
            commands::sessions::cmd_connect_telnet,
            commands::sessions::cmd_connect_rdp,
            commands::sessions::cmd_rdp_input,
            commands::sessions::cmd_session_write,
            commands::sessions::cmd_session_resize,
            commands::sessions::cmd_disconnect_session,
            commands::sessions::cmd_list_sessions,
            // SFTP
            commands::sftp::cmd_connect_sftp,
            commands::sftp::cmd_sftp_list_dir,
            commands::sftp::cmd_sftp_read_file,
            commands::sftp::cmd_sftp_write_file,
            commands::sftp::cmd_sftp_mkdir,
            commands::sftp::cmd_sftp_delete,
            commands::sftp::cmd_sftp_rename,
            commands::sftp::cmd_sftp_disconnect,
            // Audit
            commands::audit::cmd_query_audit,
            // Power
            commands::power::cmd_wake_on_lan,
            // Network / diagnostics
            commands::network::cmd_ping_host,
            commands::network::cmd_net_list_dir,
            commands::network::cmd_verify_os_and_reset_password,
            // Backup / restore
            commands::config::cmd_export_config,
            commands::config::cmd_import_config,
            // Scripts
            commands::scripts::cmd_list_scripts,
            commands::scripts::cmd_create_script,
            commands::scripts::cmd_update_script,
            commands::scripts::cmd_delete_script,
            commands::scripts::cmd_list_script_runs,
            commands::scripts::cmd_get_script_run_outputs,
            commands::scripts::cmd_run_script,
            commands::scripts::cmd_finish_script_run,
            commands::scripts::cmd_save_run_output,
            commands::scripts::cmd_bulk_exec,
            // Cert monitor
            commands::certs::cmd_check_tls_cert,
            commands::certs::cmd_list_cert_monitors,
            commands::certs::cmd_upsert_cert_monitor,
            commands::certs::cmd_delete_cert_monitor,
            commands::certs::cmd_refresh_cert_monitor,
            // Event log & log tail
            commands::logs::cmd_query_event_log,
            commands::logs::cmd_start_log_tail,
            commands::logs::cmd_stop_log_tail,
            // System info (metrics, processes, services)
            commands::sysinfo::cmd_poll_metrics,
            commands::sysinfo::cmd_list_processes,
            commands::sysinfo::cmd_kill_process,
            commands::sysinfo::cmd_list_services,
            commands::sysinfo::cmd_control_service,
            // Liveness monitoring & Ansible export
            commands::monitoring::cmd_check_machine_liveness,
            commands::monitoring::cmd_get_liveness_history,
            commands::monitoring::cmd_get_all_liveness_statuses,
            commands::monitoring::cmd_upsert_monitor_rule,
            commands::monitoring::cmd_get_monitor_rule,
            commands::monitoring::cmd_export_ansible_inventory,
            // HTTP endpoint monitor
            commands::http_monitor::cmd_check_http_endpoint,
            commands::http_monitor::cmd_list_http_monitors,
            commands::http_monitor::cmd_upsert_http_monitor,
            commands::http_monitor::cmd_delete_http_monitor,
            commands::http_monitor::cmd_refresh_http_monitor,
            // Subnet scanner
            commands::scanner::cmd_scan_subnet,
            commands::scanner::cmd_cancel_scan,
            // Credential expiry
            commands::vault::cmd_set_credential_expiry,
            commands::vault::cmd_get_expiring_credentials,
        ])
        .run(tauri::generate_context!())
        .expect("error while running WARDEN");
}

fn app_data_dir(handle: &tauri::AppHandle) -> PathBuf {
    handle
        .path()
        .app_data_dir()
        .expect("could not resolve app data dir")
}
