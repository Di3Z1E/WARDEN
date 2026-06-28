import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, AlertTriangle, ChevronUp, ChevronDown, Search, Skull } from "lucide-react";
import clsx from "clsx";
import { listProcesses, killProcess } from "../../lib/tauri";
import type { ProcessInfo } from "../../types";

type SortCol = "name" | "cpu_val" | "mem_mb" | "pid";
type SortDir = "asc" | "desc";

function SortIcon({ col, active, dir }: { col: SortCol; active: SortCol; dir: SortDir }) {
  if (col !== active) return <ChevronDown className="w-3 h-3 opacity-20" />;
  return dir === "asc"
    ? <ChevronUp className="w-3 h-3 text-accent" />
    : <ChevronDown className="w-3 h-3 text-accent" />;
}

export default function ProcessManager({ machineId, platform }: { machineId: string; platform: string }) {
  const [procs, setProcs] = useState<ProcessInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ col: SortCol; dir: SortDir }>({ col: "mem_mb", dir: "desc" });
  const [killing, setKilling] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listProcesses(machineId, platform);
      setProcs(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [machineId, platform]);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, 10000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [load]);

  function toggleSort(col: SortCol) {
    setSort((s) =>
      s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: "desc" }
    );
  }

  async function handleKill(pid: number, name: string) {
    if (!window.confirm(`Kill process "${name}" (PID ${pid})?`)) return;
    setKilling(pid);
    try {
      await killProcess(machineId, pid, platform);
      setProcs((p) => p.filter((x) => x.pid !== pid));
    } catch (e) {
      setError(String(e));
    } finally {
      setKilling(null);
    }
  }

  const filtered = procs
    .filter((p) => !query || p.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      const v = (x: ProcessInfo) => (sort.col === "name" ? x.name : x[sort.col]) as string | number;
      const av = v(a), bv = v(b);
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sort.dir === "asc" ? cmp : -cmp;
    });

  const cpuLabel = platform === "windows" ? "CPU (s)" : "CPU %";

  return (
    <div className="flex flex-col h-full bg-surface-900">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-700 flex-shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter processes…"
            className="w-full pl-7 pr-3 py-1 rounded bg-surface-700 border border-surface-600 text-xs text-gray-200 placeholder-muted focus:outline-none focus:border-accent"
          />
        </div>
        <span className="text-[11px] text-muted tabular-nums whitespace-nowrap">{filtered.length} procs</span>
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
              {(["name", "pid", "cpu_val", "mem_mb"] as SortCol[]).map((col) => (
                <th
                  key={col}
                  onClick={() => toggleSort(col)}
                  className="px-3 py-2 text-left cursor-pointer hover:text-gray-300 select-none whitespace-nowrap"
                >
                  <span className="inline-flex items-center gap-1">
                    {col === "name" ? "Process" : col === "pid" ? "PID" : col === "cpu_val" ? cpuLabel : "Mem (MB)"}
                    <SortIcon col={col} active={sort.col} dir={sort.dir} />
                  </span>
                </th>
              ))}
              <th className="px-3 py-2 w-10" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted">
                  {query ? "No matching processes" : "No data"}
                </td>
              </tr>
            )}
            {filtered.map((p) => (
              <tr
                key={p.pid}
                className={clsx(
                  "border-b border-surface-700/50 hover:bg-surface-700/30 transition-colors",
                  killing === p.pid && "opacity-40"
                )}
              >
                <td className="px-3 py-1.5 font-mono text-gray-200 max-w-32 truncate">{p.name}</td>
                <td className="px-3 py-1.5 text-muted tabular-nums">{p.pid}</td>
                <td className="px-3 py-1.5 tabular-nums">
                  <span className={clsx(p.cpu_val > 50 ? "text-yellow-400" : "text-muted")}>
                    {p.cpu_val.toFixed(1)}
                  </span>
                </td>
                <td className="px-3 py-1.5 tabular-nums">
                  <span className={clsx(p.mem_mb > 500 ? "text-orange-400" : "text-muted")}>
                    {p.mem_mb.toFixed(1)}
                  </span>
                </td>
                <td className="px-3 py-1.5">
                  <button
                    onClick={() => handleKill(p.pid, p.name)}
                    disabled={killing === p.pid}
                    className="p-1 rounded hover:bg-red-900/30 text-muted hover:text-red-400 disabled:opacity-30 transition-colors"
                    title={`Kill ${p.name}`}
                  >
                    <Skull className="w-3 h-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-3 py-1.5 border-t border-surface-700 text-[10px] text-surface-500 flex-shrink-0">
        Auto-refreshes every 10 s &nbsp;·&nbsp; {platform === "windows" ? "CPU time (s) = total processor seconds" : "CPU % = since process start"}
      </div>
    </div>
  );
}
