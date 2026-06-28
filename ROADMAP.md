# WARDEN Roadmap

All tasks reference concrete files, crates, and APIs so each item can be picked up and implemented without additional research.

---

## v0.3 — Automation & Scripting

### Feature 1 — Script Library & Runner

- [ ] Add `scripts` table to SQLite schema: `id, name, language (powershell|bash|python), body, parameters_json, created_at, updated_at`
- [ ] Add `script_runs` table: `id, script_id, machine_ids_json, started_at, finished_at, triggered_by`
- [ ] Add `script_run_outputs` table: `id, run_id, machine_id, stdout, stderr, exit_code, finished_at`
- [ ] Rust: create `src-tauri/src/scripts/mod.rs` with CRUD helpers mirroring `inventory/mod.rs` style
- [ ] Rust: create `src-tauri/src/commands/scripts.rs` — `cmd_list_scripts`, `cmd_create_script`, `cmd_update_script`, `cmd_delete_script`
- [ ] Rust: `cmd_run_script(script_id, machine_ids, param_values)` — opens an SSH session per machine, streams stdout/stderr via `tauri::Emitter` event `script:output:{run_id}:{machine_id}`, writes result rows on completion
- [ ] Register all script commands in `lib.rs` invoke handler
- [ ] Frontend: `src/components/ScriptLibrary/ScriptLibrary.tsx` — sidebar panel with script list, Monaco-style `<textarea>` editor (or CodeMirror via `@uiw/react-codemirror`), parameter definition UI
- [ ] Frontend: `src/components/ScriptRunner/ScriptRunner.tsx` — machine multi-select (checkbox tree from `AssetTree`), parameter form, "Run" button, per-machine output panels with live streaming
- [ ] Frontend: add "Scripts" nav item to `Header.tsx` and modal type to `UiStore`
- [ ] Audit: log `SCRIPT_RUN` events with script name, machine count, and actor

---

### Feature 2 — Bulk Command Execution

- [ ] Rust: `cmd_bulk_exec(machine_ids: Vec<String>, command: String, use_sudo: bool)` in `commands/scripts.rs` — spawns one SSH session per machine concurrently via `tokio::spawn`, streams output events `bulk:output:{job_id}:{machine_id}`
- [ ] Frontend: `src/components/BulkExec/BulkExec.tsx` — quick-fire modal: machine multi-select, single command text field, real-time status grid (pending / running / ok / error) with expandable output per row
- [ ] Frontend: add "Run on Many" option to `AssetTree` right-click menu when multiple machines are selected
- [ ] Add `BULK_EXEC` audit event covering which machines were targeted and the command hash (not the command itself to avoid logging secrets)

---

### Feature 3 — Scheduled Tasks

- [ ] Add `scheduled_tasks` table: `id, script_id, machine_ids_json, cron_expr, enabled, last_run_at, next_run_at, created_by`
- [ ] Add `tokio-cron-scheduler = "0.11"` to `Cargo.toml`
- [ ] Rust: `src-tauri/src/scheduler/mod.rs` — on startup, load all enabled tasks from DB, register with `JobScheduler`; on job fire, call the existing `cmd_run_script` logic directly
- [ ] Rust: commands `cmd_list_scheduled_tasks`, `cmd_create_scheduled_task`, `cmd_update_scheduled_task`, `cmd_delete_scheduled_task`, `cmd_enable_scheduled_task`
- [ ] Frontend: `src/components/modals/ScheduledTaskModal.tsx` — cron expression builder (human-readable preview), script picker, machine picker, enable toggle
- [ ] Frontend: scheduled task list view inside `ScriptLibrary` panel with next/last run timestamps
- [ ] Emit a Tauri notification (`tauri-plugin-notification`) when a scheduled task fails

---

### Feature 4 — SSH Port Forwarding Manager

