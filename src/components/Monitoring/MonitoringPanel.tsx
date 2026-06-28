import { useEffect, useState, useCallback } from "react";
import { Activity, X, AlertTriangle, RefreshCw, Download, Bell, BellOff } from "lucide-react";
import clsx from "clsx";
import { listen } from "@tauri-apps/api/event";
import {
  checkMachineLiveness,
  exportAnsibleInventory,
  getAllLivenessStatuses,
  getLivenessHistory,
  getMonitorRule,
  upsertMonitorRule,
} from "../../lib/tauri";
import { useInventoryStore } from "../../store";
import type { LivenessResult, MonitorEvent, MonitorRule } from "../../types";
import Sparkline from "../Sparkline/Sparkline";

interface MachineRow {
  id: string;
  name: string;
  latestStatus: MonitorEvent | null;
  history: MonitorEvent[];
  rule: MonitorRule | null;
  checking: boolean;
}

function StatusDot({ state }: { state?: string }) {
  if (!state)
    return <span className="w-2 h-2 rounded-full bg-surface-600 flex-shrink-0" title="Unknown" />;
  return (
    <span
      className={clsx(
        "w-2 h-2 rounded-full flex-shrink-0",
        state === "up" ? "bg-green-400" : "bg-red-500"
      )}
      title={state === "up" ? "Online" : "Offline"}
    />
  );
}

