<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=18,18,18,20,30,60,18,18,18&height=200&section=header&text=WARDEN&fontSize=80&fontColor=60a5fa&fontAlignY=45&desc=Windows%20IT%20Administration%20Console&descSize=22&descColor=93c5fd&descAlignY=70&animation=fadeIn" width="100%" />

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&size=22&duration=3000&pause=1000&color=60a5fa&center=true&vCenter=true&width=700&lines=RDP+%C2%B7+SSH+%C2%B7+Telnet+%C2%B7+SFTP+in+one+console+%F0%9F%96%A5%EF%B8%8F;IronRDP+engine%2C+no+mstsc.exe+required+%F0%9F%9A%AB;Windows+Credential+Manager+vault+%F0%9F%94%90;MFA%2FTOTP+%C2%B7+SSH+key+management+%F0%9F%94%91;SHA-256+tamper-evident+audit+log+%F0%9F%93%8B;Single+distributable+binary+%F0%9F%93%A6" alt="Typing SVG" />

<br/>

[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-0078D4?style=for-the-badge&logo=windows&labelColor=1a1a1a)](https://www.microsoft.com/windows)
[![Version](https://img.shields.io/badge/version-0.6.0-60a5fa?style=for-the-badge&labelColor=1a1a1a)](CHANGELOG.md)
[![Tauri](https://img.shields.io/badge/Tauri-v2-FFC131?style=for-the-badge&logo=tauri&labelColor=1a1a1a)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-1.87-CE422B?style=for-the-badge&logo=rust&labelColor=1a1a1a)](https://www.rust-lang.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&labelColor=1a1a1a)](https://react.dev)
[![License](https://img.shields.io/badge/license-MIT-60a5fa?style=for-the-badge&labelColor=1a1a1a)](LICENSE)

<br/>

<a href="#-quick-start"><b><font color="#60a5fa">Quick Start</font></b></a> • <a href="#-features"><b><font color="#60a5fa">Features</font></b></a> • <a href="#%EF%B8%8F-security-design"><b><font color="#60a5fa">Security</font></b></a> • <a href="#-contributing"><b><font color="#60a5fa">Contributing</font></b></a>

</div>

---

## ⚡ Overview

**WARDEN** is a native Windows desktop application that consolidates IT infrastructure management into a single, secure interface. It replaces the fragmented toolset of `mstsc.exe`, standalone SSH clients, browser tabs, and credential spreadsheets with one coherent console built on hardened security principles.

> [!NOTE]
> **0.6.0: Network Visibility.** This release adds HTTP/HTTPS endpoint health monitoring with body-match checks, a live subnet scanner that streams discovered hosts and imports them into inventory in one click, and credential expiry tracking with dashboard alerts. Built on top of the full v0.5.0 feature set: MFA/TOTP, SSH key management, script automation, certificate monitoring, live SSH session panels, and per-machine TCP liveness monitoring.

---

## ✨ Features

### 🖥️ Remote Access
- 🔵 **RDP**: IronRDP pure-Rust engine. TLS upgrade + NLA/CredSSP credential injection. Canvas rendering with full keyboard and mouse forwarding. Zero `mstsc.exe`.
- 🟢 **SSH**: russh 0.60. Full PTY, terminal resize, password auth, public key auth. In-session panels: live system metrics, process manager, service manager, event log viewer, and live log tail.
- 🟡 **Telnet**: async Tokio TCP with IAC option negotiation and clean output stripping.
- 🩵 **SFTP**: russh-sftp file browser. Breadcrumb navigation, upload, download, mkdir, rename, delete. Symlink display.

### 🌐 Network Visibility
- **HTTP/HTTPS health monitoring**: probe any endpoint with configurable method, expected status, body-match, and timeout. Persisted watch list with live status dots, latency, and on-demand refresh.
- **Subnet scanner**: enter a CIDR range (`/8`–`/30`), scan 9 common ports concurrently, see results stream in live. One-click import of any discovered host into inventory.
- **Credential expiry tracking**: set expiry dates on credentials; color-coded badges (green/yellow/red); dashboard alert card for anything expiring within 30 days.

### 🔑 Credential Vault
- **Windows Credential Manager** backend: OS-level AES encryption, no master password
- Password and SSH private key credential types
- Credentials injected at connection time; never rendered to UI, never written to disk
- `Zeroizing<String>` throughout: secrets zeroed from memory on drop

### 🛡️ Identity & Access Management
- Four roles: **Admin**, **Operator**, **Auditor**, **ReadOnly** — enforced in Rust on every command
- **Argon2id** password hashing with per-user random salts
- **MFA/TOTP**: RFC 6238 TOTP two-factor authentication with QR code enrollment; enforced at login
- First-run setup wizard bootstraps the initial Admin account
- Self-service account editing and full admin user management

### 🔐 SSH Key Management
- **Generate** Ed25519 or RSA key pairs directly inside WARDEN
- **Upload** and store private keys in Windows Credential Manager
- **Deploy** public keys to remote hosts via `~/.ssh/authorized_keys`
- **Copy** public key to clipboard from the key manager panel

### 📜 Script Library & Automation
- **Script CRUD**: create, edit, delete PowerShell / Bash / Python scripts stored in SQLite
- **Live streaming runner**: execute a script concurrently across any set of inventory machines via SSH; per-machine output streamed in real time
- **Bulk command execution**: ad-hoc SSH exec across any selection of SSH-capable machines; live per-machine output grid

### 🔬 Certificate Monitor
- **Quick check**: one-off TLS certificate inspection by hostname + port; shows subject, issuer, expiry, SANs, and days remaining
- **Persisted monitors**: watch-list with color-coded expiry badges (green / yellow / red); refresh on demand; last-checked metadata in DB

### 📡 Monitoring & Alerting
- **TCP liveness checks**: per-machine reachability probes on any port, configurable interval
- **Uptime sparklines**: rolling status history on the Dashboard per machine
- **Desktop notifications**: alert on host-down and host-recovered events via Tauri notification plugin
- **Ansible export**: generate a valid Ansible `inventory.yaml` from the machine registry

### 📋 Audit Log
- Append-only SHA-256 hash-chained event log in SQLite
- Covers every auth event, session open/close, inventory mutation, and vault operation
- Filterable by actor, action, and time range; tamper detection via hash chain verification

### 🗂️ Asset Inventory
- Machine registry: Windows Server/Client, Linux, ESXi, IPMI/iDRAC, Network devices
- Multiple connection profiles per host (mix RDP + SSH + SFTP on one machine)
- Folder hierarchy, tags, notes, last-connected timestamps
- **Wake-on-LAN**: raw UDP magic packet dispatch

### 🎛️ User Interface
- **Command Palette** (`Ctrl+K`): fuzzy search across machines, sessions, and actions
- **Dashboard**: stats, quick actions, recent connections, getting-started guide
- Multi-tab session pane with live connection duration timer
- Right-click context menus on every machine and profile node
- Dark theme, built for long operational sessions

---

## 💎 Why WARDEN?

- 🚫 **No external tools**: RDP, SSH, SFTP, Telnet all run inside the process. `mstsc.exe` is never called. *(constraint C-1)*
- 🔒 **No plaintext secrets**: credentials live exclusively in Windows Credential Manager. The SQLite database stores only opaque vault references. *(constraint C-2)*
- 📦 **Single binary**: one `warden.exe`, no installer required. Copy it anywhere and run it. *(constraint C-3)*
- 🪟 **Windows-native**: built on Win32 Credential Manager, the native security model, and WebView2. Not a cross-platform afterthought. *(constraint C-4)*
- 📖 **MIT Licensed**: permissive use for commercial and proprietary environments.

---

## 🛠️ Tech Stack

<div align="left">

**Shell** &nbsp;![Tauri](https://img.shields.io/badge/Tauri%20v2-FFC131?style=flat-square&logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React%2019-61DAFB?style=flat-square&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript%205-3178C6?style=flat-square&logo=typescript&logoColor=white)

**Backend** &nbsp;![Rust](https://img.shields.io/badge/Rust%202021-CE422B?style=flat-square&logo=rust&logoColor=white)
![Tokio](https://img.shields.io/badge/Tokio-async-green?style=flat-square)

**Protocols** &nbsp;![RDP](https://img.shields.io/badge/IronRDP-0.9-0078D4?style=flat-square)
![SSH](https://img.shields.io/badge/russh-0.60-4CAF50?style=flat-square)
![SFTP](https://img.shields.io/badge/russh--sftp-2.x-26C6DA?style=flat-square)
![TLS](https://img.shields.io/badge/tokio--rustls-0.26-orange?style=flat-square)

**Security** &nbsp;![Argon2](https://img.shields.io/badge/Argon2id-password_hashing-7E57C2?style=flat-square)
![TOTP](https://img.shields.io/badge/totp--rs-5-9C27B0?style=flat-square)
![WinCred](https://img.shields.io/badge/Windows%20Credential%20Manager-0078D4?style=flat-square&logo=windows)
![Zeroize](https://img.shields.io/badge/zeroize-secret_hygiene-red?style=flat-square)

**Storage** &nbsp;![SQLite](https://img.shields.io/badge/SQLite-rusqlite%200.40-003B57?style=flat-square&logo=sqlite&logoColor=white)

**UI** &nbsp;![Tailwind](https://img.shields.io/badge/Tailwind%20CSS%20v4-38B2AC?style=flat-square&logo=tailwindcss&logoColor=white)
![xterm](https://img.shields.io/badge/xterm.js%20v6-terminal-333333?style=flat-square)
![Zustand](https://img.shields.io/badge/Zustand%205-state-brown?style=flat-square)
![Vite](https://img.shields.io/badge/Vite%208-bundler-646CFF?style=flat-square&logo=vite&logoColor=white)

</div>

---

## 🚀 Quick Start

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Windows | 10 21H2+ / 11 (x64) | Runtime |
| Rust toolchain | 1.80+ | `rustup install stable` |
| Node.js | 20+ | Frontend build |
| Visual Studio Build Tools | 2022 | MSVC linker, C++ workload |
| WebView2 | Runtime | Bundled with Windows 11; auto-installed on 10 |

<details>
<summary><b>Run in development (hot reload)</b></summary>

```powershell
# Clone and enter the repo
git clone https://github.com/yourname/warden.git
cd warden

# Install frontend dependencies
npm install

# Start dev server (hot-reload frontend + Rust recompile on save)
npm run tauri dev
```

The app opens in a native window. On first launch the **Setup Wizard** creates the initial Admin account.

</details>

<details>
<summary><b>Build a release binary</b></summary>

```powershell
npm run tauri build
```

Outputs in `src-tauri/target/release/`:
```
warden.exe                                    <- portable, no install needed
bundle/nsis/WARDEN_0.6.0_x64-setup.exe       <- NSIS installer
bundle/msi/WARDEN_0.6.0_x64_en-US.msi        <- MSI package
```

App data is stored in `%APPDATA%\com.warden.app\`. The portable exe is fully self-contained; copy it to any Windows 10/11 machine and run.

</details>

<details>
<summary><b>First connection walkthrough</b></summary>

1. Launch `warden.exe` → **Setup Wizard** → set Admin username + password
2. Click `+` in the sidebar → **Add Machine** → pick type, enter name
3. Right-click the machine → **Add profile** → pick protocol (RDP / SSH / SFTP / Telnet), enter host + port
4. Click the key icon → **Add Credential** → enter username + password (stored in Windows Credential Manager)
5. Assign the credential to the profile
6. **Double-click** the profile to connect; session opens in a new tab

</details>

---

## 🔐 Role Reference

| Role | Connect | Manage inventory | Manage users | View audit |
|---|:---:|:---:|:---:|:---:|
| Admin | ✓ | ✓ | ✓ | ✓ |
| Operator | ✓ | ✓ | ✗ | ✗ |
| Auditor | ✗ | read-only | ✗ | ✓ |
| ReadOnly | ✗ | read-only | ✗ | ✗ |

All roles can edit their own username and password via **My Account** (click your username in the top bar).

---

## 🛡️ Security Design

- **Credential storage**: secrets are passed directly to `CredWrite` (Win32) at save time and never touch the WARDEN database. The DB stores only an opaque vault reference key.
- **Memory hygiene**: all credential material is held in `Zeroizing<String>` and zeroed on drop. Passwords are never logged or serialized to the frontend.
- **RDP NLA**: CredSSP pre-authentication is handled entirely in Rust (IronRDP + ReqwestNetworkClient). The canvas frontend receives only RGBA pixel deltas, never protocol state or credentials.
- **SSH/SFTP TOFU**: host keys are accepted and pinned on first connection, with a warning on change.
- **MFA/TOTP**: TOTP codes are verified in Rust before any session is established. QR enrollment uses `totp-rs` with `otpauth` URI format.
- **Audit integrity**: each log entry stores `SHA-256(prev_hash || event_data)`, forming a verifiable chain. Deleted or modified entries break the chain.
- **RBAC enforcement**: role checks happen in the Rust command handlers, not just in the UI. The frontend cannot bypass them.

> [!TIP]
> For a full breakdown of the data model, session isolation, and supply chain posture see [WARDEN-SRS.md](WARDEN-SRS.md).

---

## 🗺️ Roadmap

| Version | Theme | Status |
|---|---|---|
| **v0.1** | Core: IAM, vault, SSH, Telnet, inventory, audit | ✅ Shipped |
| **v0.2** | Remote Desktop: RDP (IronRDP + TLS/NLA) + SFTP file browser | ✅ Shipped |
| **v0.3** | Automation: script library, bulk exec, certificate monitor | ✅ Shipped |
| **v0.4** | Monitoring: TCP liveness, sparklines, desktop alerts, Ansible export, SSH session panels | ✅ Shipped |
| **v0.5** | Security: MFA/TOTP, SSH key management | ✅ Shipped |
| **v0.6** | Network visibility: HTTP monitor, subnet scanner, credential expiry | ✅ Shipped |
| **v0.7** | Multi-user: WARDEN Server, team inventory, group ACLs | 🔄 Planned |

---

## 🤝 Contributing

Contributions are welcome. Keep scope focused and ensure both `cargo check` and `npx tsc --noEmit` pass before submitting. Open an issue first for anything beyond a small bug fix.

Distributed under the **MIT License**. See `LICENSE` for details.

<div align="center">

---

*WARDEN © 2026 Di3Z1E*

</div>