- [ ] Rust: extend `SessionHandle` with an optional `Vec<ForwardedPort>` field
- [ ] Rust: `cmd_add_forward(session_id, kind: "local"|"remote"|"dynamic", local_port, remote_host, remote_port)` — opens a `direct-tcpip` or `tcpip-forward` channel on the existing russh session
- [ ] Rust: `cmd_list_forwards(session_id)` and `cmd_remove_forward(session_id, forward_id)`
- [ ] Rust: for dynamic (SOCKS5), spawn a local TCP listener that wraps each incoming connection in a `direct-tcpip` channel with the target from the SOCKS5 handshake
- [ ] Frontend: port forward panel inside `SessionContent` for SSH tabs — table of active tunnels (type, local port, remote, status), "Add Tunnel" form, remove button per row
- [ ] Frontend: show a small tunnel-count badge on the SSH tab label when tunnels are active

---

### Feature 5 — Ansible Playbook Export

- [ ] Rust: `cmd_export_ansible(machine_ids: Vec<String>, script_id: Option<String>)` in `commands/scripts.rs`
  - Query machine records + SSH profiles + credential usernames from inventory
  - Render an INI-format Ansible inventory string grouping machines by `machine_type`
  - If `script_id` provided, render a minimal playbook YAML with a `shell` task for the script body
  - Return both as `{ inventory: String, playbook: Option<String> }`
- [ ] Frontend: "Export as Ansible" button in `ScriptRunner` and in the machine group right-click menu
- [ ] Frontend: result modal with two copy-to-clipboard tabs (inventory / playbook) and a download button each

---

## v0.4 — Monitoring & Diagnostics

### Feature 6 — Uptime Monitor & Alerting

- [ ] Add `monitor_rules` table: `id, machine_id, check_interval_secs, consecutive_failures_threshold, enabled, notify_desktop, notify_webhook_url, created_at`
- [ ] Add `monitor_events` table: `id, machine_id, ts, state (up|down), latency_ms`
- [ ] Rust: `src-tauri/src/monitor/mod.rs` — background Tokio task spawned at startup; for each enabled rule, runs `cmd_ping_host` on the interval and records state transitions
- [ ] Rust: on state change to `down`, emit a Tauri event `monitor:alert:{machine_id}` and (if configured) POST JSON to the webhook URL via `reqwest`
- [ ] Rust: commands `cmd_list_monitor_rules`, `cmd_upsert_monitor_rule`, `cmd_delete_monitor_rule`, `cmd_query_monitor_events`
- [ ] Frontend: `src/components/modals/MonitorRuleModal.tsx` — per-machine monitor config: interval, failure threshold, notification toggles, webhook URL field
- [ ] Frontend: uptime sparkline (last 30 checks) on each machine card in `AssetTree` and on `Dashboard`
- [ ] Frontend: notification toast when `monitor:alert` event fires

---

### Feature 7 — Live System Metrics

- [ ] Add `metrics` crate (no new Rust crate needed — collect via SSH commands)
- [ ] Rust: `cmd_poll_metrics(session_id, platform: "windows"|"linux")` — runs a one-shot SSH command per platform:
  - Windows: `Get-WmiObject Win32_Processor | Select LoadPercentage; Get-WmiObject Win32_OperatingSystem | Select FreePhysicalMemory,TotalVisibleMemorySize`
  - Linux: parse `/proc/stat` and `/proc/meminfo` output
  - Returns `{ cpu_pct: f32, ram_used_mb: u64, ram_total_mb: u64, uptime_secs: u64 }`
- [ ] Rust: `cmd_start_metrics_stream(session_id)` — spawns a looping task that calls the poll logic every 5 s and emits `metrics:update:{session_id}` events; `cmd_stop_metrics_stream(session_id)` cancels it
- [ ] Frontend: `src/components/MetricsPanel/MetricsPanel.tsx` — CPU/RAM bar gauges + sparkline history (last 60 samples, ring buffer in component state), shown as an overlay or side panel inside an SSH or RDP `SessionContent`
- [ ] Frontend: "Metrics" toggle button next to the existing "Files" button in `SessionContent`

---

### Feature 8 — Remote Process Manager

