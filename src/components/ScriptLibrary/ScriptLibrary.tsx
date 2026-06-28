import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Code2, Play, Plus, Save, Trash2, X, ChevronRight, CheckCircle, XCircle, Loader,
} from "lucide-react";
import clsx from "clsx";
import {
  createScript, deleteScript, listMachines, listScriptRuns, runScript,
  saveRunOutput, finishScriptRun, updateScript, listScripts,
} from "../../lib/tauri";
import { useInventoryStore } from "../../store";
import type { Machine, Script, ScriptLanguage, ScriptRun } from "../../types";

// ── Language metadata ─────────────────────────────────────────────────────────

const LANGS: { value: ScriptLanguage; label: string; color: string }[] = [
  { value: "powershell", label: "PowerShell", color: "text-blue-400" },
  { value: "bash",       label: "Bash",        color: "text-green-400" },
  { value: "python",     label: "Python",      color: "text-yellow-400" },
];

const LANG_BADGE: Record<ScriptLanguage, string> = {
  powershell: "bg-blue-900/40 text-blue-300 border-blue-800/50",
  bash:       "bg-green-900/40 text-green-300 border-green-800/50",
  python:     "bg-yellow-900/40 text-yellow-300 border-yellow-800/50",
};

// ── Machine-level run state ───────────────────────────────────────────────────

type RunState = "pending" | "running" | "ok" | "error";

