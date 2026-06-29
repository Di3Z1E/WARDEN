import { useEffect, useState } from "react";
import { X, User, Eye, EyeOff, ShieldCheck, Smartphone, CheckCircle, AlertTriangle } from "lucide-react";
import { updateOwnProfile, getMfaStatus, mfaProvision, mfaVerifyAndEnable, mfaDisable } from "../../lib/tauri";
import { useAuthStore, useUiStore } from "../../store";
import type { MfaStatus } from "../../types";

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

  // MFA state
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [mfaSection, setMfaSection] = useState<"idle" | "provisioning" | "disabling">("idle");
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaDisablePass, setMfaDisablePass] = useState("");
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaDone, setMfaDone] = useState<"enabled" | "disabled" | null>(null);

  const passwordsMatch = newPassword === "" || newPassword === confirmPassword;
  const hasChanges =
    newUsername.trim() !== user?.username ||
    newPassword.length > 0;

  useEffect(() => {
    getMfaStatus().then(setMfaStatus).catch(() => {});
  }, []);

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
      setUser({
        id: result.id,
        username: result.username,
        role: result.role as import("../../types").Role,
        mfa_enabled: user?.mfa_enabled ?? false,
      });
      setSuccess(true);
      setTimeout(() => { closeModal(); }, 1200);
    } catch (err: unknown) {
      setError((err as { message?: string })?.message ?? "Failed to update account");
    } finally {
      setLoading(false);
    }
  }

  async function handleProvision() {
    setMfaError(null);
    setMfaLoading(true);
    try {
      const result = await mfaProvision();
      setQrBase64(result.qr_png_base64);
      setOtpauthUrl(result.otpauth_url);
      setMfaSection("provisioning");
      setMfaCode("");
    } catch (err: unknown) {
      setMfaError((err as { message?: string })?.message ?? "Failed to generate QR code");
    } finally {
      setMfaLoading(false);
    }
  }

  async function handleVerifyEnable(e: React.FormEvent) {
    e.preventDefault();
    if (mfaCode.length !== 6) return;
    setMfaError(null);
    setMfaLoading(true);
    try {
      await mfaVerifyAndEnable(mfaCode);
      setMfaStatus({ enabled: true, provisioned: true });
      setMfaDone("enabled");
      setMfaSection("idle");
      setQrBase64(null);
      if (user) setUser({ ...user, mfa_enabled: true });
    } catch (err: unknown) {
      setMfaError((err as { message?: string })?.message ?? "Invalid code");
      setMfaCode("");
    } finally {
      setMfaLoading(false);
    }
  }

  async function handleDisable(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaDisablePass) return;
    setMfaError(null);
    setMfaLoading(true);
    try {
      await mfaDisable(mfaDisablePass);
      setMfaStatus({ enabled: false, provisioned: false });
      setMfaDone("disabled");
      setMfaSection("idle");
      setMfaDisablePass("");
      if (user) setUser({ ...user, mfa_enabled: false });
    } catch (err: unknown) {
      setMfaError((err as { message?: string })?.message ?? "Failed to disable 2FA");
    } finally {
      setMfaLoading(false);
    }
  }

  function handleMfaCodeChange(val: string) {
    setMfaCode(val.replace(/\D/g, "").slice(0, 6));
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={closeModal}>
      <div
        className="w-[460px] max-h-[90vh] overflow-y-auto bg-surface-800 rounded-xl border border-surface-600 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-600 sticky top-0 bg-surface-800 z-10">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-gray-100">My account</h2>
          </div>
          <button onClick={closeModal} className="text-muted hover:text-gray-200 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Role info */}
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

          {/* Current password */}
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

        {/* ── 2FA Section ─────────────────────────────────────────────────────── */}
        <div className="border-t border-surface-600 px-5 py-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Smartphone className="w-3.5 h-3.5 text-accent" />
            <span className="text-xs font-semibold text-gray-200">Two-factor authentication (TOTP)</span>
            {mfaStatus?.enabled && (
              <span className="ml-auto flex items-center gap-1 text-[10px] text-green-400 bg-green-900/20 border border-green-800/40 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                Enabled
              </span>
            )}
          </div>

          {mfaDone === "enabled" && (
            <div className="flex items-center gap-2 text-xs text-green-400 bg-green-900/20 border border-green-800/40 rounded-lg px-3 py-2">
              <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
              2FA enabled successfully. Your account is now more secure.
            </div>
          )}

          {mfaDone === "disabled" && (
            <div className="flex items-center gap-2 text-xs text-yellow-400 bg-yellow-900/20 border border-yellow-800/40 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              2FA has been disabled.
            </div>
          )}

          {mfaError && (
            <p className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg px-3 py-2">
              {mfaError}
            </p>
          )}

          {/* Idle state — show setup or disable button */}
          {mfaSection === "idle" && (
            <>
              {!mfaStatus?.enabled ? (
                <div className="space-y-2">
                  <p className="text-[11px] text-muted">
                    Add an extra layer of security. Use any TOTP authenticator app (Google Authenticator, Authy, etc.).
                  </p>
                  <button
                    type="button"
                    onClick={handleProvision}
                    disabled={mfaLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/40 text-accent text-xs hover:bg-accent/20 disabled:opacity-40 transition-colors"
                  >
                    {mfaLoading ? (
                      <span className="w-3 h-3 border border-accent/40 border-t-accent rounded-full animate-spin" />
                    ) : (
                      <Smartphone className="w-3.5 h-3.5" />
                    )}
                    Set up 2FA
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[11px] text-muted">
                    2FA is currently enabled. Disabling requires your current password.
                  </p>
                  <button
                    type="button"
                    onClick={() => { setMfaSection("disabling"); setMfaError(null); setMfaDone(null); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-900/20 border border-red-800/40 text-red-400 text-xs hover:bg-red-900/30 transition-colors"
                  >
                    Disable 2FA
                  </button>
                </div>
              )}
            </>
          )}

          {/* Provisioning: show QR + verify form */}
          {mfaSection === "provisioning" && qrBase64 && (
            <div className="space-y-3">
              <p className="text-[11px] text-muted">
                Scan the QR code with your authenticator app, then enter the 6-digit code to confirm.
              </p>

              <div className="flex justify-center">
                <div className="p-2 bg-white rounded-lg">
                  <img
                    src={`data:image/png;base64,${qrBase64}`}
                    alt="TOTP QR code"
                    className="w-40 h-40"
                  />
                </div>
              </div>

              {otpauthUrl && (
                <details className="text-[10px] text-muted">
                  <summary className="cursor-pointer hover:text-gray-300 transition-colors">Can't scan? Click for manual entry key</summary>
                  <p className="mt-1 font-mono break-all text-gray-400 select-all bg-surface-900 rounded p-2 border border-surface-700">
                    {new URL(otpauthUrl).searchParams.get("secret") ?? otpauthUrl}
                  </p>
                </details>
              )}

              <form onSubmit={handleVerifyEnable} className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={mfaCode}
                  onChange={(e) => handleMfaCodeChange(e.target.value)}
                  placeholder="000000"
                  maxLength={6}
                  autoFocus
                  className="flex-1 text-center font-mono tracking-widest bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-accent"
                />
                <button
                  type="submit"
                  disabled={mfaLoading || mfaCode.length !== 6}
                  className="px-4 py-2 rounded-lg bg-accent hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-medium transition-colors"
                >
                  {mfaLoading ? "Enabling…" : "Enable"}
                </button>
                <button
                  type="button"
                  onClick={() => { setMfaSection("idle"); setQrBase64(null); setMfaError(null); }}
                  className="px-3 py-2 rounded-lg border border-surface-600 hover:bg-surface-700 text-gray-400 text-xs transition-colors"
                >
                  Cancel
                </button>
              </form>
            </div>
          )}

          {/* Disabling: confirm with password */}
          {mfaSection === "disabling" && (
            <form onSubmit={handleDisable} className="space-y-3">
              <p className="text-[11px] text-muted">Enter your current WARDEN password to disable 2FA.</p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={mfaDisablePass}
                  onChange={(e) => setMfaDisablePass(e.target.value)}
                  placeholder="Current password"
                  autoFocus
                  className="flex-1 bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-accent font-mono"
                />
                <button
                  type="submit"
                  disabled={mfaLoading || !mfaDisablePass}
                  className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white text-xs font-medium transition-colors"
                >
                  {mfaLoading ? "Disabling…" : "Disable"}
                </button>
                <button
                  type="button"
                  onClick={() => { setMfaSection("idle"); setMfaError(null); }}
                  className="px-3 py-2 rounded-lg border border-surface-600 hover:bg-surface-700 text-gray-400 text-xs transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
