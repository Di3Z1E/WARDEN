import { useState } from "react";
import { RefreshCw, AlertTriangle, ChevronDown, ChevronRight, Search } from "lucide-react";
import clsx from "clsx";
import { queryEventLog } from "../../lib/tauri";
import type { EventLogEntry } from "../../types";

const WIN_LOGS = ["System", "Application", "Security", "Setup"];
const LEVELS = ["All", "Error", "Warning", "Information"];
const LIMITS = [50, 100, 200, 500];

function LevelBadge({ level }: { level: string }) {
  const l = level.toLowerCase();
  const cls =
    l.includes("error") || l === "2" || l === "3"
      ? "bg-red-900/30 text-red-400 border-red-800/50"
      : l.includes("warn") || l === "4"
      ? "bg-yellow-900/30 text-yellow-400 border-yellow-800/50"
      : l.includes("info") || l === "5" || l === "6"
      ? "bg-blue-900/30 text-blue-400 border-blue-800/50"
      : "bg-surface-700 text-muted border-surface-600";
  const label =
    l === "2" ? "Crit" : l === "3" ? "Error" : l === "4" ? "Warn" : l === "5" || l === "6" ? "Info" : level;
  return (
    <span className={clsx("px-1.5 py-0.5 rounded text-[10px] border font-medium flex-shrink-0", cls)}>
      {label}
    </span>
  );
}

function EventRow({ entry }: { entry: EventLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const ts = (() => {
    try {
      // Epoch microseconds from journalctl
      const n = Number(entry.ts);
      if (!isNaN(n) && n > 1e12) return new Date(n / 1000).toLocaleString();
      return new Date(entry.ts).toLocaleString();
    } catch { return entry.ts; }
  })();

  return (
    <div className="border-b border-surface-700/50">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-2 px-3 py-1.5 hover:bg-surface-700/30 text-left transition-colors"
      >
        <span className="mt-0.5 flex-shrink-0 text-muted">
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
        <span className="text-muted tabular-nums text-[10px] w-32 flex-shrink-0 pt-0.5">{ts}</span>
        <LevelBadge level={entry.level} />
        <span className="text-muted text-[10px] w-28 flex-shrink-0 truncate pt-0.5">{entry.source}</span>
        {entry.id > 0 && (
          <span className="text-surface-500 text-[10px] flex-shrink-0 pt-0.5">#{entry.id}</span>
        )}
        <span className="text-gray-300 text-xs truncate flex-1 pt-0.5">{entry.message}</span>
      </button>
      {expanded && (
        <div className="px-10 pb-2">
          <pre className="text-xs text-gray-300 whitespace-pre-wrap break-words bg-surface-900 rounded p-2 border border-surface-700">
            {entry.message}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function EventLogViewer({
  machineId,
  platform,
}: {
  machineId: string;
  platform: string;
}) {
  const [logName, setLogName] = useState(platform === "linux" ? "syslog" : "System");
  const [level, setLevel] = useState("All");
  const [source, setSource] = useState("");
  const [limit, setLimit] = useState(100);
  const [entries, setEntries] = useState<EventLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queried, setQueried] = useState(false);
  const [filter, setFilter] = useState("");

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const data = await queryEventLog({
        machine_id: machineId,
        platform,
        log_name: logName,
        level: level !== "All" ? level : undefined,
        source: source.trim() || undefined,
        limit,
      });
      setEntries(data);
      setQueried(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const visible = entries.filter(
    (e) =>
      !filter ||
      e.message.toLowerCase().includes(filter.toLowerCase()) ||
      e.source.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-surface-900">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-surface-700 flex-shrink-0 bg-surface-800">
        {platform === "windows" ? (
          <select
            value={logName}
            onChange={(e) => setLogName(e.target.value)}
            className="px-2 py-1 rounded bg-surface-700 border border-surface-600 text-xs text-gray-200 focus:outline-none focus:border-accent"
          >
            {WIN_LOGS.map((l) => <option key={l}>{l}</option>)}
          </select>
        ) : (
          <input
            value={logName}
            onChange={(e) => setLogName(e.target.value)}
            placeholder="Unit (empty = all)"
            className="w-36 px-2 py-1 rounded bg-surface-700 border border-surface-600 text-xs text-gray-200 placeholder-muted focus:outline-none focus:border-accent"
          />
        )}

        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          className="px-2 py-1 rounded bg-surface-700 border border-surface-600 text-xs text-gray-200 focus:outline-none focus:border-accent"
        >
          {LEVELS.map((l) => <option key={l}>{l}</option>)}
        </select>

        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder={platform === "windows" ? "Provider filter…" : "Service filter…"}
          className="w-36 px-2 py-1 rounded bg-surface-700 border border-surface-600 text-xs text-gray-200 placeholder-muted focus:outline-none focus:border-accent"
        />

        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="px-2 py-1 rounded bg-surface-700 border border-surface-600 text-xs text-gray-200 focus:outline-none focus:border-accent"
        >
          {LIMITS.map((n) => <option key={n} value={n}>Last {n}</option>)}
        </select>

        <button
          onClick={run}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1 rounded bg-accent/10 border border-accent/40 text-accent text-xs hover:bg-accent/20 disabled:opacity-40"
        >
          {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : null}
          {loading ? "Querying…" : "Query"}
        </button>

        {queried && (
          <div className="relative ml-auto">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted pointer-events-none" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter results…"
              className="pl-7 pr-3 py-1 rounded bg-surface-700 border border-surface-600 text-xs text-gray-200 placeholder-muted focus:outline-none focus:border-accent w-44"
            />
          </div>
        )}
      </div>

      {error && (
        <div className="mx-3 mt-2 flex items-center gap-2 px-3 py-2 rounded bg-red-900/30 border border-red-800/50 text-red-300 text-xs flex-shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-muted hover:text-gray-200">✕</button>
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {!queried && !loading && (
          <div className="flex items-center justify-center h-full text-muted text-sm">
            Configure filters and click Query
          </div>
        )}
        {queried && visible.length === 0 && !loading && (
          <div className="flex items-center justify-center h-full text-muted text-sm">
            No events found
          </div>
        )}
        {visible.map((e, i) => (
          <EventRow key={i} entry={e} />
        ))}
      </div>

      {queried && (
        <div className="px-3 py-1 border-t border-surface-700 text-[10px] text-surface-500 flex-shrink-0">
          {visible.length} of {entries.length} events
        </div>
      )}
    </div>
  );
}
