import { useEffect, useRef, useState } from "react";
import { Shield, Eye, EyeOff, LogIn, KeyRound, ArrowLeft, CheckCircle } from "lucide-react";
import { login } from "../../lib/tauri";
import { verifyOsAndResetPassword } from "../../lib/tauri";
import { useAuthStore } from "../../store";

const LETTERS = "WARDEN".split("");

type Mode = "login" | "forgot-os" | "forgot-new";

export default function LoginModal() {
  const { setUser } = useAuthStore();

  // Login state
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Forgot password state
  const [mode, setMode] = useState<Mode>("login");
  const [osUsername, setOsUsername] = useState("");
  const [osPassword, setOsPassword] = useState("");
  const [showOsPass, setShowOsPass] = useState(false);
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");
  const [showNewPass, setShowNewPass] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  // Clock
  const [time, setTime] = useState(new Date());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => setTime(new Date()), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) return;
    setError(null);
    setLoading(true);
    try {
      const res = await login(username, password);
      setUser(res.user);
    } catch (err: unknown) {
      setError((err as { message?: string })?.message ?? "Invalid credentials");
    } finally {
      setLoading(false);
    }
  }

  async function handleOsVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!osUsername || !osPassword || !username) return;
    setForgotError(null);
    setForgotLoading(true);
    try {
      // Just advance to next step — actual verification happens on final submit
      setMode("forgot-new");
    } finally {
      setForgotLoading(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (newPass !== newPass2) { setForgotError("Passwords do not match"); return; }
    if (newPass.length < 6) { setForgotError("Password must be at least 6 characters"); return; }
    setForgotError(null);
    setForgotLoading(true);
    try {
      await verifyOsAndResetPassword(osUsername, osPassword, username, newPass);
      setResetDone(true);
    } catch (err: unknown) {
      setForgotError((err as { message?: string })?.message ?? "Reset failed. Check your Windows credentials.");
    } finally {
      setForgotLoading(false);
    }
  }

  function goBack() {
    setMode("login");
    setForgotError(null);
    setResetDone(false);
    setOsUsername("");
    setOsPassword("");
    setNewPass("");
    setNewPass2("");
  }

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-surface-900 relative overflow-hidden select-none">

      {/* Animated grid background */}
      <div
        className="absolute inset-0 grid-bg-anim pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgb(var(--accent) / 1) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--accent) / 1) 1px, transparent 1px)`,
          backgroundSize: "52px 52px",
        }}
      />

      {/* Scanning sweep line */}
      <div className="scan-line-anim" />

      {/* Deep glow orbs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full bg-accent/5 blur-[100px]" />
        <div className="absolute bottom-1/4 left-1/3 w-64 h-64 rounded-full bg-accent/3 blur-[80px] animate-pulse" style={{ animationDuration: "4s" }} />
        <div className="absolute top-1/2 right-1/4 w-48 h-48 rounded-full bg-accent/4 blur-[60px] animate-pulse" style={{ animationDuration: "6s", animationDelay: "2s" }} />
      </div>

      {/* Main content */}
      <div className="relative z-10 w-96 flex flex-col items-center gap-8">

        {/* Logo + WARDEN letters */}
        <div className="text-center flex flex-col items-center gap-4">
          {/* Pulsing shield */}
          <div className="relative flex items-center justify-center">
            <div className="pulse-ring-1 absolute w-14 h-14 rounded-2xl border border-accent/40" />
            <div className="pulse-ring-2 absolute w-14 h-14 rounded-2xl border border-accent/25" />
            <div className="pulse-ring-3 absolute w-14 h-14 rounded-2xl border border-accent/15" />
            <div className="relative w-14 h-14 rounded-2xl bg-surface-800/80 border border-accent/30 backdrop-blur-sm flex items-center justify-center shadow-lg shadow-accent/10">
              <Shield className="w-7 h-7 text-accent" />
            </div>
          </div>

          {/* Animated WARDEN letters */}
          <div className="flex items-center gap-[3px]">
            {LETTERS.map((letter, i) => (
              <span
                key={i}
                className="warden-letter text-4xl font-bold text-gray-100 tracking-[0.15em]"
                style={{ animationDelay: `${i * 0.07}s` }}
              >
                {letter}
              </span>
            ))}
          </div>
          <p className="text-[10px] tracking-[0.3em] text-muted uppercase font-medium">
            IT Administration Console
          </p>
        </div>

        {/* Login / Forgot card */}
        <div className="login-card-anim w-full">
          <div className="bg-surface-800/70 backdrop-blur-xl border border-surface-600/60 rounded-2xl shadow-2xl shadow-black/40 overflow-hidden">

            {/* Top accent line */}
            <div className="h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent" />

            <div className="p-6">
              {mode === "login" && (
                <>
                  <h2 className="text-sm font-semibold text-gray-200 mb-5">Sign in to continue</h2>

                  <form onSubmit={handleLogin} className="space-y-3.5">
                    <div>
                      <label className="block text-[11px] text-muted mb-1.5 uppercase tracking-wider">Username</label>
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        autoFocus
                        autoComplete="username"
                        className="w-full bg-surface-700/80 border border-surface-600 rounded-lg px-3 py-2.5 text-sm text-gray-100 focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 placeholder-muted/50 transition-all"
                        placeholder="Enter username"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] text-muted mb-1.5 uppercase tracking-wider">Password</label>
                      <div className="relative">
                        <input
                          type={showPass ? "text" : "password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          autoComplete="current-password"
                          className="w-full bg-surface-700/80 border border-surface-600 rounded-lg px-3 py-2.5 pr-10 text-sm text-gray-100 focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 transition-all"
                          placeholder="Enter password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPass((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-gray-300 transition-colors"
                        >
                          {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {error && (
                      <div className="flex items-center gap-2 text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg px-3 py-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                        {error}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={loading || !username || !password}
                      className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm py-2.5 rounded-lg transition-colors font-medium mt-1 shadow-lg shadow-accent/20"
                    >
                      {loading ? (
                        <>
                          <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Authenticating…
                        </>
                      ) : (
                        <>
                          <LogIn className="w-3.5 h-3.5" />
                          Sign in
                        </>
                      )}
                    </button>
                  </form>

                  <div className="mt-4 text-center">
                    <button
                      onClick={() => { setMode("forgot-os"); setForgotError(null); }}
                      className="text-[11px] text-muted hover:text-accent transition-colors"
                    >
                      Forgot password?
                    </button>
                  </div>
                </>
              )}

              {mode === "forgot-os" && (
                <>
                  <div className="flex items-center gap-2 mb-5">
                    <button onClick={goBack} className="text-muted hover:text-gray-300 transition-colors">
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <div>
                      <h2 className="text-sm font-semibold text-gray-200">Verify Windows identity</h2>
                      <p className="text-[11px] text-muted mt-0.5">Enter your OS credentials to reset WARDEN password</p>
                    </div>
                  </div>

                  <form onSubmit={handleOsVerify} className="space-y-3.5">
                    <div>
                      <label className="block text-[11px] text-muted mb-1.5 uppercase tracking-wider">WARDEN username to reset</label>
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        autoFocus
                        className="w-full bg-surface-700/80 border border-surface-600 rounded-lg px-3 py-2.5 text-sm text-gray-100 focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 transition-all"
                        placeholder="Your WARDEN admin username"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-muted mb-1.5 uppercase tracking-wider">Windows OS username</label>
                      <input
                        type="text"
                        value={osUsername}
                        onChange={(e) => setOsUsername(e.target.value)}
                        className="w-full bg-surface-700/80 border border-surface-600 rounded-lg px-3 py-2.5 text-sm text-gray-100 focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 transition-all"
                        placeholder="Windows login username"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-muted mb-1.5 uppercase tracking-wider">Windows OS password</label>
                      <div className="relative">
                        <input
                          type={showOsPass ? "text" : "password"}
                          value={osPassword}
                          onChange={(e) => setOsPassword(e.target.value)}
                          className="w-full bg-surface-700/80 border border-surface-600 rounded-lg px-3 py-2.5 pr-10 text-sm text-gray-100 focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 transition-all"
                          placeholder="Windows login password"
                        />
                        <button type="button" onClick={() => setShowOsPass(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-gray-300 transition-colors">
                          {showOsPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {forgotError && (
                      <div className="flex items-center gap-2 text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg px-3 py-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                        {forgotError}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={forgotLoading || !osUsername || !osPassword || !username}
                      className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm py-2.5 rounded-lg transition-colors font-medium shadow-lg shadow-accent/20"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      Verify & Continue
                    </button>
                  </form>
                </>
              )}

              {mode === "forgot-new" && !resetDone && (
                <>
                  <div className="flex items-center gap-2 mb-5">
                    <button onClick={() => setMode("forgot-os")} className="text-muted hover:text-gray-300 transition-colors">
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <div>
                      <h2 className="text-sm font-semibold text-gray-200">Set new password</h2>
                      <p className="text-[11px] text-muted mt-0.5">Choose a new WARDEN password</p>
                    </div>
                  </div>

                  <form onSubmit={handleReset} className="space-y-3.5">
                    <div>
                      <label className="block text-[11px] text-muted mb-1.5 uppercase tracking-wider">New password</label>
                      <div className="relative">
                        <input
                          type={showNewPass ? "text" : "password"}
                          value={newPass}
                          onChange={(e) => setNewPass(e.target.value)}
                          autoFocus
                          className="w-full bg-surface-700/80 border border-surface-600 rounded-lg px-3 py-2.5 pr-10 text-sm text-gray-100 focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 transition-all"
                          placeholder="At least 6 characters"
                        />
                        <button type="button" onClick={() => setShowNewPass(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-gray-300 transition-colors">
                          {showNewPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] text-muted mb-1.5 uppercase tracking-wider">Confirm new password</label>
                      <input
                        type="password"
                        value={newPass2}
                        onChange={(e) => setNewPass2(e.target.value)}
                        className="w-full bg-surface-700/80 border border-surface-600 rounded-lg px-3 py-2.5 text-sm text-gray-100 focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 transition-all"
                        placeholder="Repeat new password"
                      />
                    </div>

                    {forgotError && (
                      <div className="flex items-center gap-2 text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg px-3 py-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                        {forgotError}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={forgotLoading || !newPass || !newPass2}
                      className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm py-2.5 rounded-lg transition-colors font-medium shadow-lg shadow-accent/20"
                    >
                      {forgotLoading ? (
                        <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Resetting…</>
                      ) : (
                        <><KeyRound className="w-3.5 h-3.5" />Reset Password</>
                      )}
                    </button>
                  </form>
                </>
              )}

              {resetDone && (
                <div className="text-center py-4 space-y-3">
                  <div className="flex justify-center">
                    <CheckCircle className="w-12 h-12 text-success" />
                  </div>
                  <p className="text-sm font-semibold text-gray-200">Password reset successfully</p>
                  <p className="text-xs text-muted">You can now sign in with your new password.</p>
                  <button
                    onClick={goBack}
                    className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white text-sm py-2.5 rounded-lg transition-colors font-medium mt-2"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    Back to Sign in
                  </button>
                </div>
              )}
            </div>

            {/* Bottom accent line */}
            <div className="h-px bg-gradient-to-r from-transparent via-surface-600/60 to-transparent" />
          </div>
        </div>

        {/* Status bar */}
        <div className="login-card-anim w-full flex items-center justify-between text-[10px] text-muted/60 px-1" style={{ animationDelay: "0.7s" }}>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-success status-dot-blink" />
            SYSTEM ONLINE
          </div>
          <span className="font-mono tracking-wider">v0.1.0</span>
          <span className="font-mono tabular-nums">
            {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        </div>
      </div>
    </div>
  );
}
