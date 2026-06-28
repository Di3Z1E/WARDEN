import { useState } from "react";
import { X, Server, Monitor, Cpu, Network, Terminal } from "lucide-react";
import clsx from "clsx";
import { createMachine } from "../../lib/tauri";
import { useUiStore, useInventoryStore } from "../../store";
import type { MachineType } from "../../types";

const MACHINE_TYPES: {
  value: MachineType;
  label: string;
  desc: string;
  icon: React.ReactNode;
}[] = [
  { value: "WindowsServer", label: "Windows Server", desc: "2016/2019/2022", icon: <Server className="w-4 h-4 text-blue-400" /> },
  { value: "WindowsClient", label: "Windows Client", desc: "10/11 workstation", icon: <Monitor className="w-4 h-4 text-blue-300" /> },
  { value: "Linux", label: "Linux", desc: "Ubuntu, RHEL, Debian…", icon: <Terminal className="w-4 h-4 text-green-400" /> },
  { value: "EsxiVsphere", label: "ESXi / vSphere", desc: "VMware hypervisor", icon: <Cpu className="w-4 h-4 text-orange-400" /> },
  { value: "IpmiIdrac", label: "IPMI / iDRAC", desc: "BMC / out-of-band", icon: <Cpu className="w-4 h-4 text-red-400" /> },
  { value: "NetworkDevice", label: "Network device", desc: "Switch, router, AP", icon: <Network className="w-4 h-4 text-purple-400" /> },
  { value: "GenericSsh", label: "Generic SSH", desc: "Any SSH-capable host", icon: <Terminal className="w-4 h-4 text-gray-400" /> },
  { value: "Generic", label: "Generic", desc: "Other / uncategorised", icon: <Server className="w-4 h-4 text-gray-400" /> },
];

export default function AddMachineModal() {
  const { closeModal } = useUiStore();
  const { upsertMachine } = useInventoryStore();
  const [name, setName] = useState("");
  const [type, setType] = useState<MachineType>("Linux");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const machine = await createMachine({
        name: name.trim(),
        machine_type: type,
        folder_id: null,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        notes: notes.trim() || null,
      });
      upsertMachine(machine);
      closeModal();
    } catch (err: unknown) {
      setError((err as { message?: string })?.message ?? "Failed to create machine");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={closeModal}>
      <div
        className="w-[520px] bg-surface-800 rounded-xl border border-surface-600 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-600">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-gray-100">Add machine</h2>
          </div>
          <button onClick={closeModal} className="text-muted hover:text-gray-200 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs text-muted mb-1.5">Display name *</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-accent placeholder-muted"
              placeholder="prod-web-01"
            />
            <p className="text-[11px] text-muted mt-1">Used as the label in the asset tree. Host / IP address is set per-connection.</p>
          </div>

          {/* Type grid */}
          <div>
            <label className="block text-xs text-muted mb-1.5">Machine type *</label>
            <div className="grid grid-cols-2 gap-1.5">
              {MACHINE_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setType(t.value)}
                  className={clsx(
                    "flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left text-xs transition-colors",
                    type === t.value
                      ? "border-accent bg-accent/10 text-gray-100"
                      : "border-surface-600 bg-surface-700 text-muted hover:border-surface-500 hover:text-gray-300"
                  )}
                >
                  <span className="flex-shrink-0">{t.icon}</span>
                  <span>
                    <div className="font-medium">{t.label}</div>
                    <div className="text-[10px] opacity-60 mt-0.5">{t.desc}</div>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs text-muted mb-1.5">Tags</label>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-accent placeholder-muted"
              placeholder="prod, eu-west, web (comma-separated)"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs text-muted mb-1.5">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-accent resize-none placeholder-muted"
              placeholder="Anything useful: purpose, owner, rack location…"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={closeModal}
              className="flex-1 border border-surface-600 hover:bg-surface-700 text-sm py-2 rounded-lg transition-colors text-gray-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="flex-1 bg-accent hover:bg-blue-500 disabled:opacity-50 text-white text-sm py-2 rounded-lg transition-colors font-medium"
            >
              {loading ? "Creating…" : "Add machine"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
