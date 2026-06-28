import { useEffect, useRef, useState } from "react";
import {
  Search, Zap, Server, Plus, Key, X, ArrowRight,
  Terminal as TerminalIcon, Monitor, Cpu, Network,
} from "lucide-react";
import clsx from "clsx";
import { useInventoryStore, useSessionStore, useUiStore } from "../../store";
import type { Machine, MachineType } from "../../types";

type ResultKind = "session" | "machine" | "action";

interface Result {
  id: string;
  kind: ResultKind;
  icon: React.ReactNode;
  primary: string;
  secondary: string;
  action: () => void;
}

const TYPE_ICONS: Record<MachineType, React.ReactNode> = {
  WindowsServer: <Server className="w-3.5 h-3.5 text-blue-400" />,
  WindowsClient: <Monitor className="w-3.5 h-3.5 text-blue-300" />,
  Linux: <TerminalIcon className="w-3.5 h-3.5 text-green-400" />,
  EsxiVsphere: <Cpu className="w-3.5 h-3.5 text-orange-400" />,
  IpmiIdrac: <Cpu className="w-3.5 h-3.5 text-red-400" />,
  NetworkDevice: <Network className="w-3.5 h-3.5 text-purple-400" />,
  GenericSsh: <TerminalIcon className="w-3.5 h-3.5 text-gray-400" />,
  Generic: <Server className="w-3.5 h-3.5 text-gray-400" />,
};

function machineSubtext(m: Machine): string {
  const parts: string[] = [m.machine_type.replace(/([A-Z])/g, " $1").trim()];
  if (m.tags.length) parts.push(m.tags.join(", "));
  if (m.last_connected_at) {
    const ms = Date.now() - new Date(m.last_connected_at).getTime();
    const h = Math.floor(ms / 3_600_000);
    const d = Math.floor(h / 24);
    parts.push(`last seen ${d > 0 ? `${d}d` : h > 0 ? `${h}h` : "recently"} ago`);
  }
  return parts.join(" · ");
}

export default function CommandPalette() {
  const { machines } = useInventoryStore();
  const { tabs, setActiveTab } = useSessionStore();
  const { closeCommandPalette, openModal } = useUiStore();

  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setSel(0); }, [query]);

  // Close on Escape globally
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeCommandPalette();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeCommandPalette]);

  const q = query.toLowerCase().trim();

  const results: Result[] = [];

  // Active sessions first
  for (const tab of tabs) {
    if (!q || tab.label.toLowerCase().includes(q) || tab.machineName.toLowerCase().includes(q)) {
      results.push({
        id: `s-${tab.id}`,
        kind: "session",
        icon: <Zap className="w-3.5 h-3.5 text-green-400" />,
        primary: tab.label,
        secondary: `Active ${tab.protocol} · connected ${Math.round((Date.now() - tab.connectedAt) / 60000)}m ago`,
        action: () => { setActiveTab(tab.id); closeCommandPalette(); },
      });
    }
  }

  // Machines
  for (const m of machines) {
    if (!q || m.name.toLowerCase().includes(q) || m.tags.some((t) => t.toLowerCase().includes(q))) {
      results.push({
        id: `m-${m.id}`,
        kind: "machine",
        icon: TYPE_ICONS[m.machine_type],
        primary: m.name,
        secondary: machineSubtext(m),
        action: () => closeCommandPalette(),
      });
    }
  }

  // Actions (always shown if query matches)
  const ACTIONS: Omit<Result, "id">[] = [
    {
      kind: "action",
      icon: <Plus className="w-3.5 h-3.5 text-accent" />,
      primary: "Add machine",
      secondary: "Add a server, VM, or network device to inventory",
      action: () => { openModal("add-machine"); closeCommandPalette(); },
    },
    {
      kind: "action",
      icon: <Key className="w-3.5 h-3.5 text-accent" />,
      primary: "Add credential",
      secondary: "Store an SSH key or password in Windows Credential Manager",
      action: () => { openModal("add-credential"); closeCommandPalette(); },
    },
  ];

  for (const a of ACTIONS) {
    if (!q || a.primary.toLowerCase().includes(q)) {
      results.push({ ...a, id: `a-${a.primary}` });
    }
  }

  const clampedSel = Math.max(0, Math.min(sel, results.length - 1));

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter" && results[clampedSel]) { results[clampedSel].action(); }
  }

  const groups: ResultKind[] = ["session", "machine", "action"];
  const groupLabels: Record<ResultKind, string> = {
    session: "Active sessions",
    machine: "Machines",
    action: "Actions",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/70 backdrop-blur-sm"
      onClick={closeCommandPalette}
    >
      <div
        className="w-[580px] bg-surface-800 rounded-xl border border-surface-600 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-600">
          <Search className="w-4 h-4 text-muted flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            className="flex-1 bg-transparent text-sm text-gray-100 placeholder-muted focus:outline-none"
            placeholder="Search machines, sessions, actions…"
          />
          <button onClick={closeCommandPalette} className="text-muted hover:text-gray-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-96 overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted">
              No results for <span className="text-gray-300">"{query}"</span>
            </div>
          ) : (
            groups.map((kind) => {
              const items = results.filter((r) => r.kind === kind);
              if (!items.length) return null;
              return (
                <div key={kind}>
                  <div className="px-4 pt-3 pb-1 text-[10px] font-semibold text-muted uppercase tracking-widest">
                    {groupLabels[kind]}
                  </div>
                  {items.map((r) => {
                    const idx = results.indexOf(r);
                    const isSelected = idx === clampedSel;
                    return (
                      <button
                        key={r.id}
                        onMouseEnter={() => setSel(idx)}
                        onClick={r.action}
                        className={clsx(
                          "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                          isSelected ? "bg-accent/15 text-gray-100" : "text-gray-300 hover:bg-surface-700"
                        )}
                      >
                        <span className="flex-shrink-0 w-5 flex items-center justify-center">{r.icon}</span>
                        <span className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{r.primary}</div>
                          <div className="text-xs text-muted truncate">{r.secondary}</div>
                        </span>
                        <ArrowRight className={clsx(
                          "w-3.5 h-3.5 flex-shrink-0 transition-opacity",
                          isSelected ? "text-accent opacity-80" : "text-muted opacity-0"
                        )} />
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-surface-600 text-[10px] text-surface-500">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> select</span>
          <span><kbd className="font-mono">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
