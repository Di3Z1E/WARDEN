import { useState } from "react";
import { X, Eye, EyeOff, Key, ShieldCheck } from "lucide-react";
import { createCredentialSet } from "../../lib/tauri";
import { useUiStore } from "../../store";

interface Props { onCreated?: () => void; }

export default function AddCredentialModal({ onCreated }: Props) {
  const { closeModal } = useUiStore();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const strength = password.length === 0 ? 0
    : password.length < 8 ? 1
    : password.length < 12 ? 2
    : password.length < 20 ? 3
    : 4;

  const strengthLabels = ["", "Weak", "Fair", "Good", "Strong"];
  const strengthColors = ["", "bg-red-500", "bg-yellow-500", "bg-blue-500", "bg-green-500"];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !username.trim() || !password) return;
    setError(null);
    setLoading(true);
    try {
      await createCredentialSet({ name: name.trim(), username: username.trim(), password });
      onCreated?.();
      closeModal();
    } catch (err: unknown) {
      setError((err as { message?: string })?.message ?? "Failed to save credential");
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
            <Key className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-gray-100">Add credential</h2>
          </div>
          <button onClick={closeModal} className="text-muted hover:text-gray-200 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-muted mb-1.5">Label *</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-accent placeholder-muted"
              placeholder="prod-linux-root, dev-admin…"
            />
          </div>

          <div>
            <label className="block text-xs text-muted mb-1.5">Username *</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-accent font-mono placeholder-muted"
              placeholder="root, administrator…"
            />
          </div>

          <div>
            <label className="block text-xs text-muted mb-1.5">Password *</label>
            <div className="relative">
              <input
                type={showPass ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 pr-9 text-sm text-gray-100 focus:outline-none focus:border-accent font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-gray-300 transition-colors"
              >
                {showPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* Password strength */}
            {password && (
              <div className="mt-2 space-y-1">
                <div className="flex gap-1">
                  {[1, 2, 3, 4].map((n) => (
                    <div
                      key={n}
                      className={`h-1 flex-1 rounded-full transition-colors ${n <= strength ? strengthColors[strength] : "bg-surface-600"}`}
                    />
                  ))}
                </div>
                <p className="text-[11px] text-muted">{strengthLabels[strength]}</p>
              </div>
            )}
          </div>

          {/* Security notice */}
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-green-900/10 border border-green-900/30 text-xs text-green-400/80">
            <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-green-400" />
            <span>Stored in <b>Windows Credential Manager</b> — never written to disk in plaintext. Credentials are encrypted by your OS.</span>
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
              disabled={loading || !name.trim() || !username.trim() || !password}
              className="flex-1 bg-accent hover:bg-blue-500 disabled:opacity-50 text-white text-sm py-2 rounded-lg transition-colors font-medium"
            >
              {loading ? "Saving…" : "Save credential"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
