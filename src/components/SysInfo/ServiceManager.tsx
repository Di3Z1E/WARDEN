import { useCallback, useEffect, useState } from "react";
import { RefreshCw, AlertTriangle, Search, Play, Square, RotateCcw } from "lucide-react";
import clsx from "clsx";
import { listServices, controlService } from "../../lib/tauri";
import type { ServiceInfo } from "../../types";

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const cls =
    s === "running" || s === "active"
      ? "bg-green-900/30 text-green-400 border-green-800/50"
      : s === "stopped" || s === "inactive" || s === "dead"
      ? "bg-surface-700 text-muted border-surface-600"
      : s === "paused" || s === "activating" || s === "deactivating"
      ? "bg-yellow-900/30 text-yellow-400 border-yellow-800/50"
      : "bg-surface-700 text-muted border-surface-600";
  return (
    <span className={clsx("px-1.5 py-0.5 rounded text-[10px] border font-medium", cls)}>
      {status}
    </span>
  );
}

export default function ServiceManager({ machineId, platform }: { machineId: string; platform: string }) {
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listServices(machineId, platform);
      setServices(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [machineId, platform]);

  useEffect(() => { load(); }, [load]);

  async function control(name: string, action: "start" | "stop" | "restart") {
    setBusy(`${name}:${action}`);
    setError(null);
    try {
      await controlService(machineId, name, action, platform);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  const filtered = services.filter(
    (s) =>
      !query ||
      s.name.toLowerCase().includes(query.toLowerCase()) ||
      s.display_name.toLowerCase().includes(query.toLowerCase())
  );

  const running = services.filter((s) => {
    const st = s.status.toLowerCase();
    return st === "running" || st === "active";
  }).length;

  return (
    <div className="flex flex-col h-full bg-surface-900">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-700 flex-shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter services…"
            className="w-full pl-7 pr-3 py-1 rounded bg-surface-700 border border-surface-600 text-xs text-gray-200 placeholder-muted focus:outline-none focus:border-accent"
          />
        </div>
        <span className="text-[11px] text-green-400 tabular-nums whitespace-nowrap">{running} running</span>
        <button
          onClick={load}
          disabled={loading}
          className="p-1.5 rounded hover:bg-surface-700 text-muted hover:text-gray-200 disabled:opacity-40"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && (
        <div className="mx-3 mt-2 flex items-center gap-2 px-3 py-2 rounded bg-red-900/30 border border-red-800/50 text-red-300 text-xs flex-shrink-0">
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
              <th className="px-3 py-2 text-left">Service</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Start</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && !loading && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-muted">
                  {query ? "No matching services" : "No data"}
                </td>
              </tr>
            )}
            {filtered.map((svc) => {
              const isRunning = ["running", "active"].includes(svc.status.toLowerCase());
              const isBusy = busy?.startsWith(svc.name + ":");
              return (
                <tr
                  key={svc.name}
                  className={clsx(
                    "border-b border-surface-700/50 hover:bg-surface-700/30 transition-colors",
                    isBusy && "opacity-50"
                  )}
                >
                  <td className="px-3 py-2">
                    <div className="font-mono text-gray-200 truncate max-w-40" title={svc.name}>{svc.name}</div>
                    <div className="text-[10px] text-muted truncate max-w-40" title={svc.display_name}>{svc.display_name}</div>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={svc.status} />
                  </td>
                  <td className="px-3 py-2 text-muted">{svc.start_type}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => control(svc.name, "start")}
                        disabled={isRunning || !!isBusy}
                        className="p-1 rounded hover:bg-green-900/30 text-muted hover:text-green-400 disabled:opacity-25 transition-colors"
                        title="Start"
                      >
                        <Play className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => control(svc.name, "stop")}
                        disabled={!isRunning || !!isBusy}
                        className="p-1 rounded hover:bg-red-900/30 text-muted hover:text-red-400 disabled:opacity-25 transition-colors"
                        title="Stop"
                      >
                        <Square className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => control(svc.name, "restart")}
                        disabled={!isRunning || !!isBusy}
                        className="p-1 rounded hover:bg-blue-900/30 text-muted hover:text-blue-400 disabled:opacity-25 transition-colors"
                        title="Restart"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
