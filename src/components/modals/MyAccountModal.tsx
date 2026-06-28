import { useState } from "react";
import { X, User, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { updateOwnProfile } from "../../lib/tauri";
import { useAuthStore, useUiStore } from "../../store";

export default function MyAccountModal() {
  const { closeModal } = useUiStore();
  const { user, setUser } = useAuthStore();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newUsername, setNewUsername] = useState(user?.username ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const passwordsMatch = newPassword === "" || newPassword === confirmPassword;
  const hasChanges =
    newUsername.trim() !== user?.username ||
    newPassword.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentPassword) {
      setError("Current password is required to save changes.");
      return;
    }
    if (newPassword && newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    if (!hasChanges) {
      setError("No changes to save.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await updateOwnProfile({
        current_password: currentPassword,
        new_username: newUsername.trim() !== user?.username ? newUsername.trim() : undefined,
        new_password: newPassword || undefined,
      });
      setUser({ id: result.id, username: result.username, role: result.role as import("../../types").Role });
      setSuccess(true);
      setTimeout(() => {
        closeModal();
      }, 1200);
    } catch (err: unknown) {
      setError((err as { message?: string })?.message ?? "Failed to update account");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={closeModal}>
      <div
        className="w-[420px] bg-surface-800 rounded-xl border border-surface-600 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-600">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-gray-100">My account</h2>
          </div>
          <button onClick={closeModal} className="text-muted hover:text-gray-200 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Role info (read-only) */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-700 border border-surface-600 text-xs">
            <ShieldCheck className="w-3.5 h-3.5 text-accent flex-shrink-0" />
            <span className="text-muted">Role: </span>
            <span className="text-gray-200 font-medium">{user?.role}</span>
            <span className="text-muted ml-auto text-[11px]">Contact an Admin to change role</span>
          </div>

          {/* Username */}
          <div>
            <label className="block text-xs text-muted mb-1.5">Username</label>
            <input
              autoFocus
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-accent"
            />
          </div>

          <div className="border-t border-surface-600 pt-3">
            <p className="text-[11px] text-muted mb-3">Leave new password blank to keep your current password.</p>

            {/* New password */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-muted mb-1.5">New password</label>
                <div className="relative">
                  <input
                    type={showNew ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 pr-9 text-sm text-gray-100 focus:outline-none focus:border-accent font-mono"
                    placeholder="(optional)"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-gray-300"
                  >
                    {showNew ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {newPassword && (
                <div>
                  <label className="block text-xs text-muted mb-1.5">Confirm new password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    className={`w-full bg-surface-700 border rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none font-mono transition-colors ${
                      confirmPassword && !passwordsMatch
                        ? "border-red-600 focus:border-red-500"
                        : "border-surface-600 focus:border-accent"
                    }`}
                    placeholder="Re-enter new password"
                  />
                  {confirmPassword && !passwordsMatch && (
                    <p className="text-[11px] text-red-400 mt-1">Passwords do not match</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Current password (always required) */}
          <div className="border-t border-surface-600 pt-3">
            <label className="block text-xs text-muted mb-1.5">
              Current password <span className="text-red-400">*</span>
              <span className="ml-1 text-muted font-normal">(required to save any change)</span>
            </label>
            <div className="relative">
              <input
                type={showCurrent ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 pr-9 text-sm text-gray-100 focus:outline-none focus:border-accent font-mono"
                placeholder="Enter your current password"
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-gray-300"
              >
                {showCurrent ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {success && (
            <p className="text-xs text-green-400 bg-green-900/20 border border-green-900/40 rounded-lg px-3 py-2">
              Account updated successfully.
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
              disabled={loading || !currentPassword || !passwordsMatch || success}
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
