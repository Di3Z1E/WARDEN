import { invoke } from "@tauri-apps/api/core";
import type {
  AppUser,
  AuditEvent,
  CertInfo,
  CertMonitor,
  ConnectionProfile,
  CredentialSet,
  CurrentUser,
  Folder,
  Machine,
  MachineType,
  Protocol,
  Script,
  ScriptLanguage,
  ScriptRun,
  ScriptRunOutput,
} from "../types";

// ── IAM ───────────────────────────────────────────────────────────────────────

export const firstRunCheck = () =>
  invoke<boolean>("cmd_first_run_check");

export const setupAdmin = (username: string, password: string) =>
  invoke<AppUser>("cmd_setup_admin", { input: { username, password } });

export const login = (username: string, password: string) =>
  invoke<{ user: CurrentUser }>("cmd_login", {
    input: { username, password },
  });

export const logout = () => invoke<void>("cmd_logout");

export const getCurrentUser = () =>
  invoke<CurrentUser | null>("cmd_get_current_user");

export const listUsers = () => invoke<AppUser[]>("cmd_list_users");

export const createUser = (
  username: string,
  password: string,
  role: string
) =>
  invoke<AppUser>("cmd_create_user", {
    input: { username, password, role },
  });

export const updateUser = (input: {
  id: string;
  role?: string;
  status?: string;
  new_password?: string;
}) => invoke<void>("cmd_update_user", { input });

export const updateOwnProfile = (input: {
  current_password: string;
  new_username?: string;
  new_password?: string;
}) => invoke<{ id: string; username: string; role: string }>("cmd_update_own_profile", { input });

export const deleteUser = (userId: string) =>
  invoke<void>("cmd_delete_user", { userId });

// ── Folders ───────────────────────────────────────────────────────────────────

export const listFolders = () => invoke<Folder[]>("cmd_list_folders");

export const createFolder = (name: string, parentId?: string) =>
  invoke<Folder>("cmd_create_folder", {
    input: { name, parent_id: parentId ?? null },
  });

export const deleteFolder = (folderId: string) =>
  invoke<void>("cmd_delete_folder", { folderId });

// ── Machines ──────────────────────────────────────────────────────────────────

export const listMachines = () => invoke<Machine[]>("cmd_list_machines");

export const getMachine = (machineId: string) =>
  invoke<Machine>("cmd_get_machine", { machineId });

export const createMachine = (input: {
  name: string;
  machine_type: MachineType;
  folder_id?: string | null;
  tags: string[];
  notes?: string | null;
}) => invoke<Machine>("cmd_create_machine", { input });

export const updateMachine = (
  machineId: string,
  input: {
    name?: string;
    folder_id?: string | null | undefined;
    tags?: string[];
    notes?: string | null | undefined;
  }
) => invoke<Machine>("cmd_update_machine", { machineId, input });

export const deleteMachine = (machineId: string) =>
  invoke<void>("cmd_delete_machine", { machineId });

// ── Connection profiles ───────────────────────────────────────────────────────

export const listProfiles = (machineId: string) =>
  invoke<ConnectionProfile[]>("cmd_list_profiles", { machineId });

export const createProfile = (input: {
  machine_id: string;
  label: string;
  protocol: Protocol;
  host: string;
  port: number;
  options?: Record<string, unknown>;
  credential_set_id?: string | null;
}) => invoke<ConnectionProfile>("cmd_create_profile", { input });

export const updateProfile = (
  profileId: string,
  input: {
    machine_id: string;
    label: string;
    protocol: Protocol;
    host: string;
    port: number;
    options?: Record<string, unknown>;
    credential_set_id?: string | null;
  }
) => invoke<ConnectionProfile>("cmd_update_profile", { profileId, input });

export const deleteProfile = (profileId: string) =>
  invoke<void>("cmd_delete_profile", { profileId });

// ── Credentials ───────────────────────────────────────────────────────────────

export const listCredentialSets = () =>
  invoke<CredentialSet[]>("cmd_list_credential_sets");

export const createCredentialSet = (input: {
  name: string;
  username: string;
  password: string;
}) => invoke<CredentialSet>("cmd_create_credential_set", { input });

export const deleteCredentialSet = (credId: string) =>
  invoke<void>("cmd_delete_credential_set", { credId });

// ── Sessions ──────────────────────────────────────────────────────────────────

export const connectSsh = (input: {
  profile_id: string;
  cols: number;
  rows: number;
}) => invoke<{ id: string; protocol: string; profile_id: string }>("cmd_connect_ssh", { input });

