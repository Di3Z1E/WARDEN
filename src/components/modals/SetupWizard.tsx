import { useState } from "react";
import { Shield, CheckCircle } from "lucide-react";
import { setupAdmin, login } from "../../lib/tauri";
import { useAuthStore } from "../../store";

type Step = "welcome" | "create-admin" | "done";

export default function SetupWizard() {
  const { setUser, setFirstRun } = useAuthStore();
  const [step, setStep] = useState<Step>("welcome");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleCreateAdmin(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 10) {
      setError("Password must be at least 10 characters");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await setupAdmin(username, password);
      setStep("done");
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e?.message ?? "Setup failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleFinish() {
    setLoading(true);
    try {
      const res = await login(username, password);
      setFirstRun(false);
      setUser(res.user);
    } catch (err) {
      console.error("Auto-login after setup failed:", err);
      setFirstRun(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-surface-900">
      <div className="w-96 bg-surface-800 rounded-lg border border-surface-600 p-8 shadow-2xl">
        <div className="flex items-center justify-center gap-2 mb-6">
          <Shield className="w-6 h-6 text-accent" />
          <span className="text-xl font-bold tracking-widest text-gray-100">
            WARDEN
          </span>
        </div>

        {step === "welcome" && (
          <div className="text-center space-y-4">
            <h2 className="text-lg font-semibold text-gray-100">
              First-time setup
            </h2>
            <p className="text-sm text-muted leading-relaxed">
              Welcome to WARDEN. Let's create your administrator account to get
              started.
            </p>
            <button
              onClick={() => setStep("create-admin")}
              className="w-full bg-accent hover:bg-accent-hover text-white text-sm py-2 rounded transition-colors font-medium"
            >
              Get started
            </button>
          </div>
        )}

        {step === "create-admin" && (
          <form onSubmit={handleCreateAdmin} className="space-y-4">
            <h2 className="text-base font-semibold text-gray-100 mb-4">
              Create admin account
            </h2>

            <div>
              <label className="block text-xs text-muted mb-1.5">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-surface-700 border border-surface-600 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-accent"
              />
            </div>

            <div>
              <label className="block text-xs text-muted mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full bg-surface-700 border border-surface-600 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-accent"
                placeholder="At least 10 characters"
              />
            </div>

            <div>
              <label className="block text-xs text-muted mb-1.5">
                Confirm password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                className="w-full bg-surface-700 border border-surface-600 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-accent"
              />
            </div>

            {error && (
              <p className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password || !confirm}
              className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm py-2 rounded transition-colors font-medium"
            >
              {loading ? "Creating account…" : "Create admin account"}
            </button>
          </form>
        )}

        {step === "done" && (
          <div className="text-center space-y-4">
            <CheckCircle className="w-12 h-12 text-success mx-auto" />
            <h2 className="text-lg font-semibold text-gray-100">
              Setup complete
            </h2>
            <p className="text-sm text-muted">
              Your admin account has been created. All secrets are stored in
              Windows Credential Manager.
            </p>
            <button
              onClick={handleFinish}
              disabled={loading}
              className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm py-2 rounded transition-colors font-medium"
            >
              {loading ? "Loading…" : "Enter WARDEN"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
