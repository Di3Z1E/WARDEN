# Changelog

All notable changes to WARDEN are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Planned for v0.4
- ICMP / TCP liveness monitoring per machine
- Uptime sparklines on Dashboard
- Desktop notification alerts
- Ansible inventory export (YAML)

---

## [0.3.0] — 2026-06-28

### Added

#### Script Library
- **Script CRUD** — create, edit, delete PowerShell / Bash / Python scripts stored in SQLite
- **Live streaming runner** — execute a script concurrently across any set of inventory machines via SSH exec channel; per-machine output streamed in real time via Tauri events (`script:output:<runId>:<machineId>`)
- **Run history** — every execution is persisted with stdout, stderr, and exit code per machine; frontend saves output chunks via `cmd_save_run_output` (avoids holding DB lock across async SSH calls)
- Script Library modal accessible to Admin and Operator roles (Code2 icon in header)

#### Bulk Command Execution
- **Ad-hoc SSH exec** — enter a shell command, pick any SSH-capable machines (WindowsServer, WindowsClient, Linux, GenericSsh), run concurrently
- Per-machine live output grid with state icons (pending / running / ok / error / timeout)
- Expandable per-machine output panel; Enter key triggers execution
- Streamed via `bulk:output:<jobId>:<machineId>` / `bulk:done:<jobId>` Tauri events

#### Certificate Monitor
- **Quick check** — one-off TLS certificate inspection by hostname + port; shows subject, issuer, expiry date, SANs, days remaining
- **Persisted monitors** — add endpoints to a watch list; refresh on demand; last-checked metadata stored in DB
- `DaysBadge` color indicator: green (>30 d), yellow (≤30 d), red (≤7 d)
- TOFU TLS verifier (`AcceptAny`) — reads cert metadata without validating chain (same pattern as RDP)
- DER time parsing handles both UTCTime (tag `0x17`) and GeneralizedTime (tag `0x18`) without extra feature flags

#### Database Migration System
- Versioned migration runner — applies only migrations with `version > current` against `schema_version` in settings table
- Migration 1: baseline schema (all existing tables)
- Migration 2: new tables — `scripts`, `script_runs`, `script_run_outputs`, `cert_monitors`, `monitor_rules`, `monitor_events`

#### Backend
- `ssh::run_command()` — non-PTY SSH exec channel helper; feeds stdin, drains stdout/stderr, emits `ExecChunk` events
- 15 new Tauri commands across `commands/scripts.rs` and `commands/certs.rs`
- `require_operator()` / `require_admin()` guards on all new commands
- Audit events: `SCRIPT_RUN`, `BULK_EXEC`

### Changed
- All dependency versions updated to latest stable (applied 13 Dependabot PRs):
  - rusqlite 0.31 → 0.40, rand 0.8 → 0.10, sha2 0.10 → 0.11, socket2 0.5 → 0.6, windows 0.58 → 0.62
  - react + react-dom 18 → 19, @xterm/xterm 5 → 6, @xterm/addon-fit 0.10 → 0.11, @xterm/addon-web-links 0.11 → 0.12
  - GitHub Actions: checkout v7, setup-node v6, action-gh-release v3

### Fixed
- Clippy `should_implement_trait`: `Role::from_str` → `from_name`, `MachineType::from_str` → `from_name`
- Clippy `redundant_closure`: `|e| AppError::Db(e)` / `|e| AppError::Io(e)` → function pointer variants
- Clippy `manual_char_comparison`: MAC split closure → `split([':', '-'])`
- Clippy `too_many_arguments`: `#[allow]` on `ssh::run_command` (8 params)
- windows 0.62 API: `CredReadW`/`CredDeleteW` `flags` parameter now `Option<u32>` — wrapped with `Some(0)`
- rand 0.10 API: `thread_rng()` → `rng()`, `use rand::RngCore` → `use rand::Rng`

---

## [0.2.0] — 2026-06-27

### Added