export const connectTelnet = (input: {
  profile_id: string;
}) => invoke<{ id: string; protocol: string; profile_id: string }>("cmd_connect_telnet", { input });

export const sessionWrite = (sessionId: string, data: number[]) =>
  invoke<void>("cmd_session_write", { sessionId, data });

export const sessionResize = (sessionId: string, cols: number, rows: number) =>
  invoke<void>("cmd_session_resize", {
    input: { session_id: sessionId, cols, rows },
  });

export const disconnectSession = (sessionId: string) =>
  invoke<void>("cmd_disconnect_session", { sessionId });

export const listSessions = () =>
  invoke<{ id: string; protocol: string }[]>("cmd_list_sessions");

export const connectRdp = (input: {
  profile_id: string;
  width?: number;
  height?: number;
}) => invoke<{ id: string; protocol: string; profile_id: string }>("cmd_connect_rdp", { input });

export const rdpInput = (input: { session_id: string; data_base64: string }) =>
  invoke<void>("cmd_rdp_input", { input });

// ── SFTP ──────────────────────────────────────────────────────────────────────

export interface DirEntry {
  name: string;
  is_dir: boolean;
  is_link: boolean;
  size: number | null;
  modified: number | null;
  permissions: number | null;
}

export const connectSftp = (input: { profile_id: string }) =>
  invoke<{ id: string; profile_id: string; host: string }>("cmd_connect_sftp", { input });

export const sftpListDir = (session_id: string, path: string) =>
  invoke<DirEntry[]>("cmd_sftp_list_dir", { input: { session_id, path } });

export const sftpReadFile = (session_id: string, path: string) =>
  invoke<{ data_base64: string; size: number }>("cmd_sftp_read_file", {
    input: { session_id, path },
  });

export const sftpWriteFile = (session_id: string, path: string, data_base64: string) =>
  invoke<void>("cmd_sftp_write_file", { input: { session_id, path, data_base64 } });

export const sftpMkdir = (session_id: string, path: string) =>
  invoke<void>("cmd_sftp_mkdir", { input: { session_id, path } });

export const sftpDelete = (session_id: string, path: string, is_dir: boolean) =>
  invoke<void>("cmd_sftp_delete", { input: { session_id, path, is_dir } });

export const sftpRename = (session_id: string, from: string, to: string) =>
  invoke<void>("cmd_sftp_rename", { input: { session_id, from, to } });

export const sftpDisconnect = (session_id: string) =>
  invoke<void>("cmd_sftp_disconnect", { session_id });

// ── Backup / restore ──────────────────────────────────────────────────────────

export const exportConfig = (passphrase: string) =>
  invoke<string>("cmd_export_config", { passphrase });

export interface ImportResult {
  folders: number;
  machines: number;
  profiles: number;
  credentials: number;
}

export const importConfig = (data: string, passphrase: string) =>
  invoke<ImportResult>("cmd_import_config", { data, passphrase });

// ── Audit ─────────────────────────────────────────────────────────────────────

export const queryAudit = (query?: {
  actor?: string;
  action?: string;
  since?: string;
  until?: string;
  limit?: number;
}) => invoke<AuditEvent[]>("cmd_query_audit", { query: query ?? {} });

// ── Power ─────────────────────────────────────────────────────────────────────

export const wakeOnLan = (mac: string, broadcast?: string, machineId?: string) =>
  invoke<void>("cmd_wake_on_lan", {
    input: { mac, broadcast: broadcast ?? null, machine_id: machineId ?? null },
  });

// ── Network / diagnostics ─────────────────────────────────────────────────────

export interface PingResult {
  alive: boolean;
  latency_ms: number | null;
  host: string;
}

export const pingHost = (host: string) =>
  invoke<PingResult>("cmd_ping_host", { host });

export interface NetFsEntry {
  name: string;
  is_dir: boolean;
  size: number | null;
  modified: number | null;
  readonly: boolean;
}

export const netListDir = (path: string) =>
  invoke<NetFsEntry[]>("cmd_net_list_dir", { path });

// ── Scripts ───────────────────────────────────────────────────────────────────

export const listScripts = () => invoke<Script[]>("cmd_list_scripts");

export const createScript = (input: {
  name: string;
  language: ScriptLanguage;
  body: string;
  parameters_json?: string;
}) => invoke<Script>("cmd_create_script", { input });

export const updateScript = (
  scriptId: string,
  input: { name: string; language: ScriptLanguage; body: string; parameters_json?: string }
) => invoke<Script>("cmd_update_script", { scriptId, input });

export const deleteScript = (scriptId: string) =>
  invoke<void>("cmd_delete_script", { scriptId });

