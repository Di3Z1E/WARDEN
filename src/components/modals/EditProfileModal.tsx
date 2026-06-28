import { useEffect, useState } from "react";
import { X, PlugZap } from "lucide-react";
import { updateProfile, listCredentialSets } from "../../lib/tauri";
import type { ConnectionProfile, CredentialSet, Machine, Protocol } from "../../types";

const PROTOCOLS: Protocol[] = ["SSH", "RDP", "Telnet", "VNC", "SFTP", "HTTP"];

const DEFAULT_PORTS: Record<Protocol, number> = {
  SSH: 22, RDP: 3389, Telnet: 23, VNC: 5900, SFTP: 22, HTTP: 443,
};

interface Props {
  machine: Machine;
  profile: ConnectionProfile;
  onClose: () => void;
  onSaved: (updated: ConnectionProfile) => void;
}

export default function EditProfileModal({ machine, profile, onClose, onSaved }: Props) {
  const [label, setLabel] = useState(profile.label);
  const [protocol, setProtocol] = useState<Protocol>(profile.protocol as Protocol);
  const [host, setHost] = useState(profile.host);
  const [port, setPort] = useState(profile.port);
  const [credId, setCredId] = useState(profile.credential_set_id ?? "");
  const [creds, setCreds] = useState<CredentialSet[]>([]);
  const [rdpNla, setRdpNla] = useState(profile.options?.nla !== false);
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
      const updated = await updateProfile(profile.id, {
        machine_id: machine.id,
        label: label.trim(),
        protocol,
        host: host.trim(),
        port,
        options: protocol === "RDP" ? { nla: rdpNla } : undefined,
        credential_set_id: credId || null,
      });
      onSaved(updated);
      onClose();
    } catch (err: unknown) {
      setError((err as { message?: string })?.message ?? "Failed to update profile");
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
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-600">
          <div className="flex items-center gap-2">
            <PlugZap className="w-4 h-4 text-accent" />
            <div>
              <h2 className="text-sm font-semibold text-gray-100">Edit connection</h2>
              <p className="text-xs text-muted mt-0.5">on <span className="text-gray-300">{machine.name}</span></p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-gray-200 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-muted mb-1.5">Connection label *</label>
            <input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-accent placeholder-muted"
            />
          </div>

          <div>
            <label className="block text-xs text-muted mb-1.5">Protocol *</label>
            <div className="grid grid-cols-3 gap-1.5">
              {PROTOCOLS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => handleProtocolChange(p)}
                  className={`px-3 py-2 rounded-lg border text-xs text-left transition-colors ${
                    protocol === p
                      ? "border-accent bg-accent/10 text-gray-100"
                      : "border-surface-600 bg-surface-700 text-muted hover:border-surface-500 hover:text-gray-300"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

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
                className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ${rdpNla ? "bg-accent" : "bg-surface-500"}`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200 ${rdpNla ? "translate-x-4" : "translate-x-0"}`}
                />
              </button>
            </div>
          )}

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
              {loading ? "Saving..." : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
