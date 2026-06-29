import { useEffect, useState } from "react";
import {
  Activity, CheckCircle2, ChevronDown, ChevronRight,
  Loader2, Plus, RefreshCw, Trash2, XCircle, X,
} from "lucide-react";
import clsx from "clsx";
import {
  checkHttpEndpoint, deleteHttpMonitor, listHttpMonitors,
  refreshHttpMonitor, upsertHttpMonitor,
} from "../../lib/tauri";
import type { HttpCheckResult, HttpMonitor } from "../../types";

interface Props { onClose: () => void }

const METHODS = ["GET", "POST", "PUT", "HEAD"];

const emptyForm = {
  label: "", url: "", method: "GET",
  expected_status: 200, match_body: "", timeout_secs: 10,
};

export default function HttpMonitorPanel({ onClose }: Props) {
  const [monitors, setMonitors] = useState<HttpMonitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [oneOffResult, setOneOffResult] = useState<HttpCheckResult | null>(null);
  const [oneOffBusy, setOneOffBusy] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    listHttpMonitors()
      .then(setMonitors)
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function openAdd() {
    setForm(emptyForm);
    setEditId(null);
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(m: HttpMonitor) {
    setForm({
      label: m.label,
      url: m.url,
      method: m.method,
      expected_status: m.expected_status,
      match_body: m.match_body ?? "",
      timeout_secs: m.timeout_secs,
    });
    setEditId(m.id);
    setFormError(null);
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.label.trim() || !form.url.trim()) {
      setFormError("Label and URL are required.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await upsertHttpMonitor({
        id: editId ?? undefined,
        label: form.label.trim(),
        url: form.url.trim(),
        method: form.method,
        expected_status: form.expected_status,
        match_body: form.match_body.trim() || null,
        timeout_secs: form.timeout_secs,
      });
      setShowForm(false);
      load();
    } catch (err: unknown) {
      setFormError((err as { message?: string })?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleRefresh(id: string) {
    setRefreshingId(id);
    try {
      const updated = await refreshHttpMonitor(id);
      setMonitors((prev) => prev.map((m) => (m.id === id ? updated : m)));
    } catch (err) {
      console.error(err);
    } finally {
      setRefreshingId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this monitor?")) return;
    setDeletingId(id);
    try {
      await deleteHttpMonitor(id);
      load();
    } finally {
      setDeletingId(null);
    }
  }

  async function handleOneOff() {
    if (!form.url.trim()) return;
    setOneOffBusy(true);
    setOneOffResult(null);
    try {
      const r = await checkHttpEndpoint({
        url: form.url.trim(),
        method: form.method,
        expected_status: form.expected_status,
        match_body: form.match_body.trim() || null,
        timeout_secs: form.timeout_secs,
      });
      setOneOffResult(r);
    } catch (err: unknown) {
      setOneOffResult({
        url: form.url.trim(),
        status_code: null,
        latency_ms: 0,
        ok: false,
        error: (err as { message?: string })?.message ?? "Check failed",
      });
    } finally {
      setOneOffBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="w-[700px] max-h-[85vh] flex flex-col bg-surface-800 rounded-xl border border-surface-600 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-600 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-gray-100">HTTP Monitor</h2>
            {!loading && <span className="text-xs text-muted">({monitors.length})</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={openAdd}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent hover:bg-blue-500 text-white text-xs font-medium transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add monitor
            </button>
            <button onClick={onClose} className="text-muted hover:text-gray-200 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          {/* Add / Edit form */}
          {showForm && (
            <div className="bg-surface-700 border border-surface-500 rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-200">{editId ? "Edit monitor" : "New monitor"}</p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted block mb-1">Label *</label>
                  <input
                    value={form.label}
                    onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                    placeholder="Production API"
                    className="w-full bg-surface-600 border border-surface-500 rounded-md px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Method</label>
                  <select
                    value={form.method}
                    onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}
                    className="w-full bg-surface-600 border border-surface-500 rounded-md px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-accent"
                  >
                    {METHODS.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-muted block mb-1">URL *</label>
                <input
                  value={form.url}
                  onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                  placeholder="https://example.com/health"
                  className="w-full bg-surface-600 border border-surface-500 rounded-md px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-accent font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted block mb-1">Expected status</label>
                  <input
                    type="number"
                    value={form.expected_status}
                    onChange={(e) => setForm((f) => ({ ...f, expected_status: Number(e.target.value) }))}
                    className="w-full bg-surface-600 border border-surface-500 rounded-md px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Timeout (s)</label>
                  <input
                    type="number"
                    value={form.timeout_secs}
                    onChange={(e) => setForm((f) => ({ ...f, timeout_secs: Number(e.target.value) }))}
                    className="w-full bg-surface-600 border border-surface-500 rounded-md px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-muted block mb-1">Body must contain (optional)</label>
                <input
                  value={form.match_body}
                  onChange={(e) => setForm((f) => ({ ...f, match_body: e.target.value }))}
                  placeholder='"status":"ok"'
                  className="w-full bg-surface-600 border border-surface-500 rounded-md px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-accent font-mono"
                />
              </div>

              {formError && (
                <p className="text-xs text-red-400 bg-red-900/20 border border-red-900/30 rounded px-2 py-1.5">{formError}</p>
              )}

              {/* One-off test result */}
              {oneOffResult && (
                <div className={clsx(
                  "flex items-start gap-2 text-xs rounded px-3 py-2 border",
                  oneOffResult.ok
                    ? "bg-green-900/20 border-green-900/30 text-green-300"
                    : "bg-red-900/20 border-red-900/30 text-red-300"
                )}>
                  {oneOffResult.ok
                    ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    : <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
                  <span>
                    {oneOffResult.ok
                      ? `OK — ${oneOffResult.status_code} · ${oneOffResult.latency_ms} ms`
                      : oneOffResult.error ?? "Failed"}
                  </span>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                  {saving ? "Saving…" : editId ? "Update" : "Save"}
                </button>
                <button
                  onClick={handleOneOff}
                  disabled={oneOffBusy || !form.url.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface-600 hover:bg-surface-500 disabled:opacity-50 text-gray-200 text-xs font-medium transition-colors"
                >
                  {oneOffBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                  Test now
                </button>
                <button onClick={() => setShowForm(false)} className="text-xs text-muted hover:text-gray-300 transition-colors ml-auto">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Monitor list */}
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 text-muted animate-spin" />
            </div>
          )}

          {!loading && monitors.length === 0 && !showForm && (
            <div className="text-center py-12 text-xs text-muted">
              No HTTP monitors yet. Click <b>Add monitor</b> to get started.
            </div>
          )}

          {!loading && monitors.map((m) => (
            <MonitorRow
              key={m.id}
              monitor={m}
              expanded={expandedId === m.id}
              onToggle={() => setExpandedId((p) => p === m.id ? null : m.id)}
              onEdit={() => openEdit(m)}
              onRefresh={() => handleRefresh(m.id)}
              onDelete={() => handleDelete(m.id)}
              refreshing={refreshingId === m.id}
              deleting={deletingId === m.id}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── MonitorRow ─────────────────────────────────────────────────────────────────

function MonitorRow({
  monitor: m, expanded, onToggle, onEdit, onRefresh, onDelete, refreshing, deleting,
}: {
  monitor: HttpMonitor;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onRefresh: () => void;
  onDelete: () => void;
  refreshing: boolean;
  deleting: boolean;
}) {
  const status =
    m.last_ok === null ? "unknown" : m.last_ok ? "up" : "down";

  return (
    <div className="rounded-lg border border-surface-600 bg-surface-700/50 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <StatusDot status={status} />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-100 truncate">{m.label}</p>
          <p className="text-xs text-muted font-mono truncate">{m.url}</p>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted flex-shrink-0">
          {m.last_latency_ms !== null && (
            <span>{m.last_latency_ms} ms</span>
          )}
          {m.last_status_code !== null && (
            <span className={clsx(
              "px-1.5 py-0.5 rounded font-mono",
              m.last_ok ? "bg-green-900/30 text-green-300" : "bg-red-900/30 text-red-300"
            )}>
              {m.last_status_code}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 ml-2 flex-shrink-0">
          <button
            title="Refresh now"
            onClick={onRefresh}
            disabled={refreshing}
            className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:text-gray-300 hover:bg-surface-600 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={clsx("w-3.5 h-3.5", refreshing && "animate-spin")} />
          </button>
          <button
            title="Edit"
            onClick={onEdit}
            className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:text-gray-300 hover:bg-surface-600 transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button
            title="Toggle details"
            onClick={onToggle}
            className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:text-gray-300 hover:bg-surface-600 transition-colors"
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
          <button
            title="Delete"
            onClick={onDelete}
            disabled={deleting}
            className="w-7 h-7 rounded-md flex items-center justify-center text-red-400/70 hover:text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-40"
          >
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-surface-600 px-4 py-3 bg-surface-700 grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-muted">Method</span>
            <span className="ml-2 text-gray-300 font-mono">{m.method}</span>
          </div>
          <div>
            <span className="text-muted">Expected status</span>
            <span className="ml-2 text-gray-300 font-mono">{m.expected_status}</span>
          </div>
          <div>
            <span className="text-muted">Timeout</span>
            <span className="ml-2 text-gray-300">{m.timeout_secs}s</span>
          </div>
          <div>
            <span className="text-muted">Last checked</span>
            <span className="ml-2 text-gray-300">
              {m.last_checked_at ? new Date(m.last_checked_at).toLocaleTimeString() : "Never"}
            </span>
          </div>
          {m.match_body && (
            <div className="col-span-2">
              <span className="text-muted">Body match</span>
              <span className="ml-2 text-gray-300 font-mono">{m.match_body}</span>
            </div>
          )}
          {m.last_error && (
            <div className="col-span-2">
              <span className="text-red-400">{m.last_error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: "up" | "down" | "unknown" }) {
  return (
    <span className={clsx(
      "w-2 h-2 rounded-full flex-shrink-0",
      status === "up"      && "bg-green-400",
      status === "down"    && "bg-red-400",
      status === "unknown" && "bg-surface-500"
    )} />
  );
}