export const listScriptRuns = (scriptId?: string) =>
  invoke<ScriptRun[]>("cmd_list_script_runs", { scriptId: scriptId ?? null });

export const getScriptRunOutputs = (runId: string) =>
  invoke<ScriptRunOutput[]>("cmd_get_script_run_outputs", { runId });

export const runScript = (input: { script_id: string; machine_ids: string[] }) =>
  invoke<{ run_id: string }>("cmd_run_script", { input });

export const finishScriptRun = (runId: string) =>
  invoke<void>("cmd_finish_script_run", { runId });

export const saveRunOutput = (input: {
  run_id: string;
  machine_id: string;
  stdout: string;
  stderr: string;
  exit_code: number;
}) => invoke<void>("cmd_save_run_output", { input });

export const bulkExec = (input: { machine_ids: string[]; command: string }) =>
  invoke<{ job_id: string }>("cmd_bulk_exec", { input });

// ── Cert monitor ──────────────────────────────────────────────────────────────

export const checkTlsCert = (input: { host: string; port?: number }) =>
  invoke<CertInfo>("cmd_check_tls_cert", { input });

export const listCertMonitors = () => invoke<CertMonitor[]>("cmd_list_cert_monitors");

export const upsertCertMonitor = (input: {
  id?: string;
  host: string;
  port?: number;
  label?: string;
}) => invoke<CertMonitor>("cmd_upsert_cert_monitor", { input });

export const deleteCertMonitor = (id: string) =>
  invoke<void>("cmd_delete_cert_monitor", { id });

export const refreshCertMonitor = (id: string) =>
  invoke<CertInfo>("cmd_refresh_cert_monitor", { id });

// ── Monitoring / liveness ─────────────────────────────────────────────────────

import type { LivenessResult, MonitorEvent, MonitorRule } from "../types";

export const checkMachineLiveness = (machineId: string) =>
  invoke<LivenessResult>("cmd_check_machine_liveness", { machineId });

export const getLivenessHistory = (machineId: string, limit?: number) =>
  invoke<MonitorEvent[]>("cmd_get_liveness_history", { machineId, limit: limit ?? null });

export const getAllLivenessStatuses = () =>
  invoke<MonitorEvent[]>("cmd_get_all_liveness_statuses");

export const upsertMonitorRule = (input: {
  machine_id: string;
  enabled: boolean;
  notify_desktop: boolean;
  interval_secs?: number;
}) => invoke<MonitorRule>("cmd_upsert_monitor_rule", { input });

export const getMonitorRule = (machineId: string) =>
  invoke<MonitorRule | null>("cmd_get_monitor_rule", { machineId });

export const exportAnsibleInventory = () =>
  invoke<string>("cmd_export_ansible_inventory");

// ── Event log & log tail ──────────────────────────────────────────────────────

import type { EventLogEntry, StartTailResult, MetricsSnapshot, ProcessInfo, ServiceInfo } from "../types";

export const queryEventLog = (input: {
  machine_id: string;
  platform: string;
  log_name: string;
  level?: string;
  source?: string;
  event_id?: number;
  since?: string;
  limit?: number;
}) => invoke<EventLogEntry[]>("cmd_query_event_log", { input });

export const startLogTail = (machineId: string, pathOrUnit: string, platform: string) =>
  invoke<StartTailResult>("cmd_start_log_tail", { machineId, pathOrUnit, platform });

export const stopLogTail = (tailId: string) =>
  invoke<void>("cmd_stop_log_tail", { tailId });

// ── Sysinfo ───────────────────────────────────────────────────────────────────


export const pollMetrics = (machineId: string, platform: string) =>
  invoke<MetricsSnapshot>("cmd_poll_metrics", { machineId, platform });

export const listProcesses = (machineId: string, platform: string) =>
  invoke<ProcessInfo[]>("cmd_list_processes", { machineId, platform });

export const killProcess = (machineId: string, pid: number, platform: string) =>
  invoke<void>("cmd_kill_process", { machineId, pid, platform });

export const listServices = (machineId: string, platform: string) =>
  invoke<ServiceInfo[]>("cmd_list_services", { machineId, platform });

export const controlService = (machineId: string, name: string, action: string, platform: string) =>
  invoke<void>("cmd_control_service", { machineId, name, action, platform });

// ── Network / diagnostics ─────────────────────────────────────────────────────

export const verifyOsAndResetPassword = (
  osUsername: string,
  osPassword: string,
  wardenUsername: string,
  newPassword: string,
) =>
  invoke<void>("cmd_verify_os_and_reset_password", {
    osUsername,
    osPassword,
    wardenUsername,
    newPassword,
  });
