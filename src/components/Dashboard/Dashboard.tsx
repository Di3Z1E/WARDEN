import { useEffect, useState } from "react";
import {
  Server, Key, Terminal as TerminalIcon, Plus, Search,
  Clock, Zap, BookOpen, ArrowRight, Lightbulb,
} from "lucide-react";
import clsx from "clsx";
import { useAuthStore, useInventoryStore, useSessionStore, useUiStore } from "../../store";
import { listCredentialSets, queryAudit } from "../../lib/tauri";
import type { AuditEvent } from "../../types";

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return "Just now";
}

export default function Dashboard() {
  const { user } = useAuthStore();
  const { machines } = useInventoryStore();
  const { tabs } = useSessionStore();
  const { openModal, openCommandPalette } = useUiStore();

  const [credCount, setCredCount] = useState<number | null>(null);
  const [recentEvents, setRecentEvents] = useState<AuditEvent[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  useEffect(() => {
    listCredentialSets().then((c) => setCredCount(c.length)).catch(() => setCredCount(0));
    queryAudit({ action: "SESSION_OPEN", limit: 6 })
      .then(setRecentEvents)
      .catch(() => {})
      .finally(() => setLoadingRecent(false));
  }, []);

  const isAdmin = user?.role === "Admin";
  const canConnect = user?.role === "Admin" || user?.role === "Operator";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="h-full overflow-y-auto bg-surface-900">
      <div className="max-w-xl mx-auto px-6 py-8 space-y-7">

        {/* Welcome header */}
        <div>
          <h1 className="text-xl font-semibold text-gray-100">
            {greeting}, <span className="text-accent">{user?.username}</span>
          </h1>
          <p className="text-xs text-muted mt-1">
            {new Date().toLocaleDateString("en-GB", {
              weekday: "long", day: "numeric", month: "long", year: "numeric",
            })}
          </p>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard icon={<Server className="w-4 h-4" />} label="Machines" value={machines.length} accent="blue" />
          <StatCard icon={<Key className="w-4 h-4" />} label="Credentials" value={credCount ?? "…"} accent="purple" />
          <StatCard
            icon={<TerminalIcon className="w-4 h-4" />}
            label="Active sessions"
            value={tabs.length}
            accent={tabs.length > 0 ? "green" : "gray"}
            pulse={tabs.length > 0}
          />
        </div>

        {/* Quick actions */}
        <div>
          <SectionLabel>Quick actions</SectionLabel>
          <div className="flex flex-wrap gap-2 mt-2">
            {canConnect && (
              <ActionBtn icon={<Search className="w-3.5 h-3.5" />} onClick={openCommandPalette} shortcut="Ctrl+K">
                Search assets
              </ActionBtn>
            )}
            {isAdmin && (
              <>
                <ActionBtn icon={<Plus className="w-3.5 h-3.5" />} onClick={() => openModal("add-machine")}>
                  Add machine
                </ActionBtn>
                <ActionBtn icon={<Key className="w-3.5 h-3.5" />} onClick={() => openModal("add-credential")}>
                  Add credential
                </ActionBtn>
                <ActionBtn icon={<BookOpen className="w-3.5 h-3.5" />} onClick={() => openModal("audit")}>
                  Audit log
                </ActionBtn>
              </>
            )}
          </div>
        </div>

        {/* Getting started (only if empty) */}
        {machines.length === 0 && isAdmin && (
          <div className="rounded-lg border border-accent/25 bg-accent/5 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Lightbulb className="w-4 h-4 text-accent" />
              <span className="text-sm font-semibold text-gray-200">Get started with WARDEN</span>
            </div>
            <ol className="space-y-2.5 text-xs text-muted">
              <GuidedStep n={1}>
                <b className="text-gray-300">Add a machine:</b> click <code className="bg-surface-700 px-1 py-0.5 rounded text-accent">+</code> in the sidebar or use the button above.
              </GuidedStep>
              <GuidedStep n={2}>
                <b className="text-gray-300">Store a credential:</b> click <i>Add credential</i> to save an SSH password securely in Windows Credential Manager.
              </GuidedStep>
              <GuidedStep n={3}>
                <b className="text-gray-300">Add a connection:</b> right-click any machine in the sidebar and choose <i>Add connection</i> to configure the protocol, host, and credential.
              </GuidedStep>
              <GuidedStep n={4}>
                <b className="text-gray-300">Connect:</b> double-click any connection, or press <kbd className="bg-surface-700 border border-surface-600 rounded px-1 font-mono">Ctrl+K</kbd> to fuzzy-search and jump.
              </GuidedStep>
            </ol>
          </div>
        )}

        {/* Recent connections */}
        <div>
          <SectionLabel>Recent connections</SectionLabel>
          <div className="mt-2 space-y-1">
            {loadingRecent ? (
              <div className="text-muted text-xs py-2">Loading…</div>
            ) : recentEvents.length === 0 ? (
              <div className="rounded-lg border border-surface-600 bg-surface-800 px-4 py-5 text-center text-xs text-muted">
                No sessions yet. Double-click a connection in the sidebar to open a session.
              </div>
            ) : (
              recentEvents.map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-surface-800 border border-surface-600 text-xs group hover:border-surface-500 transition-colors"
                >
                  <Zap className="w-3 h-3 text-accent/50 flex-shrink-0" />
                  <span className="flex-1 text-gray-300 truncate font-mono">
                    {ev.detail ?? ev.target ?? "N/A"}
                  </span>
                  <span className="text-muted flex-shrink-0 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {timeAgo(ev.ts)}
                  </span>
                  <ArrowRight className="w-3 h-3 text-muted opacity-0 group-hover:opacity-60 transition-opacity" />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Keyboard shortcuts */}
        <div>
          <SectionLabel>Keyboard shortcuts</SectionLabel>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-muted">
            {[
              ["Ctrl+K", "Open command palette"],
              ["Double-click", "Connect to a machine connection"],
              ["Right-click", "Add / edit / delete connections"],
              ["Escape", "Close any modal or palette"],
            ].map(([key, desc]) => (
              <div key={key} className="flex items-center gap-2">
                <kbd className="flex-shrink-0 px-1.5 py-0.5 rounded bg-surface-800 border border-surface-600 font-mono text-[10px] text-gray-400">
                  {key}
                </kbd>
                <span>{desc}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[10px] font-semibold text-muted uppercase tracking-widest">
      {children}
    </h2>
  );
}

function StatCard({
  icon, label, value, accent, pulse,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  accent: "blue" | "purple" | "green" | "gray";
  pulse?: boolean;
}) {
  const colors = {
    blue: "text-blue-400",
    purple: "text-purple-400",
    green: "text-green-400",
    gray: "text-muted",
  };
  return (
    <div className="rounded-lg bg-surface-800 border border-surface-600 px-4 py-3 hover:border-surface-500 transition-colors">
      <div className={clsx("mb-2 flex items-center gap-1.5", colors[accent])}>
        {icon}
        {pulse && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
      </div>
      <div className="text-2xl font-bold text-gray-100 tabular-nums">{value}</div>
      <div className="text-[11px] text-muted mt-0.5">{label}</div>
    </div>
  );
}

function ActionBtn({
  icon, children, onClick, shortcut,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  shortcut?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-surface-800 border border-surface-600 hover:border-accent/40 hover:bg-accent/5 text-xs text-gray-300 transition-all"
    >
      <span className="text-accent/70">{icon}</span>
      {children}
      {shortcut && (
        <kbd className="ml-1 px-1 py-0.5 rounded bg-surface-700 border border-surface-600 font-mono text-[10px] text-muted">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}

function GuidedStep({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="flex-shrink-0 w-4 h-4 rounded-full bg-accent/20 text-accent text-[10px] flex items-center justify-center mt-0.5 font-bold">
        {n}
      </span>
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}
