import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Globe, Loader2, Plus, Radar, ServerCrash, StopCircle, X,
} from "lucide-react";
import clsx from "clsx";
import { cancelScan, scanSubnet } from "../../lib/tauri";
import { useInventoryStore, useUiStore } from "../../store";
import type { MachineType, ScanHost } from "../../types";
import { createMachine, createProfile } from "../../lib/tauri";

const PORT_LABELS: Record<number, string> = {
  22: "SSH", 80: "HTTP", 443: "HTTPS",
  135: "WMI", 445: "SMB", 3389: "RDP",
  5900: "VNC", 8080: "HTTP-alt", 8443: "HTTPS-alt",
};

function guessType(ports: number[]): MachineType {
  if (ports.includes(3389)) return "WindowsServer";
  if (ports.includes(22) && ports.includes(80)) return "Linux";
  if (ports.includes(22)) return "GenericSsh";
  if (ports.includes(80) || ports.includes(443)) return "Generic";
  return "Generic";
}

function guessProtocol(ports: number[]): { protocol: string; port: number } | null {
  if (ports.includes(22))   return { protocol: "SSH",    port: 22 };
  if (ports.includes(3389)) return { protocol: "RDP",    port: 3389 };
  if (ports.includes(5900)) return { protocol: "VNC",    port: 5900 };
  if (ports.includes(443))  return { protocol: "HTTP",   port: 443 };
  if (ports.includes(80))   return { protocol: "HTTP",   port: 80 };
  return null;
}

interface Props { onClose: () => void }