- [ ] Rust: `cmd_list_processes(session_id, platform)` — runs `Get-Process | Select Id,ProcessName,CPU,WorkingSet | ConvertTo-Json` (Windows) or `ps -eo pid,comm,%cpu,%mem --no-headers` (Linux) over SSH; parses JSON/text; returns `Vec<ProcessInfo>`
- [ ] Rust: `cmd_kill_process(session_id, pid, signal: Option<i32>)` — `Stop-Process -Id {pid} -Force` / `kill -{signal} {pid}` over SSH
- [ ] Frontend: `src/components/ProcessManager/ProcessManager.tsx` — sortable table (PID, name, CPU%, memory), search filter, refresh button (auto-refresh every 10 s when open), kill button per row with confirmation prompt
- [ ] Frontend: "Processes" toggle button in `SessionContent` (same pattern as Files/Metrics)

---

### Feature 9 — Windows Service Manager

- [ ] Rust: `cmd_list_services(session_id)` — `Get-Service | Select Name,DisplayName,Status,StartType | ConvertTo-Json` over SSH; returns `Vec<ServiceInfo>`
- [ ] Rust: `cmd_control_service(session_id, name, action: "start"|"stop"|"restart"|"set-startup")` — runs appropriate `Set-Service` / `Start-Service` / `Stop-Service` PowerShell cmdlet
- [ ] Frontend: `src/components/ServiceManager/ServiceManager.tsx` — table with status badge (green=Running, gray=Stopped, yellow=Paused), startup type dropdown, action buttons; search filter; refresh on open
- [ ] Frontend: "Services" toggle button in `SessionContent` (Windows machines only, detected from `machine_type`)

---

### Feature 10 — Windows Event Log Viewer

- [ ] Rust: `cmd_query_event_log(session_id, log_name, level: Option<String>, source: Option<String>, event_id: Option<u32>, since: Option<String>, limit: u32)` — builds and runs `Get-WinEvent -FilterHashtable @{...} | Select TimeCreated,Id,LevelDisplayName,Message,ProviderName | ConvertTo-Json` over SSH
- [ ] Rust: return `Vec<EventLogEntry>` with typed fields
- [ ] Frontend: `src/components/EventLogViewer/EventLogViewer.tsx` — log selector (System/Application/Security/custom), level filter chips (Error/Warning/Info), source and event-ID text inputs, time range pickers, virtualized list of entries, expandable message body, copy-to-clipboard per entry
- [ ] Frontend: "Events" toggle button in `SessionContent` (Windows only)

---

### Feature 11 — Remote Log Tail

- [ ] Rust: `cmd_start_log_tail(session_id, path_or_unit: String, platform)` — runs `tail -f {path}` or `journalctl -fu {unit}` (Linux) / `Get-Content -Wait -Path {path}` (Windows) as a long-running SSH channel; streams each new line as a Tauri event `logtail:line:{tail_id}`
- [ ] Rust: `cmd_stop_log_tail(tail_id)` — closes the channel
- [ ] Frontend: `src/components/LogTail/LogTail.tsx` — path/unit input, start/stop button, xterm.js output (reuse existing `Terminal` component with a read-only flag), regex highlight filter, line-count badge, pause toggle
- [ ] Frontend: "Log Tail" tab available inside any SSH or RDP `SessionContent`

---

### Feature 12 — Remote File Editor

- [ ] Rust: `cmd_sftp_read_text(session_id, path)` — reads the file via SFTP, returns `{ content: String, encoding: String }` (detect UTF-8 vs UTF-16 via BOM); reuse existing `cmd_sftp_read_file`
- [ ] Rust: `cmd_sftp_write_text(session_id, path, content, encoding)` — converts to bytes and calls the existing `cmd_sftp_write_file`
- [ ] Frontend: `src/components/RemoteFileEditor/RemoteFileEditor.tsx` — opens when double-clicking a text file in `FileBrowser`; Monaco editor (`@monaco-editor/react`) with language auto-detection from file extension; toolbar with Save (Ctrl+S), Save As, word-wrap toggle, encoding selector
- [ ] Frontend: track unsaved changes with a dirty-state dot on the editor tab title, confirm-before-close prompt

---

### Feature 13 — Certificate / SSL Expiry Monitor

