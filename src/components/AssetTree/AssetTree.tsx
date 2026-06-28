import { useEffect, useRef, useState } from "react";
import {
  Server, Monitor, Cpu, Network, Terminal, RefreshCw, Plus,
  ChevronRight, ChevronDown, Key, Wifi, Trash2, PlugZap, Zap,
  Search, X, Edit2, Globe, Copy, Signal, FolderOpen,
} from "lucide-react";
import clsx from "clsx";
import {
  listFolders, listMachines, listProfiles,
  connectSsh, connectTelnet, connectSftp, connectRdp, wakeOnLan, deleteMachine, deleteProfile,
  pingHost,
} from "../../lib/tauri";
import { useInventoryStore, useSessionStore, useUiStore, useAuthStore } from "../../store";
import type { Machine, MachineType, ConnectionProfile } from "../../types";
import AddProfileModal from "../modals/AddProfileModal";
import EditMachineModal from "../modals/EditMachineModal";
import EditProfileModal from "../modals/EditProfileModal";
import NetworkShareModal from "../modals/NetworkShareModal";

const MACHINE_ICONS: Record<MachineType, React.ReactNode> = {
  WindowsServer: <Server className="w-3.5 h-3.5 text-blue-400" />,
  WindowsClient: <Monitor className="w-3.5 h-3.5 text-blue-300" />,
  Linux: <Terminal className="w-3.5 h-3.5 text-green-400" />,
  EsxiVsphere: <Cpu className="w-3.5 h-3.5 text-orange-400" />,
  IpmiIdrac: <Cpu className="w-3.5 h-3.5 text-red-400" />,
  NetworkDevice: <Network className="w-3.5 h-3.5 text-purple-400" />,
  GenericSsh: <Terminal className="w-3.5 h-3.5 text-gray-400" />,
  Generic: <Server className="w-3.5 h-3.5 text-gray-400" />,
};

const PROTOCOL_COLORS: Record<string, string> = {
  SSH: "text-green-400 bg-green-900/20 border-green-800/40",
  RDP: "text-blue-400 bg-blue-900/20 border-blue-800/40",
  Telnet: "text-yellow-400 bg-yellow-900/20 border-yellow-800/40",
  VNC: "text-purple-400 bg-purple-900/20 border-purple-800/40",
  SFTP: "text-cyan-400 bg-cyan-900/20 border-cyan-800/40",
  HTTP: "text-orange-400 bg-orange-900/20 border-orange-800/40",
};