export default function NetworkScanner({ onClose }: Props) {
  const [cidr, setCidr] = useState("192.168.1.0/24");
  const [scanning, setScanning] = useState(false);
  const [scanId, setScanId] = useState<string | null>(null);
  const [hosts, setHosts] = useState<ScanHost[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingIp, setAddingIp] = useState<string | null>(null);
  const unlistenRefs = useRef<Array<() => void>>([]);
  const { upsertMachine } = useInventoryStore();
  const { openModal } = useUiStore();

  useEffect(() => {
    return () => {
      unlistenRefs.current.forEach((u) => u());
    };
  }, []);

  async function startScan() {
    setHosts([]);
    setDone(false);
    setError(null);
    setScanning(true);

    let id: string;
    try {
      id = await scanSubnet({ cidr: cidr.trim() });
    } catch (err: unknown) {
      setError((err as { message?: string })?.message ?? "Scan failed to start");
      setScanning(false);
      return;
    }

    setScanId(id);

    const unlistenResult = await listen<ScanHost>(`scanner:result:${id}`, (event) => {
      setHosts((prev) => {
        const exists = prev.some((h) => h.ip === event.payload.ip);
        return exists ? prev : [...prev, event.payload].sort((a, b) => {
          const aN = a.ip.split(".").map(Number);
          const bN = b.ip.split(".").map(Number);
          for (let i = 0; i < 4; i++) {
            if (aN[i] !== bN[i]) return aN[i] - bN[i];
          }
          return 0;
        });
      });
    });

    const unlistenDone = await listen(`scanner:done:${id}`, () => {
      setDone(true);
      setScanning(false);
      setScanId(null);
    });

    unlistenRefs.current.push(unlistenResult, unlistenDone);
  }

  async function stopScan() {
    if (scanId) {
      await cancelScan(scanId).catch(() => {});
      setScanId(null);
    }
    setScanning(false);
    setDone(true);
  }

  async function addToInventory(host: ScanHost) {
    setAddingIp(host.ip);
    try {
      const machine = await createMachine({
        name: host.ip,
        machine_type: guessType(host.open_ports),
        tags: [],
      });
      upsertMachine(machine);

      const proto = guessProtocol(host.open_ports);
      if (proto) {
        await createProfile({
          machine_id: machine.id,
          label: proto.protocol,
          protocol: proto.protocol as import("../../types").Protocol,
          host: host.ip,
          port: proto.port,
        });
      }

      openModal(null);
      onClose();
    } catch (err: unknown) {
      alert((err as { message?: string })?.message ?? "Failed to add machine");
    } finally {
      setAddingIp(null);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="w-[680px] max-h-[85vh] flex flex-col bg-surface-800 rounded-xl border border-surface-600 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-600 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Radar className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-gray-100">Network Scanner</h2>
          </div>
          <button onClick={onClose} className="text-muted hover:text-gray-200 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Controls */}
        <div className="px-5 py-4 border-b border-surface-600 flex items-end gap-3 flex-shrink-0">
          <div className="flex-1">
            <label className="text-xs text-muted block mb-1">CIDR range</label>
            <input
              value={cidr}
              onChange={(e) => setCidr(e.target.value)}
              disabled={scanning}
              placeholder="192.168.1.0/24"
              className="w-full bg-surface-700 border border-surface-500 rounded-md px-3 py-2 text-sm font-mono text-gray-100 focus:outline-none focus:border-accent disabled:opacity-50"
            />
          </div>
          {scanning ? (
            <button
              onClick={stopScan}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium transition-colors"
            >
              <StopCircle className="w-4 h-4" /> Stop
            </button>
          ) : (
            <button
              onClick={startScan}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-blue-500 text-white text-xs font-medium transition-colors"
            >
              <Radar className="w-4 h-4" /> Scan
            </button>
          )}
        </div>

        {/* Info strip */}
        <div className="px-5 py-2 border-b border-surface-600 flex items-center gap-3 text-xs text-muted flex-shrink-0">
          <Globe className="w-3.5 h-3.5" />
          <span>TCP probe on ports: SSH 22, RDP 3389, VNC 5900, SMB 445, WMI 135, HTTP 80/8080, HTTPS 443/8443</span>
          {scanning && <Loader2 className="w-3.5 h-3.5 animate-spin ml-auto text-accent" />}
          {done && <span className="ml-auto text-green-400">Scan complete — {hosts.length} host{hosts.length !== 1 ? "s" : ""} found</span>}
        </div>

        {/* Results */}
        <div className="overflow-y-auto flex-1 p-4 space-y-2">
          {error && (
            <div className="text-xs text-red-400 bg-red-900/20 border border-red-900/30 rounded px-3 py-2">
              {error}
            </div>
          )}

          {hosts.length === 0 && !scanning && !done && (
            <div className="text-center py-16 text-xs text-muted">
              Enter a CIDR range and click <b>Scan</b> to discover hosts.
            </div>
          )}

          {hosts.length === 0 && (scanning || done) && !error && (
            <div className="text-center py-16 text-xs text-muted">
              {scanning ? "Scanning…" : "No hosts found."}
            </div>
          )}

          {hosts.map((host) => (
            <HostCard
              key={host.ip}
              host={host}
              adding={addingIp === host.ip}
              onAdd={() => addToInventory(host)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── HostCard ──────────────────────────────────────────────────────────────────

function HostCard({
  host, adding, onAdd,
}: { host: ScanHost; adding: boolean; onAdd: () => void }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 rounded-lg border border-surface-600 bg-surface-700/50">
      <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-mono font-medium text-gray-100">{host.ip}</p>
        <div className="flex flex-wrap gap-1 mt-1">
          {host.open_ports.map((p) => (
            <span
              key={p}
              className={clsx(
                "text-[10px] font-mono px-1.5 py-0.5 rounded",
                p === 22   && "bg-green-900/40 text-green-300",
                p === 3389 && "bg-blue-900/40 text-blue-300",
                p === 5900 && "bg-purple-900/40 text-purple-300",
                p === 443  && "bg-yellow-900/40 text-yellow-300",
                p === 80   && "bg-orange-900/40 text-orange-300",
                ![22, 3389, 5900, 443, 80].includes(p) && "bg-surface-600 text-muted",
              )}
              title={PORT_LABELS[p] ?? `port ${p}`}
            >
              {p}/{PORT_LABELS[p] ?? "?"}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted flex-shrink-0">
        <span>{host.latency_ms} ms</span>
        <ServerCrash className="w-3.5 h-3.5 opacity-50" />
        <span>{guessType(host.open_ports)}</span>
      </div>

      <button
        onClick={onAdd}
        disabled={adding}
        title="Add to inventory"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface-600 hover:bg-accent hover:text-white text-gray-300 text-xs font-medium transition-colors disabled:opacity-40"
      >
        {adding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
        Add
      </button>
    </div>
  );
}
