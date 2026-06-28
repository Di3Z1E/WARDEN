import { useEffect, useRef, useState } from "react";
import { Play, Square, Trash2, Pin, PinOff, AlertTriangle } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { startLogTail, stopLogTail } from "../../lib/tauri";
import type { StartTailResult } from "../../types";
import type { UnlistenFn } from "@tauri-apps/api/event";

export default function LogTail({
  machineId,
  platform,
}: {
  machineId: string;
  platform: string;
}) {
  const [path, setPath] = useState("");
  const [lines, setLines] = useState<string[]>([]);
  const [tail, setTail] = useState<StartTailResult | null>(null);
  const [running, setRunning] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
    }
  }, [lines, autoScroll]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      unlistenRef.current?.();
      if (tail) stopLogTail(tail.tail_id).catch(() => {});
    };
  }, [tail]);

  async function handleStart() {
    if (!path.trim()) return;
    setError(null);
    setLines([]);
    try {
      const result = await startLogTail(machineId, path.trim(), platform);
      setTail(result);
      setRunning(true);

      // Subscribe to streaming events
      const unlisten = await listen<string>(result.event_name, (ev) => {
        const chunk = ev.payload;
        // Split chunk into lines, filter empty, append
        const newLines = chunk.split(/\r?\n/).filter(Boolean);
        if (newLines.length > 0) {
          setLines((prev) => {
            const next = [...prev, ...newLines];
            // Cap at 2000 lines to avoid memory issues
            return next.length > 2000 ? next.slice(next.length - 2000) : next;
          });
        }
      });
      unlistenRef.current = unlisten;
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleStop() {
    if (!tail) return;
    unlistenRef.current?.();
    unlistenRef.current = null;
    try {
      await stopLogTail(tail.tail_id);
    } catch (_) {}
    setTail(null);
    setRunning(false);
  }

  function handleClear() {
    setLines([]);
  }

  const placeholder =
    platform === "windows"
      ? "C:\\Windows\\Logs\\CBS\\CBS.log"
      : "/var/log/syslog  or  /var/log/nginx/access.log";

  return (
    <div className="flex flex-col h-full bg-surface-900">
      {/* Controls */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-700 flex-shrink-0 bg-surface-800">
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !running && handleStart()}
          placeholder={placeholder}
          disabled={running}
          className="flex-1 px-2 py-1 rounded bg-surface-700 border border-surface-600 text-xs text-gray-200 placeholder-muted focus:outline-none focus:border-accent disabled:opacity-50 font-mono"
        />

        {!running ? (
          <button
            onClick={handleStart}
            disabled={!path.trim()}
            className="flex items-center gap-1.5 px-3 py-1 rounded bg-green-900/30 border border-green-800/50 text-green-400 text-xs hover:bg-green-900/50 disabled:opacity-40 transition-colors"
          >
            <Play className="w-3 h-3" />
            Tail
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="flex items-center gap-1.5 px-3 py-1 rounded bg-red-900/30 border border-red-800/50 text-red-400 text-xs hover:bg-red-900/50 transition-colors"
          >
            <Square className="w-3 h-3" />
            Stop
          </button>
        )}

        <button
          onClick={() => setAutoScroll((v) => !v)}
          className={`p-1.5 rounded transition-colors ${
            autoScroll
              ? "text-accent hover:bg-accent/10"
              : "text-muted hover:bg-surface-700 hover:text-gray-200"
          }`}
          title={autoScroll ? "Auto-scroll on" : "Auto-scroll off"}
        >
          {autoScroll ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
        </button>

        <button
          onClick={handleClear}
          className="p-1.5 rounded hover:bg-surface-700 text-muted hover:text-gray-200 transition-colors"
          title="Clear output"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {error && (
        <div className="mx-3 mt-2 flex items-center gap-2 px-3 py-2 rounded bg-red-900/30 border border-red-800/50 text-red-300 text-xs flex-shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-muted hover:text-gray-200">✕</button>
        </div>
      )}

      {/* Output */}
      <div className="flex-1 overflow-y-auto font-mono text-xs bg-surface-950 p-2 leading-relaxed">
        {lines.length === 0 && (
          <div className="text-surface-500 select-none">
            {running ? "Waiting for output…" : "Enter a file path and click Tail to start"}
          </div>
        )}
        {lines.map((line, i) => (
          <div
            key={i}
            className={
              /error|fail|critical|emerg|alert/i.test(line)
                ? "text-red-400"
                : /warn/i.test(line)
                ? "text-yellow-400"
                : "text-gray-300"
            }
          >
            {line}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-3 px-3 py-1 border-t border-surface-700 text-[10px] text-surface-500 flex-shrink-0">
        {running && (
          <span className="flex items-center gap-1.5 text-green-400">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Live
          </span>
        )}
        <span>{lines.length.toLocaleString()} lines</span>
        {lines.length >= 2000 && (
          <span className="text-yellow-500">Capped at 2 000 lines — older lines dropped</span>
        )}
      </div>
    </div>
  );
}