- [ ] Rust: `cmd_check_tls_cert(host, port)` — open a TLS connection (using existing `tokio-rustls`), pull `peer_certificates()[0]`, parse with `x509-cert` (already in Cargo.toml), return `{ subject, sans, issuer, not_after, days_remaining }`
- [ ] Rust: `cmd_list_cert_monitors` / `cmd_upsert_cert_monitor` / `cmd_delete_cert_monitor` — store checked endpoints in a `cert_monitors` SQLite table
- [ ] Frontend: `src/components/CertMonitor/CertMonitor.tsx` — table of monitored endpoints: host:port, CN, expiry date, days-remaining badge (green/yellow/red), last-checked timestamp, "Check Now" button
- [ ] Background: integrate cert checks into the monitor daemon (Feature 6) — emit `monitor:cert_expiring` event when ≤30 days remain

---

### Feature 14 — Network Discovery / Asset Scan

- [ ] Rust: `cmd_scan_subnet(cidr: String)` — parse CIDR with `ipnetwork = "0.23"` crate (add to Cargo.toml); iterate host addresses; for each, spawn a task that:
  1. Sends ICMP echo via raw socket (`socket2`, already in Cargo.toml)
  2. If alive, probes ports 22 (SSH), 3389 (RDP), 5900 (VNC) with a 1 s TCP connect timeout
  3. Attempts reverse DNS via `tokio::net::lookup_host`
  - Stream results as they arrive via Tauri event `scan:result`
- [ ] Frontend: `src/components/NetworkScanner/NetworkScanner.tsx` — CIDR input, scan progress bar, result table (IP, hostname, open ports, reachable), "Add to Inventory" button per row that pre-fills `AddMachineModal`
- [ ] Add `ipnetwork` crate to `Cargo.toml`

---

## v0.5 — Identity, Access & Compliance

### Feature 15 — MFA / TOTP Enforcement

- [ ] `totp-rs` is already in `Cargo.toml` — wire it up
- [ ] DB migration: `mfa_secret_ref` column already exists in `app_users`; add `mfa_enabled BOOLEAN NOT NULL DEFAULT 0`
- [ ] Rust: `cmd_mfa_provision(user_id)` — generate a TOTP secret, store encrypted in vault (new vault kind `Totp`), store vault ref in `mfa_secret_ref`, return `{ otpauth_url, qr_png_base64 }` (use `totp-rs` QR feature)
- [ ] Rust: `cmd_mfa_verify_and_enable(user_id, code)` — verify the first TOTP code, set `mfa_enabled = 1`
- [ ] Rust: `cmd_mfa_disable(user_id, current_password)` — verify password, delete vault entry, clear `mfa_secret_ref`, set `mfa_enabled = 0`
- [ ] Rust: modify `cmd_login` — after password verify, if `mfa_enabled`, return `{ status: "mfa_required", token: ephemeral_token }` instead of setting `current_user`; add `cmd_login_mfa(ephemeral_token, totp_code)` that completes the login
- [ ] Frontend: `LoginModal` — add a second step that appears when `status === "mfa_required"`: 6-digit code input with auto-submit on 6th digit
- [ ] Frontend: `MyAccountModal` — "Enable Two-Factor Auth" section: QR code display, verification input, enable button; "Disable 2FA" confirmation flow
- [ ] Audit: log `MFA_ENABLED`, `MFA_DISABLED`, `MFA_FAIL` events

---

### Feature 16 — SSH Key Management

- [ ] Rust: `cmd_generate_ssh_key(name, key_type: "ed25519"|"rsa4096")` — generate keypair using `ssh-key = "0.6"` crate (add to Cargo.toml); store private key in vault as `SshKey` kind; return public key OpenSSH string and fingerprint
- [ ] Rust: `cmd_deploy_public_key(credential_set_id, target_session_id)` — retrieve the public key from vault, append to `~/.ssh/authorized_keys` on the target machine via the existing SFTP session
- [ ] Rust: `cmd_rotate_ssh_key(credential_set_id, target_machine_ids)` — generate new key, deploy to all targets, update vault, revoke old key from `authorized_keys`
- [ ] Frontend: `src/components/modals/SshKeyModal.tsx` — key list (name, type, fingerprint, created date, which profiles use it), "Generate New Key" button, "Deploy to Machine" action, "Copy Public Key" button, delete with confirmation
- [ ] Add `ssh-key` crate to `Cargo.toml`