#### Remote Sessions: RDP
- **RDP client** powered by IronRDP 0.9 — pure-Rust, no `mstsc.exe` invoked (satisfies C-1)
- Full TLS upgrade path: plain TCP → tokio-rustls 0.26 TLS → CredSSP/NLA authentication via `ReqwestNetworkClient`
- TOFU certificate verifier (custom `rustls::client::danger::ServerCertVerifier`) — accepts and pins server certificate on first connection
- `IronRDP` config: IBM Enhanced keyboard layout, PerformanceFlags, TimezoneInfo, `MajorPlatformType::WINDOWS`
- Pixel rendering via `DecodedImage` (`PixelFormat::RgbA32`) — updated regions emitted as `rdp:frame:<id>` Tauri events with base64 RGBA data
- Frame events carry `{ x, y, w, h, data }` — frontend calls `putImageData` for efficient partial canvas updates
- Keyboard input: Web `event.code` → RDP scancode table (full US keyboard + function keys + numpad + arrow cluster)
- Mouse input: move, left/right/middle button down/up forwarded as FastPath pointer PDUs with correct x/y coordinates
- `cmd_connect_rdp` Tauri command — resolves profile + credential → `RdpParams` → spawns background session task
- `cmd_rdp_input` Tauri command — decodes base64 PDU bytes → sends to session input channel
- RDP session stored in the existing `sessions` HashMap as a `SessionHandle`
- `SESSION_OPEN_RDP` audit event logged on connect

#### Remote Sessions: SFTP
- **SFTP client** powered by russh-sftp 2.x `SftpSession` via SSH channel subsystem
- TOFU SSH host key verifier (`SftpHandler`) — same pattern as SSH client
- `SftpEntry` holds both the russh `client::Handle` (keeps SSH connection alive) and an `Arc<tokio::sync::Mutex<SftpSession>>`
- Separate `sftp_sessions: Mutex<HashMap<String, SftpEntry>>` in `AppState` — avoids mixing with PTY sessions
- Deadlock-safe design: `std::sync::Mutex` (HashMap lookup) always released before `tokio::sync::Mutex` (SftpSession) is locked across await points
- `DirEntryDto` DTO: `name`, `is_dir`, `is_link`, `size`, `modified`, `permissions` (all serialized to frontend)
- Unix permission bit helpers: `perms_is_dir(u32)` and `perms_is_link(u32)`
- 8 SFTP Tauri commands registered:
  - `cmd_connect_sftp` — SSH connect → auth → open channel → request sftp subsystem → store session
  - `cmd_sftp_list_dir` — returns `Vec<DirEntryDto>` sorted: directories first, then files, both alphabetical
  - `cmd_sftp_read_file` — reads entire file; returns `{ data_base64, size }`
  - `cmd_sftp_write_file` — decodes base64 payload; creates or truncates remote file
  - `cmd_sftp_mkdir` — creates directory (and any missing parents via sequential mkdir)
  - `cmd_sftp_delete` — removes file or directory (recursive for directories)
  - `cmd_sftp_rename` — renames/moves file or directory
  - `cmd_sftp_disconnect` — drops `SftpEntry`, closes SSH channel
- `SESSION_OPEN_SFTP` audit event logged on connect

#### Frontend: RDP Session Component
- `RdpSession` canvas component (`src/components/RdpSession/RdpSession.tsx`)
- Subscribes to `rdp:frame:{sessionId}` Tauri events; renders RGBA pixel updates via `putImageData`
- Keyboard forwarding: `onKeyDown`/`onKeyUp` → scancode lookup → FastPath keyboard PDU → `rdpInput()`
- Mouse forwarding: move, button down/up → FastPath pointer PDU (7 bytes: eventCode + flags + x + y) → `rdpInput()`
- Canvas scales to container via CSS `object-contain`; mouse coordinates scaled back to RDP resolution
- `imageRendering: pixelated` for crisp rendering without blurring
- Context menu suppressed inside the canvas

