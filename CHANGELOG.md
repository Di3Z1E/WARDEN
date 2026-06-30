# Changelog

All notable changes to WARDEN are documented here.  
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [Semantic Versioning](https://semver.org/)

---

## [Unreleased]

---

## [0.6.0] — 2026-06-30

### Added

#### HTTP Endpoint Monitor
- **Persisted monitors** — add any HTTP/HTTPS endpoint to a watch list; label, method (GET/POST/PUT/HEAD), expected status code, optional body-match string, configurable timeout
- **One-off check** — test a URL immediately from the add/edit form before saving
- **Refresh on demand** — re-check a single monitor and update last-checked metadata in DB
- Status dot per monitor (green/red/grey); status code badge; latency display; expandable detail row
- New `http_monitors` table (migration 4): stores config + last check result per endpoint
- 5 new Tauri commands: `cmd_check_http_endpoint`, `cmd_list_http_monitors`, `cmd_upsert_http_monitor`, `cmd_delete_http_monitor`, `cmd_refresh_http_monitor`
- **HTTP** button added to header (Admin/Operator)

#### Network / Subnet Scanner
- **CIDR sweep** — enter any range from `/8` to `/30`; probes 9 ports concurrently: SSH 22, RDP 3389, VNC 5900, SMB 445, WMI 135, HTTP 80/8080, HTTPS 443/8443
- Up to 50 parallel TCP probes per scan; results streamed live via `scanner:result:{id}` Tauri events — hosts appear as they respond
- **One-click inventory import** — add a discovered host directly to the asset tree with a guessed machine type and primary connection profile pre-filled
- Scannable/stoppable mid-run via `cmd_cancel_scan`; scan task handle stored in `AppState.scan_tasks`
- Color-coded port badges per host; latency and inferred OS type shown per result
- 2 new Tauri commands: `cmd_scan_subnet`, `cmd_cancel_scan`
- **Scan** button added to header (Admin/Operator)

#### Credential Expiry Tracking
- `expires_at` column (added in migration 3) is now fully wired end-to-end
- **Set expiry** — date picker on each credential row in Credential Manager (Admin only)
- **Expiry badge** on every credential: green (>30 d), yellow (≤30 d), red (≤7 d or expired)
- **Dashboard alert card** — yellow warning banner listing all credentials expiring within 30 days; click to jump to Credential Manager
- 2 new Tauri commands: `cmd_set_credential_expiry`, `cmd_get_expiring_credentials`
- `CredentialSet` type gains `expires_at: string | null` field throughout frontend

### Changed
- `CredentialSetMeta` Rust struct gains `expires_at: Option<String>` field; all DB queries updated
- `AppState` gains `scan_tasks: Mutex<HashMap<String, JoinHandle<()>>>` for cancellable scan tasks
- `commands/mod.rs` now registers `http_monitor` and `scanner` modules

---

## [0.5.0] — 2026-06-29

### Added

#### MFA / Two-Factor Authentication
- **TOTP enrollment** — RFC 6238 TOTP via `totp-rs 5`; QR code rendered inline for authenticator-app setup
- `otpauth://` URI generation with issuer and account fields
- Login flow extended: password-verified users with MFA enabled receive a TOTP challenge before session is granted
- Admin can reset MFA for any user; users can self-disable from My Account
- `mfa_enabled` column added via migration 3
- 6 new Tauri commands: `cmd_mfa_provision`, `cmd_mfa_verify_and_enable`, `cmd_mfa_disable`, `cmd_login_mfa`, `cmd_get_mfa_status`, `cmd_admin_reset_mfa`

#### SSH Key Management
- **Generate** Ed25519 key pairs inside WARDEN; private key stored in Windows Credential Manager
- **Upload** existing PEM private keys into the vault
- **Deploy** public key to a remote host's `~/.ssh/authorized_keys` via SSH exec
- **Copy** public key string to clipboard from the Credential Manager panel
- 5 new Tauri commands: `cmd_generate_ssh_key`, `cmd_upload_ssh_key`, `cmd_get_public_key`, `cmd_deploy_public_key` (+ list via existing `cmd_list_credential_sets`)

#### Dependency Upgrades
- russh 0.44 → 0.60
- Tailwind CSS 3 → v4 (PostCSS plugin, no config file required)
- Vite 5 → 8 (minifier switched from esbuild to oxc)
- Zustand 4 → 5

---

## [0.4.0] — 2026-06-29

### Added

#### TCP Liveness Monitoring
- Per-machine TCP probe with configurable interval; `monitor_rules` and `monitor_events` tables (migration 2)
- Background Tokio polling task; `monitor:status:<machineId>` events emitted on state change
- 4 new Tauri commands: `cmd_upsert_monitor_rule`, `cmd_delete_monitor_rule`, `cmd_get_monitor_rule`, `cmd_get_monitor_status`

#### Dashboard Sparklines
- Rolling 24-point uptime history rendered as inline SVG sparklines per machine card
- Color-coded: green (all up), yellow (intermittent), red (down)

#### Desktop Notifications
- Host-down and host-recovered events trigger native Windows notifications via `tauri-plugin-notification`

#### Ansible Export
- Generates a valid Ansible `inventory.yaml` from the full machine registry, grouped by machine type
- `cmd_export_ansible_inventory` Tauri command

#### SSH Session Panels
- **Live metrics** — CPU %, memory, load average polled every 5 s via SSH exec
- **Process manager** — sortable process table; kill-signal dispatch via SSH
- **Service manager** — list + start/stop/restart systemd units or Windows services
- **Event log viewer** — last N lines of syslog / Windows Event Log streamed via SSH exec
- **Live log tail** — persistent SSH exec channel streaming `tail -f` output in real time

---

## [0.3.0] — 2026-06-28

### Added

#### Script Library
- **Script CRUD** — create, edit, delete PowerShell / Bash / Python scripts stored in SQLite
- **Live streaming runner** — execute a script concurrently across any set of inventory machines via SSH; per-machine output streamed via `script:output:<runId>:<machineId>` Tauri events
- **Run history** — every execution persisted with stdout, stderr, and exit code per machine
- Admin and Operator roles; accessible via Script Library icon in header

#### Bulk Command Execution
- **Ad-hoc SSH exec** — enter a shell command, pick any SSH-capable machines, run concurrently
- Per-machine live output grid with state icons (pending / running / ok / error / timeout)
- Streamed via `bulk:output:<jobId>:<machineId>` / `bulk:done:<jobId>` Tauri events

#### Certificate Monitor
- **Quick check** — one-off TLS certificate inspection: subject, issuer, SANs, expiry, days remaining
- **Persisted monitors** — watch list with color-coded `DaysBadge` (green >30 d, yellow ≤30 d, red ≤7 d)
- `cert_monitors` table added (migration 2)
- TOFU TLS verifier for cert metadata extraction without chain validation

#### Database Migration System
- Versioned migration runner applied against `schema_version` in the `settings` table
- Migration 1: baseline schema · Migration 2: scripts, runs, cert monitors, monitor rules/events

#### Backend
- `ssh::run_command()` — non-PTY SSH exec channel helper with stdin feed and stdout/stderr drain
- 15 new Tauri commands across `commands/scripts.rs` and `commands/certs.rs`
- Audit events: `SCRIPT_RUN`, `BULK_EXEC`

### Changed
- All dependency versions updated to latest stable (rusqlite 0.31 → 0.40, rand 0.8 → 0.10, sha2 0.10 → 0.11, socket2 0.5 → 0.6, windows 0.58 → 0.62, React 18 → 19, xterm.js 5 → 6)

### Fixed
- Clippy warnings blocking CI: `should_implement_trait`, `redundant_closure`, `manual_char_comparison`, `too_many_arguments`
- `windows 0.62` API: `CredReadW`/`CredDeleteW` `flags` parameter changed to `Option<u32>`
- `rand 0.10` API: `thread_rng()` → `rng()`, import path updated

---

## [0.2.0] — 2026-06-27

### Added

#### Remote Desktop (RDP)
- **IronRDP client** — pure-Rust RDP engine (no `mstsc.exe`); TLS upgrade + NLA/CredSSP authentication
- TOFU certificate verifier (custom `rustls::client::danger::ServerCertVerifier`)
- Pixel rendering via `DecodedImage` → `rdp:frame:<id>` Tauri events with base64 RGBA deltas
- Full keyboard forwarding: Web `event.code` → RDP scancode table (full US keyboard + numpad + function keys)
- Mouse forwarding: move, left/right/middle button → FastPath pointer PDUs
- `cmd_connect_rdp`, `cmd_rdp_input` Tauri commands; `SESSION_OPEN_RDP` audit event

#### SFTP File Browser
- **russh-sftp 2.x** SFTP subsystem over SSH; deadlock-safe `Arc<tokio::sync::Mutex<SftpSession>>`
- Breadcrumb navigation, upload (base64), download, mkdir, rename, delete, symlink display
- 8 new Tauri commands: `cmd_connect_sftp`, `cmd_sftp_list_dir`, `cmd_sftp_read_file`, `cmd_sftp_write_file`, `cmd_sftp_mkdir`, `cmd_sftp_delete`, `cmd_sftp_rename`, `cmd_sftp_disconnect`

### Fixed
- RDP mouse PDU was missing Y coordinate (7-byte PDU now fully correct)
- 6 unused `mut` warnings on SFTP async lock guards

---

## [0.1.0] — 2026-06-27

Initial release. Full working application compiled to a native Windows exe.

### Added

#### Core Application
- **Tauri v2 + React 19 + TypeScript** application scaffold
- Single distributable `warden.exe` — no runtime dependencies beyond WebView2
- First-run setup wizard bootstrapping the initial Admin account
- Persistent SQLite database at `%APPDATA%\com.warden.app\warden.db` (WAL mode)

#### Identity & Access Management
- RBAC with four roles: **Admin**, **Operator**, **Auditor**, **ReadOnly**; enforced in Rust on every command
- **Argon2id** password hashing with per-user random salts
- Login/logout; session state held in Rust memory
- Admin user management: create, update role, change password, disable, delete
- Self-service account editing: change own username or password with current-password gate

#### Credential Vault
- **Windows Credential Manager** backend (`CredWrite`/`CredRead`); OS-level AES encryption
- Password and SSH key credential types; only opaque vault references stored in SQLite
- `Zeroizing<String>` throughout — secrets zeroed on drop

#### Asset Inventory
- Machine registry with 8 type classifications
- Multiple connection profiles per machine (SSH, RDP, Telnet, SFTP, HTTP, VNC)
- Folder hierarchy, tags, notes, last-connected timestamps
- **Wake-on-LAN** via raw UDP magic packet (`socket2`)

#### Remote Sessions: SSH + Telnet
- **russh 0.44** SSH client; full PTY, terminal resize, password + public key auth
- Telnet: async Tokio TCP with IAC option negotiation
- Background Tokio task per session; `session:data:<id>` and `session:status:<id>` Tauri events

#### Audit Log
- Append-only SQLite event log with **SHA-256 hash chain** (tamper-evident)
- Events: auth, session open/close, IAM mutations, vault operations, inventory changes
- Queryable by actor, action, time range

#### User Interface
- **Dashboard** with stats, quick actions, recent connections, getting-started guide
- **Command Palette** (`Ctrl+K`) — fuzzy search across machines, sessions, and actions
- Multi-tab session pane with live connection duration timers
- Asset tree with folder hierarchy, protocol badges, context menus
- Dark theme with 5 variants (Dark, Total Dark, Discord, VS Code, White)
- 14 modals: machine/profile/credential/user management, audit log, backup, my account, about

#### Build
- Release profile: `lto = true`, `codegen-units = 1`, `opt-level = "s"`, `strip = true`
- NSIS installer and MSI package produced alongside portable exe

---

*All versions ship a single portable `warden.exe` for Windows 10 21H2+ / Windows 11 x64.*
