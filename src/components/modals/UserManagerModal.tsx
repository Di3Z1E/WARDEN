import { useEffect, useState } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import { listUsers, createUser, updateUser, deleteUser } from "../../lib/tauri";
import { useUiStore, useAuthStore } from "../../store";
import type { AppUser, Role } from "../../types";
import clsx from "clsx";

const ROLES: Role[] = ["Admin", "Operator", "Auditor", "ReadOnly"];

const ROLE_COLORS: Record<Role, string> = {
  Admin: "text-red-400",
  Operator: "text-blue-400",
  Auditor: "text-purple-400",
  ReadOnly: "text-gray-400",
};

export default function UserManagerModal() {
  const { closeModal } = useUiStore();
  const { user: me } = useAuthStore();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<Role>("Operator");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    try {
      setUsers(await listUsers());
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword) return;
    setError(null);
    setCreating(true);
    try {
      await createUser(newUsername.trim(), newPassword, newRole);
      setNewUsername("");
      setNewPassword("");
      setShowCreate(false);
      await refresh();
    } catch (err: unknown) {
      setError((err as { message?: string })?.message ?? "Failed to create user");
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleStatus(u: AppUser) {
    const status = u.status === "active" ? "disabled" : "active";
    try {
      await updateUser({ id: u.id, status });
      await refresh();
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDelete(u: AppUser) {
    if (!confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
    try {
      await deleteUser(u.id);
      await refresh();
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="w-[560px] max-h-[80vh] bg-surface-800 rounded-lg border border-surface-600 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-600 flex-shrink-0">
          <h2 className="text-sm font-semibold text-gray-100">User manager</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setShowCreate((v) => !v)}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 bg-accent hover:bg-accent-hover rounded text-white transition-colors"
            >
              <Plus className="w-3 h-3" />
              New user
            </button>
            <button onClick={closeModal} className="text-muted hover:text-gray-200">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Create form */}
        {showCreate && (
          <form
            onSubmit={handleCreate}
            className="px-5 py-4 border-b border-surface-600 bg-surface-700 flex-shrink-0 space-y-3"
          >
            <div className="grid grid-cols-3 gap-3">
              <input
                autoFocus
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="Username"
                className="bg-surface-600 border border-surface-500 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-accent"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Password (≥10 chars)"
                className="bg-surface-600 border border-surface-500 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-accent"
              />
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as Role)}
                className="bg-surface-600 border border-surface-500 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-accent"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            {error && (
              <p className="text-xs text-red-400">{error}</p>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={creating || !newUsername.trim() || newPassword.length < 10}
                className="text-xs px-3 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded transition-colors"
              >
                {creating ? "Creating…" : "Create"}
              </button>
              <button
                type="button"
                onClick={() => { setShowCreate(false); setError(null); }}
                className="text-xs px-3 py-1.5 border border-surface-500 hover:bg-surface-600 rounded text-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* User list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="text-center text-muted text-sm py-8">Loading…</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted border-b border-surface-600">
                  <th className="text-left px-5 py-2.5">Username</th>
                  <th className="text-left px-3 py-2.5">Role</th>
                  <th className="text-left px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-surface-700 hover:bg-surface-700/50 transition-colors"
                  >
                    <td className="px-5 py-2.5 text-gray-200">
                      {u.username}
                      {u.id === me?.id && (
                        <span className="ml-2 text-xs text-accent">(you)</span>
                      )}
                    </td>
                    <td className={clsx("px-3 py-2.5 text-xs font-medium", ROLE_COLORS[u.role])}>
                      {u.role}
                    </td>
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => u.id !== me?.id && handleToggleStatus(u)}
                        disabled={u.id === me?.id}
                        className={clsx(
                          "text-xs px-2 py-0.5 rounded",
                          u.status === "active"
                            ? "bg-success/20 text-green-400"
                            : "bg-red-900/20 text-red-400",
                          u.id === me?.id ? "cursor-default" : "cursor-pointer hover:opacity-80"
                        )}
                      >
                        {u.status}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {u.id !== me?.id && (
                        <button
                          onClick={() => handleDelete(u)}
                          className="p-1 text-muted hover:text-red-400 transition-colors"
                          title="Delete user"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
