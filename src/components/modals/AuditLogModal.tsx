import { useEffect, useState } from "react";
import { X, RefreshCw, Search } from "lucide-react";
import { queryAudit } from "../../lib/tauri";
import { useUiStore } from "../../store";
import type { AuditEvent } from "../../types";
import clsx from "clsx";

const RESULT_COLORS = {
  ok: "text-green-400",
  denied: "text-yellow-400",
  error: "text-red-400",
};

export default function AuditLogModal() {
  const { closeModal } = useUiStore();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [actorFilter, setActorFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await queryAudit({
        actor: actorFilter || undefined,
        action: actionFilter || undefined,
        limit: 500,
      });
      setEvents(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    refresh();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="w-[860px] max-h-[85vh] bg-surface-800 rounded-lg border border-surface-600 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-600 flex-shrink-0">
          <h2 className="text-sm font-semibold text-gray-100">Audit log</h2>
          <button onClick={closeModal} className="text-muted hover:text-gray-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filters */}
        <form
          onSubmit={handleSearch}
          className="flex items-center gap-3 px-5 py-3 border-b border-surface-600 flex-shrink-0"
        >
          <input
            type="text"
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            placeholder="Filter by actor…"
            className="bg-surface-700 border border-surface-600 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-accent w-44"
          />
          <input
            type="text"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            placeholder="Filter by action…"
            className="bg-surface-700 border border-surface-600 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-accent w-44"
          />
          <button
            type="submit"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm rounded transition-colors"
          >
            <Search className="w-3.5 h-3.5" />
            Search
          </button>
          <button
            type="button"
            onClick={refresh}
            className="p-1.5 text-muted hover:text-gray-200 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={clsx("w-3.5 h-3.5", loading && "animate-spin")} />
          </button>
          <span className="ml-auto text-xs text-muted">{events.length} events</span>
        </form>

        {/* Table + detail pane */}
        <div className="flex flex-1 overflow-hidden">
          {/* Table */}
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-800 z-10">
                <tr className="text-muted border-b border-surface-600">
                  <th className="text-left px-4 py-2">Time</th>
                  <th className="text-left px-3 py-2">Actor</th>
                  <th className="text-left px-3 py-2">Action</th>
                  <th className="text-left px-3 py-2">Target</th>
                  <th className="text-left px-3 py-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="text-center text-muted py-8">
                      Loading…
                    </td>
                  </tr>
                ) : events.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center text-muted py-8">
                      No events found
                    </td>
                  </tr>
                ) : (
                  events.map((ev) => (
                    <tr
                      key={ev.id}
                      onClick={() => setSelected(ev === selected ? null : ev)}
                      className={clsx(
                        "border-b border-surface-700 cursor-pointer transition-colors",
                        selected?.id === ev.id
                          ? "bg-accent/10"
                          : "hover:bg-surface-700/50"
                      )}
                    >
                      <td className="px-4 py-2 text-muted whitespace-nowrap">
                        {new Date(ev.ts).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-gray-300">{ev.actor}</td>
                      <td className="px-3 py-2 text-gray-200 font-medium">{ev.action}</td>
                      <td className="px-3 py-2 text-muted truncate max-w-[120px]">
                        {ev.target ?? "N/A"}
                      </td>
                      <td className={clsx("px-3 py-2 font-medium", RESULT_COLORS[ev.result as keyof typeof RESULT_COLORS])}>
                        {ev.result}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Detail pane */}
          {selected && (
            <div className="w-72 flex-shrink-0 border-l border-surface-600 p-4 overflow-y-auto">
              <h3 className="text-xs font-semibold text-gray-100 mb-3">Event detail</h3>
              <dl className="space-y-2 text-xs">
                {[
                  ["ID", selected.id],
                  ["Time", new Date(selected.ts).toLocaleString()],
                  ["Actor", selected.actor],
                  ["Action", selected.action],
                  ["Target", selected.target ?? "N/A"],
                  ["Result", selected.result],
                  ["Detail", selected.detail ?? "N/A"],
                  ["Hash (prev)", selected.hash_prev ? selected.hash_prev.slice(0, 16) + "..." : "N/A"],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <dt className="text-muted">{label}</dt>
                    <dd className="text-gray-300 break-all">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
