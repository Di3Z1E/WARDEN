import { useEffect, useRef, useState } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { pollMetrics } from "../../lib/tauri";
import type { MetricsSnapshot } from "../../types";

const HISTORY_LEN = 40;

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-2.5 w-full rounded-full bg-surface-700 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }}
      />
    </div>
  );
}

function MiniSparkline({ values, color }: { values: number[]; color: string }) {
  const W = 120, H = 28, n = HISTORY_LEN;
  const padded = [...Array(Math.max(0, n - values.length)).fill(0), ...values.slice(-n)];
  const max = Math.max(...padded, 1);
  const bw = W / n;
  return (
    <svg width={W} height={H} className="flex-shrink-0">
      {padded.map((v, i) => {
        const h = Math.max(1, (v / max) * H);
        return (
          <rect
            key={i}
            x={i * bw}
            y={H - h}
            width={Math.max(1, bw - 1)}
            height={h}
            fill={color}
            opacity={0.7}
          />
        );
      })}
    </svg>
  );
}

export default function MetricsPanel({ machineId, platform }: { machineId: string; platform: string }) {
  const [snap, setSnap] = useState<MetricsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [memHistory, setMemHistory] = useState<number[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const s = await pollMetrics(machineId, platform);
      setSnap(s);
      setCpuHistory((h) => [...h.slice(-(HISTORY_LEN - 1)), s.cpu_pct]);
      const memPct = Math.round(((s.mem_total_mb - s.mem_free_mb) / Math.max(s.mem_total_mb, 1)) * 100);
      setMemHistory((h) => [...h.slice(-(HISTORY_LEN - 1)), memPct]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    intervalRef.current = setInterval(refresh, 5000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [machineId, platform]);

  const memUsedMb = snap ? snap.mem_total_mb - snap.mem_free_mb : 0;
  const memPct = snap ? Math.round((memUsedMb / Math.max(snap.mem_total_mb, 1)) * 100) : 0;

  return (
    <div className="flex flex-col h-full bg-surface-900 p-4 gap-5 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <span className="text-xs font-semibold text-gray-300 uppercase tracking-widest">Live Metrics</span>
        <button
          onClick={refresh}
          disabled={loading}
          className="p-1.5 rounded hover:bg-surface-700 text-muted hover:text-gray-200 disabled:opacity-40 transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-900/30 border border-red-800/50 text-red-300 text-xs">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* CPU */}
      <div className="bg-surface-800 rounded-xl p-4 border border-surface-700 space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted uppercase tracking-widest">CPU</span>
          <span className="text-2xl font-bold text-gray-100 tabular-nums">
            {snap != null ? `${snap.cpu_pct}%` : "—"}
          </span>
        </div>
        <Bar pct={snap?.cpu_pct ?? 0} color={snap && snap.cpu_pct > 80 ? "#ef4444" : snap && snap.cpu_pct > 60 ? "#f59e0b" : "#22c55e"} />
        <div className="flex justify-end">
          <MiniSparkline values={cpuHistory} color="#22c55e" />
        </div>
      </div>

      {/* RAM */}
      <div className="bg-surface-800 rounded-xl p-4 border border-surface-700 space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted uppercase tracking-widest">Memory</span>
          <span className="text-2xl font-bold text-gray-100 tabular-nums">
            {snap != null ? `${memPct}%` : "—"}
          </span>
        </div>
        <Bar pct={memPct} color={memPct > 85 ? "#ef4444" : memPct > 70 ? "#f59e0b" : "#3b82f6"} />
        {snap && (
          <div className="text-[11px] text-muted tabular-nums">
            {memUsedMb.toLocaleString()} MB used / {snap.mem_total_mb.toLocaleString()} MB total
            &nbsp;&middot;&nbsp;{snap.mem_free_mb.toLocaleString()} MB free
          </div>
        )}
        <div className="flex justify-end">
          <MiniSparkline values={memHistory} color="#3b82f6" />
        </div>
      </div>

      <div className="text-[10px] text-surface-500 text-center">Auto-refreshes every 5 s</div>
    </div>
  );
}
