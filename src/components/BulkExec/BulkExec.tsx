import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Terminal, Play, X, CheckCircle, XCircle, Loader, Clock } from "lucide-react";
import clsx from "clsx";
import { bulkExec } from "../../lib/tauri";
import { useInventoryStore } from "../../store";

type MachineState = "pending" | "running" | "ok" | "error";

interface MachineResult {
  state: MachineState;
  output: string;
  exitCode: number | null;
}

const STATE_ICON: Record<MachineState, React.ReactNode> = {
  pending: <Clock className="w-3.5 h-3.5 text-muted" />,
  running: <Loader className="w-3.5 h-3.5 text-blue-400 animate-spin" />,
  ok:      <CheckCircle className="w-3.5 h-3.5 text-green-400" />,
  error:   <XCircle className="w-3.5 h-3.5 text-red-400" />,
};

export default function BulkExec({ onClose }: { onClose: () => void }) {
  const machines = useInventoryStore((s) => s.machines);
  const sshMachines = machines.filter((m) =>
    ["WindowsServer", "WindowsClient", "Linux", "GenericSsh"].includes(m.machine_type)
  );

  const [command, setCommand]                   = useState("");
  const [selected, setSelected]                 = useState<Set<string>>(new Set());
  const [results, setResults]                   = useState<Record<string, MachineResult>>({});
  const [running, setRunning]                   = useState(false);
  const [expandedId, setExpandedId]             = useState<string | null>(null);
  const [error, setError]                       = useState<string | null>(null);

  const unlistenRef = useRef<(() => void)[]>([]);

  const cancelListeners = useCallback(() => {
    unlistenRef.current.forEach((fn) => fn());
    unlistenRef.current = [];
  }, []);

  useEffect(() => () => cancelListeners(), [cancelListeners]);

  function toggleAll() {
    if (selected.size === sshMachines.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sshMachines.map((m) => m.id)));
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function execute() {
    if (!command.trim() || selected.size === 0) return;

    const machineIds = [...selected];
    const initial: Record<string, MachineResult> = {};
    machineIds.forEach((id) => { initial[id] = { state: "running", output: "", exitCode: null }; });
    setResults(initial);
    setRunning(true);
    setError(null);

    let jobId: string;
    try {
      const res = await bulkExec({ machine_ids: machineIds, command: command.trim() });
      jobId = res.job_id;
    } catch (e: unknown) {
      setError(String(e));
      setRunning(false);
      return;
    }

    cancelListeners();
    const unlistens: (() => void)[] = [];

    for (const mid of machineIds) {
      const event = `bulk:output:${jobId}:${mid}`;
      const unlisten = await listen<{ kind: string; data: string }>(event, ({ payload }) => {
        setResults((prev) => {
          const entry = prev[mid] ?? { state: "running", output: "", exitCode: null };
          if (payload.kind === "stdout" || payload.kind === "stderr") {
            return { ...prev, [mid]: { ...entry, output: entry.output + payload.data } };
          }
          if (payload.kind === "exit") {
            const code = parseInt(payload.data, 10);
            return { ...prev, [mid]: { ...entry, exitCode: code, state: code === 0 ? "ok" : "error" } };
          }
          return prev;
        });
      });
      unlistens.push(unlisten);
    }

    const doneUnlisten = await listen(`bulk:done:${jobId}`, () => {
      setRunning(false);
      cancelListeners();
    });
    unlistens.push(doneUnlisten);
    unlistenRef.current = unlistens;
  }

  const allDone = Object.values(results).length > 0 &&
    Object.values(results).every((r) => r.state === "ok" || r.state === "error");
  const okCount    = Object.values(results).filter((r) => r.state === "ok").length;
  const errorCount = Object.values(results).filter((r) => r.state === "error").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-surface-800 border border-surface-600 rounded-2xl shadow-2xl flex flex-col w-full max-w-4xl h-[80vh]">

        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-surface-600 flex-shrink-0">
          <Terminal className="w-4 h-4 text-accent" />
          <span className="font-semibold text-sm text-gray-200">Bulk Command Execution</span>
          <div className="flex-1" />
          {allDone && (
            <span className="text-xs text-muted">
              <span className="text-green-400">{okCount} ok</span>
              {errorCount > 0 && <span className="text-red-400 ml-2">{errorCount} failed</span>}
            </span>
          )}
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-700 text-muted hover:text-gray-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-red-900/30 border border-red-800/50 text-red-300 text-xs">
            {error}
          </div>
        )}

        <div className="flex flex-1 min-h-0">

          {/* Left: machine selector */}
          <div className="w-56 flex-shrink-0 border-r border-surface-600 flex flex-col">
            <div className="px-3 py-2 border-b border-surface-600 flex items-center gap-2">
              <input
                type="checkbox"
                checked={selected.size === sshMachines.length && sshMachines.length > 0}
                onChange={toggleAll}
                className="w-3.5 h-3.5 accent-accent"
              />
              <span className="text-xs text-muted">{selected.size} / {sshMachines.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {sshMachines.map((m) => {
                const res = results[m.id];
                return (
                  <div
                    key={m.id}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-700 cursor-pointer"
                    onClick={() => !running && toggle(m.id)}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(m.id)}
                      onChange={() => toggle(m.id)}
                      disabled={running}
                      className="w-3.5 h-3.5 accent-accent"
                    />
                    <span className="flex-1 text-xs text-gray-300 truncate">{m.name}</span>
                    {res && STATE_ICON[res.state]}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: command + output */}
          <div className="flex-1 flex flex-col min-h-0">
            {/* Command input */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-600 flex-shrink-0">
              <span className="text-muted font-mono text-xs">$</span>
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !running) execute(); }}
                disabled={running}
                placeholder="Command to run on all selected machines…"
                className="flex-1 bg-transparent font-mono text-sm text-gray-200 focus:outline-none placeholder:text-muted"
              />
              <button
                onClick={execute}
                disabled={running || !command.trim() || selected.size === 0}
                className="flex items-center gap-1.5 px-3 py-1 rounded bg-green-900/30 border border-green-800/40 text-green-400 text-xs hover:bg-green-900/50 disabled:opacity-40 transition-colors"
              >
                {running ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                Run
              </button>
            </div>

            {/* Per-machine output grid */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {Object.keys(results).length === 0 && (
                <div className="flex items-center justify-center h-full text-muted text-sm">
                  Select machines and enter a command to run
                </div>
              )}
              {Object.entries(results).map(([mid, res]) => {
                const machine = machines.find((m) => m.id === mid);
                return (
                  <div
                    key={mid}
                    className={clsx(
                      "rounded-lg border",
                      res.state === "ok" && "border-green-800/50 bg-green-950/20",
                      res.state === "error" && "border-red-800/50 bg-red-950/20",
                      res.state === "running" && "border-surface-500 bg-surface-700/30",
                    )}
                  >
                    <div
                      className="flex items-center gap-2 px-3 py-2 cursor-pointer"
                      onClick={() => setExpandedId(expandedId === mid ? null : mid)}
                    >
                      {STATE_ICON[res.state]}
                      <span className="text-xs font-medium text-gray-300">{machine?.name ?? mid}</span>
                      {res.exitCode !== null && (
                        <span className={clsx(
                          "text-[10px] px-1.5 rounded border",
                          res.exitCode === 0 ? "text-green-400 border-green-800/50" : "text-red-400 border-red-800/50"
                        )}>
                          exit {res.exitCode}
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-muted">{expandedId === mid ? "▲" : "▼"}</span>
                    </div>
                    {expandedId === mid && (
                      <pre className="px-3 pb-3 text-[11px] font-mono text-gray-300 whitespace-pre-wrap max-h-48 overflow-y-auto">
                        {res.output || "(no output)"}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