interface MachineOutput {
  state: RunState;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ScriptLibrary({ onClose }: { onClose: () => void }) {
  const machines = useInventoryStore((s) => s.machines);

  const [scripts, setScripts]       = useState<Script[]>([]);
  const [selected, setSelected]     = useState<Script | null>(null);
  const [editing, setEditing]       = useState<Partial<Script>>({});
  const [isDirty, setIsDirty]       = useState(false);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState<string | null>(null);

  // Runner panel
  const [runnerOpen, setRunnerOpen]           = useState(false);
  const [selectedMachines, setSelectedMachines] = useState<Set<string>>(new Set());
  const [running, setRunning]                 = useState(false);

  const [machineOutputs, setMachineOutputs]   = useState<Record<string, MachineOutput>>({});
  const [runs, setRuns]                       = useState<ScriptRun[]>([]);

  const unlistenRef = useRef<(() => void)[]>([]);

  // Load scripts on mount
  useEffect(() => {
    load();
    listMachines().then(() => {}).catch(() => {});
  }, []);

  // Load runs when selected script changes
  useEffect(() => {
    if (selected) {
      listScriptRuns(selected.id).then(setRuns).catch(() => {});
    }
  }, [selected?.id]);

  async function load() {
    try {
      const list = await listScripts();
      setScripts(list);
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  function selectScript(s: Script) {
    setSelected(s);
    setEditing({ name: s.name, language: s.language, body: s.body });
    setIsDirty(false);
    setRunnerOpen(false);
    setMachineOutputs({});
  }

  function newScript() {
    setSelected(null);
    setEditing({ name: "New Script", language: "bash", body: "#!/bin/bash\necho 'Hello World'" });
    setIsDirty(true);
    setRunnerOpen(false);
    setMachineOutputs({});
  }

  function patch<K extends keyof Script>(key: K, value: Script[K]) {
    setEditing((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
  }

  async function save() {
    if (!editing.name || !editing.language || editing.body === undefined) return;
    setSaving(true);
    setError(null);
    try {
      if (selected) {
        const updated = await updateScript(selected.id, {
          name: editing.name,
          language: editing.language as ScriptLanguage,
          body: editing.body,
        });
        setScripts((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        setSelected(updated);
      } else {
        const created = await createScript({
          name: editing.name,
          language: editing.language as ScriptLanguage,
          body: editing.body,
        });
        setScripts((prev) => [...prev, created]);
        setSelected(created);
      }
      setIsDirty(false);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!selected) return;
    if (!confirm(`Delete "${selected.name}"?`)) return;
    try {
      await deleteScript(selected.id);
      setScripts((prev) => prev.filter((s) => s.id !== selected.id));
      setSelected(null);
      setEditing({});
      setIsDirty(false);
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  // ── Run script ──────────────────────────────────────────────────────────────

  function toggleMachine(id: string) {
    setSelectedMachines((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const cancelListeners = useCallback(() => {
    unlistenRef.current.forEach((fn) => fn());
    unlistenRef.current = [];
  }, []);

  async function executeScript() {
    if (!selected || selectedMachines.size === 0) return;

    // Save first if dirty
    if (isDirty) await save();

    const machineIds = [...selectedMachines];

    // Init output state
    const initial: Record<string, MachineOutput> = {};
    machineIds.forEach((id) => {
      initial[id] = { state: "running", stdout: "", stderr: "", exitCode: null };
    });
    setMachineOutputs(initial);
    setRunning(true);

    let runId: string;
    try {
      const res = await runScript({ script_id: selected.id, machine_ids: machineIds });
      runId = res.run_id;

    } catch (e: unknown) {
      setError(String(e));
      setRunning(false);
      return;
    }

    cancelListeners();
    const unlistens: (() => void)[] = [];

    // Subscribe to output events for each machine
    for (const mid of machineIds) {
      const event = `script:output:${runId}:${mid}`;
      const unlisten = await listen<{ kind: string; data: string }>(event, ({ payload }) => {
        setMachineOutputs((prev) => {
          const entry = prev[mid] ?? { state: "running", stdout: "", stderr: "", exitCode: null };
          if (payload.kind === "stdout") return { ...prev, [mid]: { ...entry, stdout: entry.stdout + payload.data } };
          if (payload.kind === "stderr") return { ...prev, [mid]: { ...entry, stderr: entry.stderr + payload.data } };
          if (payload.kind === "exit") {
            const code = parseInt(payload.data, 10);
            const updated: MachineOutput = { ...entry, exitCode: code, state: code === 0 ? "ok" : "error" };
            // Save output to DB (fire-and-forget)
            saveRunOutput({
              run_id: runId,
              machine_id: mid,
              stdout: updated.stdout,
              stderr: updated.stderr,
              exit_code: code,
            }).catch(() => {});
            return { ...prev, [mid]: updated };
          }
          return prev;
        });
      });
      unlistens.push(unlisten);
    }

    // Listen for run completion
    const doneUnlisten = await listen(`script:run_done:${runId}`, () => {
      finishScriptRun(runId).catch(() => {});
      listScriptRuns(selected.id).then(setRuns).catch(() => {});
      setRunning(false);
      cancelListeners();
    });
    unlistens.push(doneUnlisten);
    unlistenRef.current = unlistens;
  }

  useEffect(() => () => cancelListeners(), [cancelListeners]);

  // ── Render ──────────────────────────────────────────────────────────────────

  const sshMachines = machines.filter((m) =>
    ["WindowsServer", "WindowsClient", "Linux", "GenericSsh"].includes(m.machine_type)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-surface-800 border border-surface-600 rounded-2xl shadow-2xl flex flex-col w-full max-w-7xl h-[90vh]">

        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-surface-600 flex-shrink-0">
          <Code2 className="w-4 h-4 text-accent" />
          <span className="font-semibold text-sm text-gray-200">Script Library</span>
          <div className="flex-1" />
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

          {/* Left: script list */}
          <div className="w-56 flex-shrink-0 border-r border-surface-600 flex flex-col">
            <div className="p-2 border-b border-surface-600">
              <button
                onClick={newScript}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> New Script
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {scripts.length === 0 && (
                <p className="px-3 py-4 text-xs text-muted text-center">No scripts yet</p>
              )}
              {scripts.map((s) => (
                <button
                  key={s.id}
                  onClick={() => selectScript(s)}
                  className={clsx(
                    "w-full text-left px-3 py-2 flex items-center gap-2 text-xs hover:bg-surface-700 transition-colors",
                    selected?.id === s.id && "bg-surface-700 text-gray-100"
                  )}
                >
                  <span className={clsx("text-[10px] px-1 rounded border", LANG_BADGE[s.language])}>
                    {s.language.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="truncate">{s.name}</span>
                  {selected?.id === s.id && <ChevronRight className="w-3 h-3 ml-auto flex-shrink-0" />}
                </button>
              ))}
            </div>
          </div>

          {/* Center: editor */}
          <div className="flex-1 flex flex-col min-w-0">
            {(selected || isDirty) ? (
              <>
                {/* Editor toolbar */}
                <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-600 flex-shrink-0">
                  <input
                    value={editing.name ?? ""}
                    onChange={(e) => patch("name", e.target.value as Script["name"])}
                    className="flex-1 bg-transparent text-sm font-medium text-gray-200 focus:outline-none placeholder:text-muted"
                    placeholder="Script name…"
                  />
                  <select
                    value={editing.language ?? "bash"}
                    onChange={(e) => patch("language", e.target.value as ScriptLanguage)}
                    className="bg-surface-700 border border-surface-500 rounded text-xs text-gray-300 px-2 py-1 focus:outline-none"
                  >
                    {LANGS.map((l) => (
                      <option key={l.value} value={l.value}>{l.label}</option>
                    ))}
                  </select>
                  {isDirty && (
                    <span className="text-[10px] text-yellow-400 border border-yellow-800/50 px-1.5 py-0.5 rounded">
                      unsaved
                    </span>
                  )}
                  <button
                    onClick={save}
                    disabled={saving || !isDirty}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-accent/15 border border-accent/30 text-accent text-xs hover:bg-accent/25 disabled:opacity-40 transition-colors"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {saving ? "Saving…" : "Save"}
                  </button>
                  {selected && (
                    <>
                      <button
                        onClick={() => setRunnerOpen((v) => !v)}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-green-900/20 border border-green-800/40 text-green-400 text-xs hover:bg-green-900/40 transition-colors"
                      >
                        <Play className="w-3.5 h-3.5" /> Run
                      </button>
                      <button
                        onClick={remove}
                        className="p-1 rounded hover:bg-red-900/30 text-muted hover:text-red-400 transition-colors"
                        title="Delete script"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>

                {/* Body editor */}
                <textarea
                  value={editing.body ?? ""}
                  onChange={(e) => patch("body", e.target.value)}
                  spellCheck={false}
                  className="flex-1 font-mono text-xs bg-surface-900 text-gray-200 p-4 resize-none focus:outline-none border-none"
                  placeholder="Write your script here…"
                />
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted text-sm flex-col gap-2">
                <Code2 className="w-8 h-8 opacity-30" />
                <span>Select a script or create a new one</span>
              </div>
            )}
          </div>

          {/* Right: runner panel */}
          {runnerOpen && selected && (
            <div className="w-80 flex-shrink-0 border-l border-surface-600 flex flex-col">
              <div className="px-3 py-2 border-b border-surface-600 flex items-center gap-2">
                <Play className="w-3.5 h-3.5 text-green-400" />
                <span className="text-xs font-medium text-gray-300">Run on Machines</span>
              </div>

              {/* Machine checklist */}
              <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                {sshMachines.length === 0 && (
                  <p className="text-xs text-muted p-2">No SSH-capable machines in inventory</p>
                )}
                {sshMachines.map((m) => {
                  const out = machineOutputs[m.id];
                  return (
                    <MachineRow
                      key={m.id}
                      machine={m}
                      checked={selectedMachines.has(m.id)}
                      onToggle={() => toggleMachine(m.id)}
                      output={out}
                    />
                  );
                })}
              </div>

              {/* Run controls */}
              <div className="p-3 border-t border-surface-600 flex items-center gap-2">
                <span className="text-xs text-muted">{selectedMachines.size} selected</span>
                <button
                  onClick={executeScript}
                  disabled={running || selectedMachines.size === 0}
                  className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-800/40 border border-green-700/50 text-green-300 text-xs hover:bg-green-800/60 disabled:opacity-40 transition-colors"
                >
                  {running ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  {running ? "Running…" : "Execute"}
                </button>
              </div>

              {/* Recent runs */}
              {runs.length > 0 && (
                <div className="border-t border-surface-600 p-2">
                  <p className="text-[10px] text-muted uppercase tracking-widest mb-1.5 px-1">Recent Runs</p>
                  <div className="space-y-0.5">
                    {runs.slice(0, 5).map((r) => (
                      <div key={r.id} className="flex items-center gap-2 px-2 py-1 rounded text-xs text-muted">
                        <span className={clsx("w-1.5 h-1.5 rounded-full", r.finished_at ? "bg-green-500" : "bg-yellow-400 animate-pulse")} />
                        <span>{new Date(r.started_at).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Machine row with inline output ────────────────────────────────────────────

function MachineRow({
  machine,
  checked,
  onToggle,
  output,
}: {
  machine: Machine;
  checked: boolean;
  onToggle: () => void;
  output?: MachineOutput;
}) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (output?.state === "error") setExpanded(true);
  }, [output?.state]);

  return (
    <div className={clsx(
      "rounded-lg border transition-colors",
      output ? "border-surface-500" : "border-transparent",
      checked && !output && "bg-surface-700/50 border-surface-500"
    )}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          disabled={!!output}
          className="w-3.5 h-3.5 accent-accent"
        />
        <span className="flex-1 text-xs truncate text-gray-300">{machine.name}</span>
        {output && (
          <>
            {output.state === "running" && <Loader className="w-3.5 h-3.5 animate-spin text-blue-400" />}
            {output.state === "ok" && <CheckCircle className="w-3.5 h-3.5 text-green-400" />}
            {output.state === "error" && <XCircle className="w-3.5 h-3.5 text-red-400" />}
            {output.state !== "running" && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="text-[10px] text-muted hover:text-gray-300"
              >
                {expanded ? "hide" : "show"}
              </button>
            )}
          </>
        )}
      </div>
      {expanded && output && (
        <div className="px-2 pb-2">
          <pre className="text-[10px] font-mono bg-surface-900 rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-gray-300">
            {output.stdout || output.stderr || "(no output)"}
          </pre>
          {output.stderr && output.stdout && (
            <pre className="text-[10px] font-mono bg-red-950/50 rounded p-2 max-h-20 overflow-y-auto whitespace-pre-wrap text-red-300 mt-1">
              {output.stderr}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