#### Frontend: SFTP File Browser Component
- `FileBrowser` component (`src/components/FileBrowser/FileBrowser.tsx`)
- Breadcrumb navigation bar — click any segment to jump directly to that path
- Directory listing table: icon, name, size, modified date, action buttons
- Folder double-click to navigate; up-arrow and home buttons in toolbar
- Download: reads file bytes via `sftpReadFile`; triggers browser download via `URL.createObjectURL`
- Upload: file picker → `FileReader` → chunked base64 → `sftpWriteFile`
- Inline rename: click edit icon → input appears in row → Enter to confirm, Escape to cancel
- Delete: confirmation dialog → `sftpDelete`
- New folder: toolbar button → inline input with Enter/Escape handling → `sftpMkdir`
- Error banner with dismiss button; loading spinner; busy indicator in status bar
- Symlinks rendered in italic with `@` suffix

#### Frontend: Session Pane & Asset Tree Wiring
- `SessionPane` updated: SFTP tabs render `<FileBrowser>`; RDP tabs render `<RdpSession width={1280} height={800} />`
- SFTP tab dot color: `bg-cyan-400`; icon: `HardDrive`
- RDP tab dot color: `bg-blue-400`; icon: `Monitor`
- SFTP tab close calls `sftpDisconnect`; other protocols call `disconnectSession`
- `AssetTree.openSession()` extended: SFTP profiles call `connectSftp()`; RDP profiles call `connectRdp(width: 1280, height: 800)`

#### Frontend: Tauri API Bindings (`src/lib/tauri.ts`)
- `connectRdp(input: { profile_id, width?, height? })` → `{ id, protocol, profile_id }`
- `rdpInput(input: { session_id, data_base64 })` → `void`
- `DirEntry` interface: `{ name, is_dir, is_link, size, modified, permissions }`
- `connectSftp`, `sftpListDir`, `sftpReadFile`, `sftpWriteFile`, `sftpMkdir`, `sftpDelete`, `sftpRename`, `sftpDisconnect`

#### Rust Dependencies Added (`Cargo.toml`)
- `ironrdp-connector = "0.9"` — RDP connection state machine
- `ironrdp-pdu = "0.8"` — PDU types (KeyboardType, PerformanceFlags, MajorPlatformType, etc.)
- `ironrdp-session = "0.10"` — ActiveStage session loop + DecodedImage framebuffer
- `ironrdp-tokio = { version = "0.9", features = ["reqwest"] }` — async framed stream + ReqwestNetworkClient
- `ironrdp-graphics = "0.8"` — PixelFormat, image processing
- `ironrdp-input = "0.6"` — input PDU types
- `ironrdp-async = "0.9"` — async connector traits
- `tokio-rustls = "0.26"` — async TLS for RDP upgrade

### Fixed
- `RdpSession` mouse PDU was only encoding X coordinate — Y coordinate now included (7-byte PDU)
- Unused `mut` qualifier on SFTP async lock guards (6 warnings eliminated)

---

## [0.1.0] — 2026-06-27

Initial release. Full working application: bootstrapped from scratch, compiled to a native Windows exe.

### Added

#### Core Application
- **Tauri v2 + React 18 + TypeScript** application scaffold
- Single distributable `warden.exe` — no runtime dependencies beyond WebView2
- First-run setup wizard — bootstraps initial Admin account on first launch
- Persistent data in `%APPDATA%\com.warden.app\warden.db` (SQLite WAL mode)

#### Identity & Access Management
- **RBAC** with four roles: Admin, Operator, Auditor, ReadOnly
- **Argon2id** password hashing with per-user random salts
- Login and logout with session state held in Rust memory (never persisted)
- Admin user management: create, update role, change password, disable, delete users
- **Self-service account editing** via My Account panel — change own username or password with current-password verification
- In-memory session user object synced on own-account changes

#### Credential Vault
- **Windows Credential Manager** backend — OS-level AES encryption via `CredWrite`/`CredRead`
- Supports **Password** and **SSH key** credential types
- Only opaque vault references stored in the database — no plaintext ever written to disk
- `Zeroizing<String>` used throughout — secrets zeroed on drop

