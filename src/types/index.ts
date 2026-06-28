// ── IAM ───────────────────────────────────────────────────────────────────────

export type Role = "Admin" | "Operator" | "Auditor" | "ReadOnly";

export interface AppUser {
  id: string;
  username: string;
  role: Role;
  mfa_secret_ref: string | null;
  status: "active" | "disabled";
  created_at: string;
  updated_at: string;
}

export interface CurrentUser {
  id: string;
  username: string;
  role: Role;
}

// ── Inventory ─────────────────────────────────────────────────────────────────

export type MachineType =
  | "WindowsServer"
  | "WindowsClient"
  | "Linux"
  | "EsxiVsphere"
  | "IpmiIdrac"
  | "NetworkDevice"
  | "GenericSsh"
  | "Generic";

export interface Folder {
  id: string;
  parent_id: string | null;
  name: string;
  dynamic_filter: string | null;
  created_at: string;
}

export interface Machine {
  id: string;
  name: string;
  machine_type: MachineType;
  folder_id: string | null;
  tags: string[];
  notes: string | null;
  last_connected_at: string | null;
  created_at: string;
  updated_at: string;
}

export type Protocol = "SSH" | "RDP" | "Telnet" | "VNC" | "SFTP" | "HTTP";

export interface ConnectionProfile {
  id: string;
  machine_id: string;
  label: string;
  protocol: Protocol;
  host: string;
  port: number;
  options: Record<string, unknown>;
  credential_set_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CredentialSet {
  id: string;
  name: string;
  kind: "Password" | "SshKey";
  vault_ref: string;
  username: string | null;
  created_at: string;
  updated_at: string;
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export interface ActiveSession {
  id: string;
  protocol: Protocol;
  profileId: string;
  machineId: string;
  machineName: string;
  profileLabel: string;
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export interface AuditEvent {
  id: string;
  ts: string;
  actor: string;
  action: string;
  target: string | null;
  result: "ok" | "denied" | "error";
  detail: string | null;
  hash_prev: string | null;
}

// ── Scripts ───────────────────────────────────────────────────────────────────

export type ScriptLanguage = "powershell" | "bash" | "python";

export interface Script {
  id: string;
  name: string;
  language: ScriptLanguage;
  body: string;
  parameters_json: string;
  created_at: string;
  updated_at: string;
}

export interface ScriptRun {
  id: string;
  script_id: string | null;
  machine_ids_json: string;
  started_at: string;
  finished_at: string | null;
  triggered_by: string;
}

export interface ScriptRunOutput {
  id: string;
  run_id: string;
  machine_id: string;
  stdout: string | null;
  stderr: string | null;
  exit_code: number | null;
  finished_at: string | null;
}

// ── Cert monitor ──────────────────────────────────────────────────────────────

export interface CertMonitor {
  id: string;
  host: string;
  port: number;
  label: string | null;
  last_checked_at: string | null;
  last_subject: string | null;
  last_not_after: string | null;
  last_days_remaining: number | null;
  created_at: string;
}

export interface CertInfo {
  host: string;
  port: number;
  subject: string;
  issuer: string;
  not_after: string;
  days_remaining: number;
  sans: string[];
}

// ── API response wrapper ──────────────────────────────────────────────────────

export interface CmdError {
  code: string;
  message: string;
}