function timeAgoShort(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d`;
  if (h > 0) return `${h}h`;
  return "<1h";
}

type CtxTarget =
  | { kind: "machine"; machine: Machine }
  | { kind: "profile"; profile: ConnectionProfile; machine: Machine };

interface CtxMenu { x: number; y: number; target: CtxTarget; }

interface PingNotif {
  host: string;
  alive: boolean;
  latency_ms: number | null;
}

export default function AssetTree() {
  const { machines, selectedMachineId, selectMachine, isLoading, setLoading, setMachines, setFolders, removeMachine } =
    useInventoryStore();
  const { openModal } = useUiStore();
  const { user } = useAuthStore();
  const { addTab, tabs } = useSessionStore();

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [machineProfiles, setMachineProfiles] = useState<Record<string, ConnectionProfile[]>>({});
  const [connectingProfileId, setConnectingProfileId] = useState<string | null>(null);
  const [ctx, setCtx] = useState<CtxMenu | null>(null);
  const [addProfileFor, setAddProfileFor] = useState<Machine | null>(null);
  const [editMachine, setEditMachine] = useState<Machine | null>(null);
  const [editProfile, setEditProfile] = useState<{ machine: Machine; profile: ConnectionProfile } | null>(null);
  const [filter, setFilter] = useState("");
  const [pingNotif, setPingNotif] = useState<PingNotif | null>(null);
  const [networkSharePath, setNetworkSharePath] = useState<string | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  const isAdmin = user?.role === "Admin";
  const canConnect = user?.role === "Admin" || user?.role === "Operator";

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    if (!ctx) return;
    function onOutside(e: MouseEvent) {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtx(null);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [ctx]);

  useEffect(() => () => { if (pingTimerRef.current) clearTimeout(pingTimerRef.current); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const [f, m] = await Promise.all([listFolders(), listMachines()]);
      setFolders(f);
      setMachines(m);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function loadProfiles(machine: Machine) {
    if (machineProfiles[machine.id]) return;
    try {
      const profiles = await listProfiles(machine.id);
      setMachineProfiles((p) => ({ ...p, [machine.id]: profiles }));
    } catch (e) { console.error(e); }
  }

  async function reloadProfiles(machine: Machine) {
    try {
      const profiles = await listProfiles(machine.id);
      setMachineProfiles((p) => ({ ...p, [machine.id]: profiles }));
    } catch (e) { console.error(e); }
  }

  async function toggleMachine(machine: Machine) {
    const isOpen = expanded.has(machine.id);
    if (!isOpen) await loadProfiles(machine);
    setExpanded((prev) => {
      const next = new Set(prev);
      isOpen ? next.delete(machine.id) : next.add(machine.id);
      return next;
    });
    selectMachine(machine.id);
  }

  async function openSession(machine: Machine, profile: ConnectionProfile) {
    if (!canConnect) return;
    setConnectingProfileId(profile.id);
    try {
      let result: { id: string; protocol: string; profile_id: string };
      if (profile.protocol === "SSH") {
        result = await connectSsh({ profile_id: profile.id, cols: 120, rows: 40 });
      } else if (profile.protocol === "Telnet") {
        result = await connectTelnet({ profile_id: profile.id });
      } else if (profile.protocol === "SFTP") {
        const sftp = await connectSftp({ profile_id: profile.id });
        result = { id: sftp.id, protocol: "SFTP", profile_id: profile.id };
      } else if (profile.protocol === "RDP") {
        const rdp = await connectRdp({ profile_id: profile.id, width: 1280, height: 800 });
        result = { id: rdp.id, protocol: "RDP", profile_id: profile.id };
      } else {
        alert(`${profile.protocol} sessions are not yet supported in this build.`);
        return;
      }
      addTab({
        id: result.id,
        protocol: result.protocol,
        profileId: profile.id,
        machineId: machine.id,
        machineName: machine.name,
        label: `${machine.name} - ${profile.label}`,
        host: profile.host,
      });
    } catch (err: unknown) {
      const e = err as { message?: string };
      alert(`Connection failed: ${e?.message ?? "Unknown error"}`);
    } finally {
      setConnectingProfileId(null);
    }
  }

  function openCtx(e: React.MouseEvent, target: CtxTarget) {
    e.preventDefault();
    e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY, target });
  }

  function showPingNotif(notif: PingNotif) {
    setPingNotif(notif);
    if (pingTimerRef.current) clearTimeout(pingTimerRef.current);
    pingTimerRef.current = setTimeout(() => setPingNotif(null), 4000);
  }

  async function handleCtxAction(action: string) {
    if (!ctx) return;
    setCtx(null);

    if (ctx.target.kind === "machine") {
      const m = ctx.target.machine;
      const host = machineProfiles[m.id]?.[0]?.host ?? m.name;

      if (action === "add-profile") { setAddProfileFor(m); }
      else if (action === "edit") { setEditMachine(m); }
      else if (action === "add-credential") { openModal("add-credential"); }
      else if (action === "ping") {
        try {
          const result = await pingHost(host);
          showPingNotif({ host, alive: result.alive, latency_ms: result.latency_ms ?? null });
        } catch {
          showPingNotif({ host, alive: false, latency_ms: null });
        }
      }
      else if (action === "copy-ip") {
        navigator.clipboard.writeText(host).catch(() => {});
      }
      else if (action === "open-browser") {
        window.open(`http://${host}`, "_blank");
      }
      else if (action === "net-share") {
        const defaultPath = `\\\\${host}\\`;
        setNetworkSharePath(defaultPath);
      }
      else if (action === "wol") {
        const mac = prompt(`Wake-on-LAN for "${m.name}"\n\nEnter MAC address (e.g. AA:BB:CC:DD:EE:FF):`);
        if (mac) {
          try {
            await wakeOnLan(mac, undefined, m.id);
            alert(`Wake-on-LAN packet sent to ${mac}`);
          } catch (err: unknown) {
            alert(`WoL failed: ${(err as { message?: string })?.message}`);
          }
        }
      }
      else if (action === "delete") {
        if (!confirm(`Delete "${m.name}" and all its connection profiles?`)) return;
        try {
          await deleteMachine(m.id);
          removeMachine(m.id);
          selectMachine(null);
        } catch (err: unknown) {
          alert(`Delete failed: ${(err as { message?: string })?.message}`);
        }
      }
    }

    if (ctx.target.kind === "profile") {
      const { profile, machine } = ctx.target;
      if (action === "connect") { openSession(machine, profile); }
      else if (action === "edit") { setEditProfile({ machine, profile }); }
      else if (action === "copy-host") {
        navigator.clipboard.writeText(profile.host).catch(() => {});
      }
      else if (action === "open-browser") {
        window.open(`http://${profile.host}:${profile.port}`, "_blank");
      }
      else if (action === "delete") {
        if (!confirm(`Delete profile "${profile.label}"?`)) return;
        try {
          await deleteProfile(profile.id);
          setMachineProfiles((p) => ({
            ...p,
            [machine.id]: (p[machine.id] ?? []).filter((x) => x.id !== profile.id),
          }));
        } catch (err: unknown) {
          alert(`Delete failed: ${(err as { message?: string })?.message}`);
        }
      }
    }
  }

  // Filter machines by name or tag
  const q = filter.toLowerCase();
  const filtered = q
    ? machines.filter((m) =>
        m.name.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q))
      )
    : machines;

  const activeMachineIds = new Set(tabs.map((t) => t.machineId));

  return (
    <div className="flex flex-col h-full" onContextMenu={(e) => e.preventDefault()}>
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-surface-600 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-muted uppercase tracking-widest">
            Assets
            {machines.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-surface-700 text-muted text-[10px]">
                {machines.length}
              </span>
            )}
          </span>
          <div className="flex gap-1">
            <button
              onClick={refresh}
              className="p-1 rounded hover:bg-surface-600 text-muted hover:text-gray-200 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={clsx("w-3.5 h-3.5", isLoading && "animate-spin")} />
            </button>
            {isAdmin && (
              <>
                <button
                  onClick={() => openModal("add-machine")}
                  className="p-1 rounded hover:bg-surface-600 text-muted hover:text-gray-200 transition-colors"
                  title="Add machine"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => openModal("add-credential")}
                  className="p-1 rounded hover:bg-surface-600 text-muted hover:text-gray-200 transition-colors"
                  title="Add credential"
                >
                  <Key className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Filter input */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted pointer-events-none" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full bg-surface-700 border border-surface-600 rounded text-xs pl-6 pr-6 py-1 text-gray-300 placeholder-muted focus:outline-none focus:border-accent/50"
            placeholder="Filter by name or tag..."
          />
          {filter && (
            <button
              onClick={() => setFilter("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-gray-300"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Ping notification */}
      {pingNotif && (
        <div className={clsx(
          "mx-2 mt-2 flex items-center gap-2 px-3 py-2 rounded-lg text-xs border transition-all",
          pingNotif.alive
            ? "bg-green-900/20 border-green-800/40 text-green-300"
            : "bg-red-900/20 border-red-800/40 text-red-300"
        )}>
          <Signal className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="font-mono truncate">{pingNotif.host}</span>
          <span className="ml-auto flex-shrink-0">
            {pingNotif.alive
              ? pingNotif.latency_ms != null ? `${pingNotif.latency_ms}ms` : "online"
              : "unreachable"}
          </span>
          <button onClick={() => setPingNotif(null)} className="text-current opacity-60 hover:opacity-100 ml-1">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1.5">
        {isLoading && machines.length === 0 ? (
          <div className="text-muted text-xs text-center mt-10 animate-pulse">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-muted text-xs text-center mt-10 px-4 leading-relaxed">
            {filter ? (
              <>No machines match "<span className="text-gray-300">{filter}</span>"</>
            ) : (
              <>
                No machines yet.
                {isAdmin && (
                  <>
                    {" "}
                    <button
                      onClick={() => openModal("add-machine")}
                      className="text-accent hover:underline"
                    >
                      Add your first
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        ) : (
          <ul className="space-y-px px-1">
            {filtered.map((machine) => (
              <MachineNode
                key={machine.id}
                machine={machine}
                isExpanded={expanded.has(machine.id)}
                isSelected={selectedMachineId === machine.id}
                hasActiveSession={activeMachineIds.has(machine.id)}
                profiles={machineProfiles[machine.id] ?? null}
                connectingProfileId={connectingProfileId}
                onToggle={() => toggleMachine(machine)}
                onConnect={(p) => openSession(machine, p)}
                onContext={(e, t) => openCtx(e, t)}
                canConnect={canConnect}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Context menu */}
      {ctx && (
        <div
          ref={ctxRef}
          className="fixed z-50 bg-surface-700 border border-surface-500 rounded-xl shadow-2xl py-1.5 min-w-52 text-xs"
          style={{ left: ctx.x, top: ctx.y }}
        >
          {ctx.target.kind === "machine" && (
            <>
              <div className="px-3 py-1 text-[10px] text-muted font-medium truncate max-w-52">
                {ctx.target.machine.name}
              </div>
              <div className="border-t border-surface-600 my-1" />

              {/* Connectivity */}
              {canConnect && (
                <CtxItem icon={<PlugZap className="w-3.5 h-3.5" />} label="Add connection" onClick={() => handleCtxAction("add-profile")} />
              )}
              <CtxItem icon={<Signal className="w-3.5 h-3.5" />} label="Ping host" onClick={() => handleCtxAction("ping")} />
              <CtxItem icon={<Copy className="w-3.5 h-3.5" />} label="Copy IP / hostname" onClick={() => handleCtxAction("copy-ip")} />
              <CtxItem icon={<Globe className="w-3.5 h-3.5" />} label="Open in browser" onClick={() => handleCtxAction("open-browser")} />
              <CtxItem icon={<FolderOpen className="w-3.5 h-3.5" />} label="Browse network share…" onClick={() => handleCtxAction("net-share")} />

              {isAdmin && (
                <>
                  <div className="border-t border-surface-600 my-1" />
                  <CtxItem icon={<Edit2 className="w-3.5 h-3.5" />} label="Edit machine" onClick={() => handleCtxAction("edit")} />
                  <CtxItem icon={<Key className="w-3.5 h-3.5" />} label="Add credential" onClick={() => handleCtxAction("add-credential")} />
                  <CtxItem icon={<Wifi className="w-3.5 h-3.5" />} label="Wake on LAN…" onClick={() => handleCtxAction("wol")} />
                  <div className="border-t border-surface-600 my-1" />
                  <CtxItem icon={<Trash2 className="w-3.5 h-3.5" />} label="Delete machine" danger onClick={() => handleCtxAction("delete")} />
                </>
              )}
            </>
          )}

          {ctx.target.kind === "profile" && (
            <>
              <div className="px-3 py-1 text-[10px] text-muted font-medium truncate max-w-52">
                {ctx.target.profile.label}
              </div>
              <div className="border-t border-surface-600 my-1" />
              {canConnect && (
                <CtxItem icon={<Zap className="w-3.5 h-3.5" />} label="Connect" onClick={() => handleCtxAction("connect")} />
              )}
              <CtxItem icon={<Copy className="w-3.5 h-3.5" />} label="Copy host:port" onClick={() => handleCtxAction("copy-host")} />
              <CtxItem icon={<Globe className="w-3.5 h-3.5" />} label="Open in browser" onClick={() => handleCtxAction("open-browser")} />
              {isAdmin && (
                <>
                  <div className="border-t border-surface-600 my-1" />
                  <CtxItem icon={<Edit2 className="w-3.5 h-3.5" />} label="Edit connection" onClick={() => handleCtxAction("edit")} />
                  <div className="border-t border-surface-600 my-1" />
                  <CtxItem icon={<Trash2 className="w-3.5 h-3.5" />} label="Delete connection" danger onClick={() => handleCtxAction("delete")} />
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Inline add-profile modal */}
      {addProfileFor && (
        <AddProfileModal
          machine={addProfileFor}
          onClose={() => setAddProfileFor(null)}
          onCreated={() => {
            const m = addProfileFor;
            setAddProfileFor(null);
            reloadProfiles(m);
          }}
        />
      )}

      {/* Inline edit-machine modal */}
      {editMachine && (
        <EditMachineModal
          machine={editMachine}
          onClose={() => setEditMachine(null)}
        />
      )}

      {/* Inline edit-profile modal */}
      {editProfile && (
        <EditProfileModal
          machine={editProfile.machine}
          profile={editProfile.profile}
          onClose={() => setEditProfile(null)}
          onSaved={(updated) => {
            setMachineProfiles((p) => ({
              ...p,
              [editProfile.machine.id]: (p[editProfile.machine.id] ?? []).map(
                (x) => (x.id === updated.id ? updated : x)
              ),
            }));
          }}
        />
      )}

      {/* Network share browser */}
      {networkSharePath && (
        <NetworkShareModal
          initialPath={networkSharePath}
          onClose={() => setNetworkSharePath(null)}
        />
      )}
    </div>
  );
}

// ── Context menu item ─────────────────────────────────────────────────────────

function CtxItem({ icon, label, danger, onClick }: {
  icon: React.ReactNode; label: string; danger?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "w-full flex items-center gap-2.5 px-3 py-1.5 transition-colors",
        danger ? "text-red-400 hover:bg-red-900/20" : "text-gray-300 hover:bg-surface-600"
      )}
    >
      {icon}{label}
    </button>
  );
}

// ── Machine tree node ─────────────────────────────────────────────────────────

interface MachineNodeProps {
  machine: Machine;
  isExpanded: boolean;
  isSelected: boolean;
  hasActiveSession: boolean;
  profiles: ConnectionProfile[] | null;
  connectingProfileId: string | null;
  onToggle: () => void;
  onConnect: (p: ConnectionProfile) => void;
  onContext: (e: React.MouseEvent, target: CtxTarget) => void;
  canConnect: boolean;
}

function MachineNode({
  machine, isExpanded, isSelected, hasActiveSession, profiles,
  connectingProfileId, onToggle, onConnect, onContext, canConnect,
}: MachineNodeProps) {
  return (
    <li>
      <button
        onClick={onToggle}
        onContextMenu={(e) => onContext(e, { kind: "machine", machine })}
        className={clsx(
          "w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-left text-xs transition-colors group",
          isSelected ? "bg-accent/15 text-gray-100" : "hover:bg-surface-700 text-gray-300"
        )}
      >
        <span className="text-muted w-3 flex-shrink-0">
          {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
        {MACHINE_ICONS[machine.machine_type]}
        <span className="truncate flex-1 font-medium">{machine.name}</span>

        {hasActiveSession && (
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" title="Active session" />
        )}

        {machine.last_connected_at && !hasActiveSession && (
          <span className="text-[10px] text-muted flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            {timeAgoShort(machine.last_connected_at)}
          </span>
        )}
      </button>

      {isExpanded && machine.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 ml-9 mb-1 px-1">
          {machine.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-700 text-muted border border-surface-600">
              {tag}
            </span>
          ))}
        </div>
      )}

      {isExpanded && machine.notes && (
        <div className="ml-9 mb-1 px-1 text-[10px] text-muted italic line-clamp-2">
          {machine.notes}
        </div>
      )}

      {isExpanded && (
        <ul className="ml-7 mt-0.5 mb-1 space-y-px">
          {profiles === null ? (
            <li className="text-muted text-xs px-2 py-1.5 animate-pulse">Loading profiles...</li>
          ) : profiles.length === 0 ? (
            <li className="text-muted text-[11px] px-2 py-1.5 italic">
              No connections yet. Right-click to add one.
            </li>
          ) : (
            profiles.map((profile) => {
              const isConnecting = connectingProfileId === profile.id;
              const protocolColor = PROTOCOL_COLORS[profile.protocol] ?? "text-muted bg-surface-700 border-surface-600";
              return (
                <li key={profile.id}>
                  <button
                    onDoubleClick={() => canConnect && onConnect(profile)}
                    onContextMenu={(e) => onContext(e, { kind: "profile", profile, machine })}
                    className={clsx(
                      "w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs transition-colors",
                      canConnect
                        ? "hover:bg-accent/10 text-gray-400 hover:text-gray-200"
                        : "text-muted cursor-default",
                      isConnecting && "opacity-60 cursor-wait"
                    )}
                    title={canConnect ? "Double-click to connect" : undefined}
                  >
                    <span className={clsx(
                      "text-[10px] px-1.5 py-0.5 rounded border font-mono flex-shrink-0",
                      protocolColor
                    )}>
                      {profile.protocol}
                    </span>
                    <span className="truncate flex-1">{profile.label}</span>
                    <span className="text-muted text-[10px] flex-shrink-0 font-mono">{profile.host}</span>
                    {isConnecting && (
                      <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse flex-shrink-0" />
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </li>
  );
}