#### Asset Inventory
- Machine registry with 8 type classifications (WindowsServer, WindowsClient, Linux, ESXi/vSphere, IPMI/iDRAC, NetworkDevice, GenericSsh, Generic)
- Connection profiles per machine — multiple protocols per host
- Folder hierarchy for organizing machines
- Tags (comma-separated, filterable) and notes per machine
- Last-connected timestamp updated on every session open
- **Wake-on-LAN** — raw UDP magic packet dispatch via socket2

#### Remote Sessions: SSH
- **SSH client** powered by russh 0.44
- Full PTY (xterm-256color), terminal resize, bidirectional I/O
- Password authentication and public key authentication
- Background Tokio task per session; task aborted via Rust `Drop` impl on session close
- Tauri events: `session:data:<id>` (terminal output), `session:status:<id>` (connect/disconnect)

#### Remote Sessions: Telnet
- Raw TCP via Tokio async I/O
- **IAC option negotiation** handler: WILL -> DONT, DO -> WONT, SB/SE subnegotiation stripping
- Clean output forwarded to xterm.js terminal

#### Audit Log
- Append-only event log in SQLite
- **SHA-256 hash chain** — each entry hashes the previous entry's hash, enabling tamper detection
- Events: AUTH_LOGIN, AUTH_LOGOUT, IAM_*, INVENTORY_*, SESSION_OPEN_SSH, SESSION_OPEN_TELNET, SESSION_CLOSE, VAULT_*
- Queryable by actor, action, time range (up to 500 events in the UI)

#### User Interface
- **Dashboard** — home screen when no sessions are open: stats cards, quick actions, recent connections, keyboard shortcuts reference, getting-started guide
- **Command Palette** (Ctrl+K) — fuzzy search across machines (by name/tag), active sessions, and actions; keyboard-navigable with arrow keys
- **Header bar** — brand, global search trigger, live session count badge, Audit and Users buttons (role-gated), clickable username/role badge for My Account, logout
- **Asset tree sidebar** — collapsible machine nodes, protocol color badges on profiles, active session indicator dot, last-connected time on hover, tags and notes on expand, filter input with clear button
- **Session pane** — multi-tab with protocol color dot, live connection duration timer, session info bar (protocol, host, machine)
- **Context menus** on machines: Add profile, Edit machine, Add credential, Wake on LAN, Delete
- **Context menus** on profiles: Connect, Edit profile, Delete
- Global `Escape` closes any open modal or palette

#### Modals
- **Add Machine** — type grid with icons and descriptions
- **Edit Machine** — update name, type, tags, notes
- **Add Profile** — protocol grid picker, host/port fields, credential selector
- **Edit Profile** — same fields, pre-populated from existing profile
- **Add Credential** — password strength meter (4 bars), Windows Credential Manager notice
- **My Account** — change username and/or password with current-password gate
- **User Manager** — Admin-only: list users, create, update role/password/status, delete
- **Audit Log** — paginated table with actor/action filters, event detail pane

#### Terminal
- xterm.js v5 with `@xterm/addon-fit` (auto-resize to container) and `@xterm/addon-web-links` (clickable URLs)
- 10-second interval session duration counter per tab
- Clean disconnect on tab close

#### Build
- Vite 5 frontend bundler
- Tailwind CSS 3 with custom dark theme (`surface-*` color scale, `accent` blue, `muted` text)
- Release profile: `lto = true`, `codegen-units = 1`, `opt-level = "s"`, `strip = true`
- NSIS installer and MSI package produced alongside portable exe

### Fixed
- `Zeroizing<String>` Serialize/Deserialize errors — resolved by adding `"serde"` feature to zeroize dependency
- `w-84` non-existent Tailwind class in LoginModal — corrected to `w-80`
- `AddProfileModal` cancel button calling global `closeModal` instead of `onClose` prop — fixed prop threading
- Port type mismatch (`u16` vs `u32`) in Telnet connect command — cast at call site

---

*Older versions will be tracked here as they are released.*
