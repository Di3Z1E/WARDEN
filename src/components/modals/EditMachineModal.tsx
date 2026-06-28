import { useState } from "react";
import { X, Server } from "lucide-react";
import { updateMachine } from "../../lib/tauri";
import { useInventoryStore } from "../../store";
import type { Machine, MachineType } from "../../types";

const MACHINE_TYPES: { value: MachineType; label: string }[] = [
  { value: "WindowsServer", label: "Windows Server" },
  { value: "WindowsClient", label: "Windows Client" },
  { value: "Linux", label: "Linux" },
  { value: "EsxiVsphere", label: "ESXi / vSphere" },
  { value: "IpmiIdrac", label: "IPMI / iDRAC" },
  { value: "NetworkDevice", label: "Network device" },
  { value: "GenericSsh", label: "Generic SSH" },
  { value: "Generic", label: "Generic" },
];

interface Props {
  machine: Machine;
  onClose: () => void;
}

export default function EditMachineModal({ machine, onClose }: Props) {
  const { upsertMachine } = useInventoryStore();
  const [name, setName] = useState(machine.name);
  const [type, setType] = useState<MachineType>(machine.machine_type);
  const [tags, setTags] = useState(machine.tags.join(", "));
  const [notes, setNotes] = useState(machine.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const updated = await updateMachine(machine.id, {
        name: name.trim(),
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        notes: notes.trim() || null,
      });
      upsertMachine(updated);
      onClose();
    } catch (err: unknown) {
      setError((err as { message?: string })?.message ?? "Failed to update machine");
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
            <Server className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-gray-100">Edit machine</h2>
          </div>
          <button onClick={onClose} className="text-muted hover:text-gray-200 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-muted mb-1.5">Display name *</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-accent placeholder-muted"
            />
          </div>

          <div>
            <label className="block text-xs text-muted mb-1.5">Machine type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as MachineType)}
              className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-accent"
            >
              {MACHINE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-muted mb-1.5">Tags</label>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-accent placeholder-muted"
              placeholder="prod, eu-west (comma-separated)"
            />
          </div>

          <div>
            <label className="block text-xs text-muted mb-1.5">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-accent resize-none placeholder-muted"
              placeholder="Purpose, owner, location..."
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
              onClick={onClose}
              className="flex-1 border border-surface-600 hover:bg-surface-700 text-sm py-2 rounded-lg transition-colors text-gray-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
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
