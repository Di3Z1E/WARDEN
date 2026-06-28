import { useEffect, useState } from "react";
import { ShieldCheck, Plus, Trash2, RefreshCw, X, AlertTriangle, CheckCircle } from "lucide-react";
import clsx from "clsx";
import { checkTlsCert, deleteCertMonitor, listCertMonitors, refreshCertMonitor, upsertCertMonitor } from "../../lib/tauri";
import type { CertInfo, CertMonitor } from "../../types";

function DaysBadge({ days }: { days: number | null }) {
  if (days === null) return <span className="text-muted text-xs">—</span>;
  const color =
    days <= 7  ? "bg-red-900/50 text-red-300 border-red-700/50" :
    days <= 30 ? "bg-yellow-900/40 text-yellow-300 border-yellow-700/50" :
                 "bg-green-900/30 text-green-300 border-green-800/50";
  return (
    <span className={clsx("px-1.5 py-0.5 rounded border text-xs", color)}>
      {days}d
    </span>
  );
}

export default function CertMonitor({ onClose }: { onClose: () => void }) {
  const [monitors, setMonitors] = useState<CertMonitor[]>([]);
  const [checking, setChecking] = useState<Set<string>>(new Set());
  const [error, setError]       = useState<string | null>(null);
  const [showAdd, setShowAdd]   = useState(false);
  const [addHost, setAddHost]   = useState("");
  const [addPort, setAddPort]   = useState("443");
  const [addLabel, setAddLabel] = useState("");
  const [quickResult, setQuickResult] = useState<CertInfo | null>(null);
  const [quickHost, setQuickHost]     = useState("");
  const [quickPort, setQuickPort]     = useState("443");
  const [quickChecking, setQuickChecking] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try { setMonitors(await listCertMonitors()); }
    catch (e: unknown) { setError(String(e)); }
  }

  async function addMonitor() {
    if (!addHost.trim()) return;
    try {
      const m = await upsertCertMonitor({
        host: addHost.trim(),
        port: parseInt(addPort) || 443,
        label: addLabel.trim() || undefined,
      });
      setMonitors((prev) => [...prev, m]);
      setShowAdd(false);
      setAddHost(""); setAddPort("443"); setAddLabel("");
    } catch (e: unknown) { setError(String(e)); }
  }

  async function refresh(id: string) {
    setChecking((s) => new Set(s).add(id));
    try {
      await refreshCertMonitor(id);
      await load();
    } catch (e: unknown) { setError(String(e)); }
    finally { setChecking((s) => { const n = new Set(s); n.delete(id); return n; }); }
  }

  async function remove(id: string) {
    if (!confirm("Remove this monitor?")) return;
    try {
      await deleteCertMonitor(id);
      setMonitors((prev) => prev.filter((m) => m.id !== id));
    } catch (e: unknown) { setError(String(e)); }
  }

  async function quickCheck() {
    if (!quickHost.trim()) return;
    setQuickChecking(true);
    setQuickResult(null);
    setError(null);
    try {
      const info = await checkTlsCert({ host: quickHost.trim(), port: parseInt(quickPort) || 443 });
      setQuickResult(info);
    } catch (e: unknown) { setError(String(e)); }
    finally { setQuickChecking(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-surface-800 border border-surface-600 rounded-2xl shadow-2xl flex flex-col w-full max-w-3xl max-h-[85vh]">

        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-surface-600 flex-shrink-0">
          <ShieldCheck className="w-4 h-4 text-accent" />
          <span className="font-semibold text-sm text-gray-200">Certificate Monitor</span>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-700 text-muted hover:text-gray-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-red-900/30 border border-red-800/50 text-red-300 text-xs flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Quick check */}
          <div className="rounded-xl border border-surface-600 p-3">
            <p className="text-xs text-muted uppercase tracking-widest mb-2">Quick Check</p>
            <div className="flex gap-2">
              <input
                value={quickHost}
                onChange={(e) => setQuickHost(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") quickCheck(); }}
                placeholder="hostname or IP"
                className="flex-1 bg-surface-700 border border-surface-500 rounded-lg px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-accent"
              />
              <input
                value={quickPort}
                onChange={(e) => setQuickPort(e.target.value)}
                placeholder="443"
                className="w-16 bg-surface-700 border border-surface-500 rounded-lg px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-accent"
              />
              <button
                onClick={quickCheck}
                disabled={quickChecking}
                className="px-3 py-1.5 rounded-lg bg-accent/15 border border-accent/30 text-accent text-xs hover:bg-accent/25 disabled:opacity-40"
              >
                {quickChecking ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : "Check"}
              </button>
            </div>
            {quickResult && (
              <div className="mt-3 p-3 rounded-lg bg-surface-700 text-xs space-y-1.5">
                <div className="flex items-center gap-2">
                  {quickResult.days_remaining > 30
                    ? <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                    : <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />}
                  <span className="text-gray-200 font-medium">{quickResult.subject}</span>
                  <DaysBadge days={quickResult.days_remaining} />
                </div>
                <div className="text-muted">Issued by: {quickResult.issuer}</div>
                <div className="text-muted">Expires: {quickResult.not_after}</div>
                {quickResult.sans.length > 0 && (
                  <div className="text-muted">SANs: {quickResult.sans.join(", ")}</div>
                )}
              </div>
            )}
          </div>

          {/* Monitored endpoints */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted uppercase tracking-widest">Monitored Endpoints</p>
              <button
                onClick={() => setShowAdd((v) => !v)}
                className="flex items-center gap-1.5 px-2 py-1 rounded text-xs bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>

            {showAdd && (
              <div className="mb-3 p-3 rounded-xl border border-surface-500 bg-surface-700/50 flex gap-2 items-center flex-wrap">
                <input
                  value={addHost}
                  onChange={(e) => setAddHost(e.target.value)}
                  placeholder="hostname"
                  className="flex-1 min-w-32 bg-surface-700 border border-surface-500 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none"
                />
                <input
                  value={addPort}
                  onChange={(e) => setAddPort(e.target.value)}
                  placeholder="443"
                  className="w-16 bg-surface-700 border border-surface-500 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none"
                />
                <input
                  value={addLabel}
                  onChange={(e) => setAddLabel(e.target.value)}
                  placeholder="label (optional)"
                  className="flex-1 min-w-28 bg-surface-700 border border-surface-500 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none"
                />
                <button
                  onClick={addMonitor}
                  className="px-2.5 py-1 rounded bg-accent/15 border border-accent/30 text-accent text-xs hover:bg-accent/25"
                >
                  Add
                </button>
              </div>
            )}

            {monitors.length === 0 && (
              <p className="text-xs text-muted text-center py-4">No monitors configured</p>
            )}

            <div className="space-y-1.5">
              {monitors.map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-surface-700/40 border border-surface-600">
                  <DaysBadge days={m.last_days_remaining} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-gray-200 truncate">
                      {m.label ?? `${m.host}:${m.port}`}
                    </div>
                    {m.label && (
                      <div className="text-[10px] text-muted">{m.host}:{m.port}</div>
                    )}
                    {m.last_not_after && (
                      <div className="text-[10px] text-muted">Expires {m.last_not_after}</div>
                    )}
                  </div>
                  {m.last_checked_at && (
                    <span className="text-[10px] text-muted hidden sm:block">
                      {new Date(m.last_checked_at).toLocaleDateString()}
                    </span>
                  )}
                  <button
                    onClick={() => refresh(m.id)}
                    disabled={checking.has(m.id)}
                    className="p-1 rounded hover:bg-surface-600 text-muted hover:text-gray-200 disabled:opacity-40"
                    title="Refresh"
                  >
                    <RefreshCw className={clsx("w-3.5 h-3.5", checking.has(m.id) && "animate-spin")} />
                  </button>
                  <button
                    onClick={() => remove(m.id)}
                    className="p-1 rounded hover:bg-red-900/30 text-muted hover:text-red-400"
                    title="Remove"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