---

### Feature 17 — Temporary / Time-Limited Access Grants

- [ ] DB: add `expires_at TEXT` column to `credential_sets`
- [ ] Rust: modify `vault::retrieve` — after fetching from Credential Manager, check `expires_at`; if past, delete the vault entry + DB row and return `AppError::Expired`
- [ ] Rust: `cmd_create_temp_credential(input: { ..., expires_in_minutes: u32 })` — sets `expires_at = now + duration`
- [ ] Rust: background task (part of the monitor daemon) — every hour, query `credential_sets WHERE expires_at < now`, delete expired vault entries and rows, emit `vault:expired:{id}` event and write audit log
- [ ] Frontend: `AddCredentialModal` — add "Temporary credential" toggle that reveals a duration picker (hours/days); show expiry badge on credential list entries; highlight expired/expiring-soon entries in yellow/red

---

### Feature 18 — Password Rotation Engine

- [ ] DB: add `rotation_schedule_cron TEXT, last_rotated_at TEXT, rotation_enabled BOOLEAN` columns to `credential_sets`
- [ ] Rust: `cmd_rotate_password(credential_set_id)`:
  1. Generate a cryptographically random password (configurable length/charset)
  2. Call the existing `cmd_verify_os_and_reset_password` logic to push the new password to the OS
  3. Update the vault entry via `vault::store`
  4. Write `CREDENTIAL_ROTATED` audit event
- [ ] Rust: integrate with the scheduler (Feature 3) — allow a `credential_set_id` instead of `script_id` to create a rotation schedule
- [ ] Frontend: `AddCredentialModal` / credential list — "Enable Auto-Rotation" toggle, cron picker (daily/weekly/monthly presets + custom), "Rotate Now" button, last-rotated timestamp badge

---

### Feature 19 — Compliance Report Generator

- [ ] Rust: add `printpdf = "0.7"` or use HTML-to-PDF via a headless WebView approach; alternatively generate HTML and let the OS print
- [ ] Rust: `cmd_generate_compliance_report(params: { since, until, actor_filter, format: "html"|"json" })`:
  - Query audit log with filters
  - Aggregate: total sessions by protocol, unique machines accessed, failed logins, credential operations, avg session duration
  - Render HTML template with embedded CSS (no external assets) or return raw JSON
- [ ] Frontend: `src/components/modals/ComplianceReportModal.tsx` — date range picker, actor filter, format selector, "Generate" button, preview in an `<iframe>` for HTML, "Download" button (`<a>` with blob URL)
- [ ] Add report-generation button to `AuditLogModal` for quick access

---

### Feature 20 — Webhook / Email Alerting

- [ ] DB: `alert_rules` table: `id, event_type (machine_down|login_fail|cert_expiring|service_stopped|script_fail), notify_webhook_url, notify_email, throttle_minutes, enabled`
- [ ] Rust: `src-tauri/src/alerting/mod.rs` — `fire_alert(event_type, context_json)` function; checks `alert_rules`, respects throttle (track last-fired timestamps in memory), POSTs webhook JSON or sends email via SMTP
- [ ] Rust: add `lettre = "0.11"` to `Cargo.toml` for SMTP email sending
- [ ] Rust: `cmd_list_alert_rules`, `cmd_upsert_alert_rule`, `cmd_delete_alert_rule`, `cmd_test_alert(rule_id)` — test fires a sample payload
- [ ] Frontend: `src/components/modals/AlertRulesModal.tsx` — per-event-type rows with webhook URL input, email input, throttle minutes, enable toggle, "Test" button with delivery confirmation toast

---

## v0.6 — Remote Desktop Advanced

### Feature 21 — RDP CLIPRDR (Bidirectional Clipboard)