export default function MonitoringPanel({ onClose }: { onClose: () => void }) {
  const { machines } = useInventoryStore();
  const [rows, setRows] = useState<MachineRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [toast, setToast] = useState<{ name: string; up: boolean } | null>(null);

  // Build rows from machines
  useEffect(() => {
    async function load() {
      try {
        const [allStatuses] = await Promise.all([getAllLivenessStatuses()]);
        const statusMap = new Map(allStatuses.map((s) => [s.machine_id, s]));

        const built: MachineRow[] = await Promise.all(
          machines.map(async (m) => {
            const [history, rule] = await Promise.all([
              getLivenessHistory(m.id, 20).catch(() => []),
              getMonitorRule(m.id).catch(() => null),
            ]);
            return {
              id: m.id,
              name: m.name,
              latestStatus: statusMap.get(m.id) ?? null,
              history,
              rule,
              checking: false,
            };
          })
        );
        setRows(built);
      } catch (e) {
        setError(String(e));
      }
    }
    load();
  }, [machines]);

  // Listen for status-change alerts from backend
  useEffect(() => {
    const unsub = listen<{ machine_id: string; machine_name: string; is_up: boolean }>(
      "monitoring:status_change",
      (ev) => {
        const { machine_id, machine_name, is_up } = ev.payload;
        setRows((prev) =>
          prev.map((r) =>
            r.id === machine_id
              ? {
                  ...r,
                  latestStatus: {
                    id: "live",
                    machine_id,
                    ts: new Date().toISOString(),
                    state: is_up ? "up" : "down",
                    latency_ms: null,
                  },
                }
              : r
          )
        );
        setToast({ name: machine_name, up: is_up });
        setTimeout(() => setToast(null), 4000);
      }
    );
    return () => { unsub.then((fn) => fn()); };
  }, []);

  const checkMachine = useCallback(async (machineId: string) => {
    setRows((prev) => prev.map((r) => (r.id === machineId ? { ...r, checking: true } : r)));
    try {
      const result: LivenessResult = await checkMachineLiveness(machineId);
      const history = await getLivenessHistory(machineId, 20);
      setRows((prev) =>
        prev.map((r) =>
          r.id === machineId
            ? {
                ...r,
                checking: false,
                latestStatus: {
                  id: "fresh",
                  machine_id: machineId,
                  ts: result.checked_at,
                  state: result.is_up ? "up" : "down",
                  latency_ms: result.latency_ms,
                },
                history,
              }
            : r
        )
      );
    } catch (e) {
      setError(String(e));
      setRows((prev) => prev.map((r) => (r.id === machineId ? { ...r, checking: false } : r)));
    }
  }, []);

  async function toggleNotify(row: MachineRow) {
    try {
      const current = row.rule;
      const updated = await upsertMonitorRule({
        machine_id: row.id,
        enabled: current?.enabled ?? false,
        notify_desktop: !(current?.notify_desktop ?? false),
        interval_secs: current?.check_interval_secs ?? 60,
      });
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, rule: updated } : r)));
    } catch (e) {
      setError(String(e));
    }
  }

  async function doExport() {
    setExportBusy(true);
    try {
      const yaml = await exportAnsibleInventory();
      const blob = new Blob([yaml], { type: "text/yaml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "warden_inventory.yml";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(String(e));
    } finally {
      setExportBusy(false);
    }
  }

  const online = rows.filter((r) => r.latestStatus?.state === "up").length;
  const offline = rows.filter((r) => r.latestStatus?.state === "down").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-surface-800 border border-surface-600 rounded-2xl shadow-2xl flex flex-col w-full max-w-4xl max-h-[88vh]">

        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-surface-600 flex-shrink-0">
          <Activity className="w-4 h-4 text-accent" />
          <span className="font-semibold text-sm text-gray-200">Monitoring</span>
          <div className="flex items-center gap-2 ml-2">
            {online > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-green-900/30 text-green-400 border border-green-800/50">
                {online} up
              </span>
            )}
            {offline > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-900/30 text-red-400 border border-red-800/50">
                {offline} down
              </span>
            )}
          </div>
          <div className="flex-1" />
          <button
            onClick={doExport}
            disabled={exportBusy}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 disabled:opacity-40"
            title="Export Ansible inventory YAML"
          >
            {exportBusy ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
            Ansible Export
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-surface-700 text-muted hover:text-gray-200 ml-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Toast */}
        {toast && (
          <div
            className={clsx(
              "mx-4 mt-3 px-3 py-2 rounded-lg border text-xs flex items-center gap-2 flex-shrink-0",
              toast.up
                ? "bg-green-900/30 border-green-800/50 text-green-300"
                : "bg-red-900/30 border-red-800/50 text-red-300"
            )}
          >
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            <strong>{toast.name}</strong> is now {toast.up ? "online ✓" : "offline ✗"}
          </div>
        )}

        {error && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-red-900/30 border border-red-800/50 text-red-300 text-xs flex items-center gap-2 flex-shrink-0">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto text-muted hover:text-gray-200">✕</button>
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface-800 border-b border-surface-600">
              <tr className="text-muted uppercase tracking-widest text-[10px]">
                <th className="px-4 py-2 text-left w-6"></th>
                <th className="px-4 py-2 text-left">Machine</th>
                <th className="px-4 py-2 text-left">Last Check</th>
                <th className="px-4 py-2 text-left">Latency</th>
                <th className="px-4 py-2 text-left">History (20)</th>
                <th className="px-4 py-2 text-center">Notify</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted">
                    No machines in inventory
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-surface-700 hover:bg-surface-700/30">
                  <td className="px-4 py-2.5">
                    <StatusDot state={row.latestStatus?.state} />
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-gray-200 font-medium">{row.name}</span>
                  </td>
                  <td className="px-4 py-2.5 text-muted">
                    {row.latestStatus
                      ? new Date(row.latestStatus.ts).toLocaleTimeString()
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-muted">
                    {row.latestStatus?.latency_ms != null
                      ? `${row.latestStatus.latency_ms} ms`
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <Sparkline events={row.history} />
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button
                      onClick={() => toggleNotify(row)}
                      className={clsx(
                        "p-1 rounded transition-colors",
                        row.rule?.notify_desktop
                          ? "text-accent hover:bg-accent/10"
                          : "text-muted hover:text-gray-200 hover:bg-surface-600"
                      )}
                      title={row.rule?.notify_desktop ? "Desktop alerts on" : "Desktop alerts off"}
                    >
                      {row.rule?.notify_desktop
                        ? <Bell className="w-3.5 h-3.5" />
                        : <BellOff className="w-3.5 h-3.5" />}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => checkMachine(row.id)}
                      disabled={row.checking}
                      className="px-2 py-1 rounded bg-surface-700 border border-surface-600 text-muted hover:text-gray-200 hover:border-accent/40 disabled:opacity-40 transition-colors"
                    >
                      {row.checking
                        ? <RefreshCw className="w-3 h-3 animate-spin inline" />
                        : "Check"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
