import { useEffect, useState } from "react";
import { X, PlugZap } from "lucide-react";
import { createProfile, listCredentialSets } from "../../lib/tauri";
import type { CredentialSet, Machine, Protocol } from "../../types";

const PROTOCOLS: { value: Protocol; label: string; desc: string }[] = [
  { value: "SSH", label: "SSH", desc: "Secure Shell: terminal access" },
  { value: "RDP", label: "RDP", desc: "Remote Desktop Protocol" },
  { value: "Telnet", label: "Telnet", desc: "Unencrypted terminal (legacy)" },
  { value: "VNC", label: "VNC", desc: "Virtual Network Computing" },
  { value: "SFTP", label: "SFTP", desc: "SSH File Transfer Protocol" },
  { value: "HTTP", label: "HTTP/S", desc: "Web management interface" },
];

const DEFAULT_PORTS: Record<Protocol, number> = {
  SSH: 22, RDP: 3389, Telnet: 23, VNC: 5900, SFTP: 22, HTTP: 443,
};

interface Props {
  machine: Machine;
  onClose: () => void;
  onCreated?: () => void;
}

export default function AddProfileModal({ machine, onClose, onCreated }: Props) {
  const [label, setLabel] = useState("");
  const [protocol, setProtocol] = useState<Protocol>("SSH");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(22);
  const [credId, setCredId] = useState<string>("");
  const [creds, setCreds] = useState<CredentialSet[]>([]);
  const [rdpNla, setRdpNla] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    listCredentialSets().then(setCreds).catch(console.error);
  }, []);

  function handleProtocolChange(p: Protocol) {
    setProtocol(p);
    setPort(DEFAULT_PORTS[p]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !host.trim()) return;
    setError(null);
    setLoading(true);
    try {
      await createProfile({
        machine_id: machine.id,
        label: label.trim(),
        protocol,
        host: host.trim(),
        port,
        options: protocol === "RDP" ? { nla: rdpNla } : undefined,
        credential_set_id: credId || null,
      });
      onCreated?.();
      onClose();
    } catch (err: unknown) {
      setError((err as { message?: string })?.message ?? "Failed to create profile");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="w-[460px] bg-surface-800 rounded-xl border border-surface-600 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-600">
          <div className="flex items-center gap-2">
            <PlugZap className="w-4 h-4 text-accent" />
            <div>
              <h2 className="text-sm font-semibold text-gray-100">Add connection</h2>
              <p className="text-xs text-muted mt-0.5">to <span className="text-gray-300">{machine.name}</span></p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-gray-200 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Label */}
          <div>
            <label className="block text-xs text-muted mb-1.5">Connection label *</label>
            <input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-accent placeholder-muted"
              placeholder="SSH (root), RDP admin…"
            />
          </div>

          {/* Protocol picker */}
          <div>
            <label className="block text-xs text-muted mb-1.5">Protocol *</label>
            <div className="grid grid-cols-3 gap-1.5">
              {PROTOCOLS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => handleProtocolChange(p.value)}
                  className={clsx(
                    "text-left px-2.5 py-2 rounded-lg border text-xs transition-colors",
                    protocol === p.value
                      ? "border-accent bg-accent/10 text-gray-100"
                      : "border-surface-600 bg-surface-700 text-muted hover:border-surface-500 hover:text-gray-300"
                  )}
                >
                  <div className="font-semibold">{p.label}</div>
                  <div className="text-[10px] opacity-70 mt-0.5">{p.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Host + Port */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-muted mb-1.5">Host / IP address *</label>
              <input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-accent font-mono placeholder-muted"
                placeholder="192.168.1.100"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1.5">Port *</label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                min={1}
                max={65535}
                className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-accent font-mono"
              />
            </div>
          </div>

          {/* RDP: NLA toggle */}
          {protocol === "RDP" && (
            <div className="flex items-center justify-between bg-surface-700 border border-surface-600 rounded-lg px-3 py-2.5">
              <div>
                <p className="text-xs font-medium text-gray-200">Network Level Authentication (NLA)</p>
                <p className="text-[10px] text-muted mt-0.5">Disable if the server does not enforce NLA / CredSSP</p>
              </div>
              <button
                type="button"
                onClick={() => setRdpNla((v) => !v)}
                className={clsx(
                  "relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200",
                  rdpNla ? "bg-accent" : "bg-surface-500"
                )}
              >
                <span
                  className={clsx(
                    "inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200",
                    rdpNla ? "translate-x-4" : "translate-x-0"
                  )}
                />
              </button>
            </div>
          )}

          {/* Credential */}
          <div>
            <label className="block text-xs text-muted mb-1.5">Credential set</label>
            <select
              value={credId}
              onChange={(e) => setCredId(e.target.value)}
              className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-accent"
            >
              <option value="">No credential (prompt on connect)</option>
              {creds.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.kind} · {c.username}
                </option>
              ))}
            </select>
            {creds.length === 0 && (
              <p className="text-xs text-muted mt-1">
                No credentials stored yet. Add one via <span className="text-accent">Add credential</span>.
              </p>
            )}
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-surface-600 hover:bg-surface-700 text-sm py-2 rounded-lg transition-colors text-gray-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !label.trim() || !host.trim()}
              className="flex-1 bg-accent hover:bg-blue-500 disabled:opacity-50 text-white text-sm py-2 rounded-lg transition-colors font-medium"
            >
              {loading ? "Creating…" : "Add connection"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function clsx(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