- [ ] Add `ironrdp-cliprdr` to `Cargo.toml` (coordinate version with existing IronRDP crates)
- [ ] Rust: during `connect_finalize`, attach the CLIPRDR static virtual channel handler
- [ ] Rust: handle `ClipboardEvent::ServerFormatList` — when server announces new clipboard data, request `CF_UNICODETEXT` via `FORMAT_DATA_REQUEST`
- [ ] Rust: handle `ClipboardEvent::ServerFormatData` — receive text bytes, emit `rdp:clipboard:{session_id}` Tauri event with UTF-8 text payload
- [ ] Rust: `cmd_rdp_set_clipboard(session_id, text)` — send `CLIENT_FORMAT_LIST` + `FORMAT_DATA_RESPONSE` to push local text to the server clipboard
- [ ] Frontend `RdpSession.tsx`: listen to `rdp:clipboard:{sessionId}` event → write to `navigator.clipboard.writeText()` (copy FROM RDP to local)
- [ ] Frontend: when user presses Ctrl+C in a focused RDP session, suppress the Unicode paste path and instead call `cmd_rdp_set_clipboard` after the server-side copy completes (requires listening for FORMAT_LIST from server)

---

### Feature 22 — RDP & SSH Session Recording

- [ ] Rust: `src-tauri/src/recording/mod.rs`
  - For RDP: intercept each `GraphicsUpdate` before emitting to frontend; collect `(timestamp_ms, x, y, w, h, rgba_bytes)` frames into a write-buffered file in `%APPDATA%\com.warden.app\recordings\`
  - For SSH: intercept each stdout chunk before emitting to xterm.js; write asciinema v2 JSON lines `[elapsed, "o", data]`
- [ ] Rust: `cmd_start_recording(session_id)`, `cmd_stop_recording(session_id)` — returns path to the saved file
- [ ] Rust: `cmd_list_recordings()`, `cmd_delete_recording(path)`, `cmd_export_recording(path, format: "mp4"|"asciinema")`
- [ ] Frontend: recording indicator (red dot) in the session tab when active; "Record" / "Stop" button in the session info bar
- [ ] Frontend: `src/components/RecordingPlayer/RecordingPlayer.tsx` — asciinema player (use `asciinema-player` npm package) for SSH recordings; frame-scrubber for RDP recordings
- [ ] Add `recordings` table: `id, session_id, machine_id, actor, protocol, started_at, finished_at, file_path, file_size`

---

### Feature 23 — RDP RemoteApp Mode

- [ ] Rust: in `rdp::RdpParams`, add `remote_app: Option<RemoteAppConfig>` with fields `program: String, working_dir: String, cmdline: String`
- [ ] Rust: in `build_config`, if `remote_app` is set: populate `alternate_shell = "||{program}"`, `work_dir`, `client_info.flags |= INFO_RAIL` (RemoteApp flag)
- [ ] Rust: handle `RAIL` channel events from IronRDP (if supported) to manage RemoteApp window lifecycle
- [ ] Frontend: `AddProfileModal` — add "RemoteApp" checkbox that reveals program path, working directory, and command-line arguments fields; stored in `profile.options["remote_app"]`
- [ ] Frontend: `RdpSession.tsx` — in RemoteApp mode, show the canvas without the full-desktop chrome; size canvas to match the remote app window size (received via RAIL window info PDU)

---

### Feature 24 — VNC Support

- [ ] Add `vnc = "0.3"` or similar pure-Rust VNC crate to `Cargo.toml`; alternatively implement RFB 3.8 protocol directly (it is simple enough)
- [ ] Rust: `src-tauri/src/protocols/vnc.rs` — connect (TCP → optional TLS → RFB handshake → security type negotiation → `VNC Authentication` using vault credential), handle `FramebufferUpdate` rectangles (Raw, CopyRect, RRE encodings minimum), emit `rdp:frame:{session_id}` events in the same format as the RDP renderer so the frontend canvas works unchanged
- [ ] Rust: `cmd_connect_vnc(input: { profile_id, width, height })` following the same pattern as `cmd_connect_rdp`
- [ ] Rust: VNC keyboard/mouse input via `KeyEvent` and `PointerEvent` messages; reuse the same `cmd_rdp_input` flow (or add a separate `cmd_vnc_input`)
- [ ] Frontend: `SessionContent` — `tab.protocol === "VNC"` renders `<RdpSession>` (canvas is protocol-agnostic); no other frontend changes needed

---

## v0.7 — Infrastructure Management

### Feature 25 — IPMI / iDRAC Out-of-Band Management

- [ ] Rust: `src-tauri/src/protocols/ipmi.rs` — implement IPMI-over-LAN (RMCP+, UDP port 623):
  - Session establishment (RAKP messages for IPMI 2.0)
  - `Get Chassis Status` (power state)
  - `Chassis Control` (power on/off/reset/cycle)
  - `Get SDR` (sensor data records — temperatures, fans, voltages)
  - Uses `socket2` (already in Cargo.toml) for raw UDP
- [ ] Rust: `cmd_ipmi_get_status(machine_id)`, `cmd_ipmi_power_control(machine_id, action)`, `cmd_ipmi_get_sensors(machine_id)`
- [ ] Frontend: `src/components/IpmiPanel/IpmiPanel.tsx` — power status indicator, power-on/off/reset buttons, sensor readings table (name, value, unit, threshold status badge); accessible from machine detail view for `IpmiIdrac` machine types
- [ ] Frontend: `AssetTree` right-click menu for `IpmiIdrac` machines — "Power On", "Power Off", "Reset", "Open IPMI Panel"

---

### Feature 26 — VMware vSphere / ESXi VM Manager

- [ ] Rust: `src-tauri/src/protocols/vsphere.rs` — REST client against vCenter API (`/rest/vcenter/vm`):
  - `cmd_vsphere_list_vms(machine_id)` — GET `/rest/vcenter/vm`, return `Vec<VmInfo>`
  - `cmd_vsphere_get_vm(machine_id, vm_id)` — power state, hardware config, snapshot list
  - `cmd_vsphere_power_action(machine_id, vm_id, action: "on"|"off"|"suspend"|"reset")` — POST to `/rest/vcenter/vm/{vm}/power/{action}`
  - `cmd_vsphere_create_snapshot(machine_id, vm_id, name)` / `cmd_vsphere_revert_snapshot`
  - Credentials from vault (store vCenter URL + API key/session)
  - Uses `reqwest` (already in Cargo.toml)
- [ ] Frontend: `src/components/VspherePanel/VspherePanel.tsx` — VM list with power-state badges, per-VM actions dropdown, snapshot tree, resource utilization bars

---

### Feature 27 — Docker Container Manager

- [ ] Rust: `src-tauri/src/protocols/docker.rs` — forward Docker socket over SSH (`/var/run/docker.sock`) via SSH `direct-streamlocal` channel (UNIX domain socket forwarding, RFC draft), then speak Docker Engine REST API over the forwarded channel:
  - `cmd_docker_list_containers(session_id)`, `cmd_docker_container_action(session_id, id, action: "start"|"stop"|"restart"|"remove")`
  - `cmd_docker_stream_logs(session_id, container_id)` — attach to container logs, emit `docker:log:{container_id}` events
  - `cmd_docker_exec(session_id, container_id, cmd)` — returns a new session ID that routes to a `docker exec -it` PTY; rendered in a Terminal tab
- [ ] Frontend: `src/components/DockerPanel/DockerPanel.tsx` — container list (name, image, status, ports), per-container action buttons, "Logs" button opening a log tail, "Exec" button opening a terminal tab

---

### Feature 28 — Hardware & Software Inventory Collector

- [ ] Rust: `cmd_collect_inventory(session_id, platform)` — runs a platform-specific collection script over SSH:
  - Windows: `Get-WmiObject Win32_ComputerSystem, Win32_Processor, Win32_PhysicalMemory, Win32_DiskDrive, Win32_NetworkAdapterConfiguration, Win32_Product | ConvertTo-Json`
  - Linux: `lscpu`, `free -b`, `lsblk -J`, `ip -j addr`, `dpkg -l` / `rpm -qa`
  - Parse JSON/text, normalize into `HardwareSnapshot` + `Vec<SoftwareEntry>` structs
- [ ] DB: `inventory_snapshots` table: `id, machine_id, collected_at, hardware_json, software_json`
- [ ] Rust: `cmd_list_inventory_snapshots(machine_id)`, `cmd_diff_inventory_snapshots(snap_a_id, snap_b_id)` — returns added/removed software and changed hardware values
- [ ] Frontend: machine detail panel with "Inventory" tab showing hardware specs and searchable software list; diff view between two snapshots highlighted in green/red

---

### Feature 29 — Active Directory Browser

- [ ] Add `ldap3 = "0.11"` to `Cargo.toml`
- [ ] Rust: `src-tauri/src/protocols/ldap.rs`:
  - `cmd_ldap_connect(machine_id)` — open LDAPS (636) or LDAP+STARTTLS (389) connection using `ldap3`, bind with stored credentials, return a session ID stored in `AppState`
  - `cmd_ldap_browse(session_id, base_dn, scope: "base"|"one"|"sub")` — search with `(objectClass=*)`, return `Vec<LdapEntry>` with DN and key attributes
  - `cmd_ldap_get_entry(session_id, dn)` — full attribute list for one object
  - `cmd_ldap_reset_password(session_id, user_dn, new_password)` — modify `unicodePwd` attribute
  - `cmd_ldap_modify(session_id, dn, changes)` — generic attribute modify for admin operations
- [ ] Frontend: `src/components/LdapBrowser/LdapBrowser.tsx` — tree view of the DIT (directory information tree) with expand/collapse per OU, attribute panel on right, search bar (LDAP filter input), password-reset button on user objects
- [ ] Frontend: connection profiles with `protocol = "HTTP"` repurposed as LDAP (or add `LDAP` to the `Protocol` enum in both TS types and Rust inventory)

---

### Feature 30 — Multi-User WARDEN Server

- [ ] Design: WARDEN Server is a separate Rust binary (add `[[bin]] name = "warden-server"`) that runs as a Windows service or Linux daemon
- [ ] Server: expose a REST + WebSocket API secured with mTLS; clients (WARDEN desktop instances) register and authenticate via a shared enrollment token
- [ ] Server DB: shared SQLite (or Postgres with `sqlx`) — shared `machines`, `folders`, `credential_sets` tables; per-user `app_users` table with `team_id` foreign key
- [ ] Server: group ACL model — `teams`, `team_members`, `machine_acls (machine_id, team_id, permission: view|connect|admin)` tables; enforce in every API handler
- [ ] Server: proxied session relay — WARDEN desktop connects to the server's WebSocket, server forwards traffic to the target machine; this avoids each desktop needing direct network access to every machine
- [ ] Client: `src-tauri/src/sync/mod.rs` — background task that syncs inventory from the server on startup and pushes local changes; conflict resolution: server wins on shared resources, local wins on personal items
- [ ] Client: `cmd_server_connect(url, enrollment_token)`, `cmd_server_disconnect`, `cmd_server_status`
- [ ] Frontend: server connection indicator in `Header`; shared-machine entries in `AssetTree` show a team badge; "Shared with team" toggle on `AddMachineModal`
- [ ] Deployment: ship `warden-server.exe` alongside `warden.exe`; include a `warden-server.toml` config for bind address, DB path, TLS cert paths

---

## Cross-Cutting Tasks (apply to all versions)

- [ ] Fix all 6 pre-existing `unused_mut` warnings in `src-tauri/src/commands/sftp.rs`
- [ ] Add database migration system: version the schema, apply migrations on startup instead of re-running `CREATE TABLE IF NOT EXISTS` (use a `migrations/` folder with numbered SQL files)
- [ ] Add `cargo-audit` to CI and run it on every build to catch known CVEs in dependencies
- [ ] Bundle size: split the frontend JS bundle — lazy-load `ScriptLibrary`, `EventLogViewer`, `LdapBrowser` etc. with `React.lazy` + `Suspense` to reduce initial load time
- [ ] End-to-end tests: add Tauri's `tauri-driver` + `WebDriver` based tests for the critical flows (login, add machine, connect SSH, disconnect)
- [ ] Localization: extract all UI strings into a `i18n/en.json` file and wire up `i18next` to enable future translations

---

*Last updated: 2026-06-28 — v0.2.0 shipped (RDP + SFTP). Next milestone: v0.3 Automation.*
