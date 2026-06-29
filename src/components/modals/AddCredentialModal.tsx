import { useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Clipboard,
  Eye,
  EyeOff,
  Key,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import {
  createCredentialSet,
  generateSshKey,
  uploadSshKey,
} from "../../lib/tauri";
import { useUiStore } from "../../store";

type Tab = "password" | "upload" | "generate";

interface Props { onCreated?: () => void; }

export default function AddCredentialModal({ onCreated }: Props) {
  const { closeModal } = useUiStore();
  const [tab, setTab] = useState<Tab>("password");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ── Password fields ──────────────────────────────────────────────────────────
  const [pwName, setPwName] = useState("");
  const [pwUsername, setPwUsername] = useState("");
  const [pwPassword, setPwPassword] = useState("");
  const [showPass, setShowPass] = useState(false);

  const strength = pwPassword.length === 0 ? 0
    : pwPassword.length < 8 ? 1
    : pwPassword.length < 12 ? 2
    : pwPassword.length < 20 ? 3
    : 4;
  const strengthLabels = ["", "Weak", "Fair", "Good", "Strong"];
  const strengthColors = ["", "bg-red-500", "bg-yellow-500", "bg-blue-500", "bg-green-500"];

  // ── Upload fields ────────────────────────────────────────────────────────────
  const [upName, setUpName] = useState("");
  const [upUsername, setUpUsername] = useState("");
  const [upPem, setUpPem] = useState("");
  const [upPassphrase, setUpPassphrase] = useState("");
  const [showUpPass, setShowUpPass] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Generate fields / result ─────────────────────────────────────────────────
  const [genName, setGenName] = useState("");
  const [genUsername, setGenUsername] = useState("");
  const [genPublicKey, setGenPublicKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  function reset() {
    setError(null);
    setLoading(false);
    setGenPublicKey(null);
    setCopied(false);
  }

  function handleTabChange(t: Tab) {
    setTab(t);
    reset();
  }

  // ── Handlers ─────────────────────────────────────────────────────────────────

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!pwName.trim() || !pwUsername.trim() || !pwPassword) return;
    setError(null);
    setLoading(true);
    try {
      await createCredentialSet({ name: pwName.trim(), username: pwUsername.trim(), password: pwPassword });
      onCreated?.();
      closeModal();
    } catch (err: unknown) {
      setError((err as { message?: string })?.message ?? "Failed to save credential");
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!upName.trim() || !upUsername.trim() || !upPem.trim()) return;
    setError(null);
    setLoading(true);
    try {
      await uploadSshKey({
        name: upName.trim(),
        username: upUsername.trim(),
        private_key_pem: upPem.trim(),
        passphrase: upPassphrase || null,
      });
      onCreated?.();
      closeModal();
    } catch (err: unknown) {
      setError((err as { message?: string })?.message ?? "Failed to save key");
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!genName.trim() || !genUsername.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const result = await generateSshKey({ name: genName.trim(), username: genUsername.trim() });
      setGenPublicKey(result.public_key);
      onCreated?.();
    } catch (err: unknown) {
      setError((err as { message?: string })?.message ?? "Key generation failed");
    } finally {
      setLoading(false);
    }
  }

  async function copyPublicKey() {
    if (!genPublicKey) return;
    await navigator.clipboard.writeText(genPublicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleFileRead(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setUpPem((ev.target?.result as string) ?? "");
    reader.readAsText(file);
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "password", label: "Password", icon: <Key className="w-3.5 h-3.5" /> },
    { id: "upload",   label: "SSH Key (upload)",   icon: <Upload className="w-3.5 h-3.5" /> },
    { id: "generate", label: "SSH Key (generate)", icon: <Sparkles className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={closeModal}>
      <div
        className="w-[460px] bg-surface-800 rounded-xl border border-surface-600 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-600">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-gray-100">Add credential</h2>
          </div>
          <button onClick={closeModal} className="text-muted hover:text-gray-200 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-surface-600">
          {tabs.map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => handleTabChange(id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
                tab === id
                  ? "border-accent text-accent"
                  : "border-transparent text-muted hover:text-gray-300"
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        {/* ── Password tab ─────────────────────────────────────────────────────── */}
        {tab === "password" && (
          <form onSubmit={handlePassword} className="p-5 space-y-4">
            <Field label="Label *">
              <input
                autoFocus
                value={pwName}
                onChange={(e) => setPwName(e.target.value)}
                className={inputCls}
                placeholder="prod-linux-root, dev-admin…"
              />
            </Field>

            <Field label="Username *">
              <input
                value={pwUsername}
                onChange={(e) => setPwUsername(e.target.value)}
                autoComplete="username"
                className={`${inputCls} font-mono`}
                placeholder="root, administrator…"
              />
            </Field>

            <Field label="Password *">
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  value={pwPassword}
                  onChange={(e) => setPwPassword(e.target.value)}
                  autoComplete="new-password"
                  className={`${inputCls} font-mono pr-9`}
                />
                <ToggleEye show={showPass} onToggle={() => setShowPass((v) => !v)} />
              </div>
              {pwPassword && (
                <div className="mt-2 space-y-1">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map((n) => (
                      <div key={n} className={`h-1 flex-1 rounded-full transition-colors ${n <= strength ? strengthColors[strength] : "bg-surface-600"}`} />
                    ))}
                  </div>
                  <p className="text-[11px] text-muted">{strengthLabels[strength]}</p>
                </div>
              )}
            </Field>

            <SecurityNotice />
            <ErrorBox msg={error} />

            <FormButtons
              onCancel={closeModal}
              disabled={loading || !pwName.trim() || !pwUsername.trim() || !pwPassword}
              loading={loading}
              label="Save credential"
            />
          </form>
        )}

        {/* ── Upload tab ──────────────────────────────────────────────────────── */}
        {tab === "upload" && (
          <form onSubmit={handleUpload} className="p-5 space-y-4">
            <Field label="Label *">
              <input
                autoFocus
                value={upName}
                onChange={(e) => setUpName(e.target.value)}
                className={inputCls}
                placeholder="prod-linux-key"
              />
            </Field>

            <Field label="Username *">
              <input
                value={upUsername}
                onChange={(e) => setUpUsername(e.target.value)}
                className={`${inputCls} font-mono`}
                placeholder="root, ubuntu…"
              />
            </Field>

            <Field label="Private key (PEM) *">
              <textarea
                value={upPem}
                onChange={(e) => setUpPem(e.target.value)}
                rows={5}
                spellCheck={false}
                className={`${inputCls} font-mono text-[11px] resize-none leading-relaxed`}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;…&#10;-----END OPENSSH PRIVATE KEY-----"
              />
              <div className="mt-1.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs text-accent hover:underline flex items-center gap-1"
                >
                  <Upload className="w-3 h-3" /> Load from file
                </button>
                <input ref={fileInputRef} type="file" className="hidden" accept=".pem,.key,*" onChange={handleFileRead} />
              </div>
            </Field>

            <Field label="Passphrase (optional)">
              <div className="relative">
                <input
                  type={showUpPass ? "text" : "password"}
                  value={upPassphrase}
                  onChange={(e) => setUpPassphrase(e.target.value)}
                  className={`${inputCls} font-mono pr-9`}
                  placeholder="Leave blank if none"
                />
                <ToggleEye show={showUpPass} onToggle={() => setShowUpPass((v) => !v)} />
              </div>
            </Field>

            <SecurityNotice />
            <ErrorBox msg={error} />

            <FormButtons
              onCancel={closeModal}
              disabled={loading || !upName.trim() || !upUsername.trim() || !upPem.trim()}
              loading={loading}
              label="Save key"
            />
          </form>
        )}

        {/* ── Generate tab ────────────────────────────────────────────────────── */}
        {tab === "generate" && !genPublicKey && (
          <form onSubmit={handleGenerate} className="p-5 space-y-4">
            <Field label="Label *">
              <input
                autoFocus
                value={genName}
                onChange={(e) => setGenName(e.target.value)}
                className={inputCls}
                placeholder="prod-linux-key"
              />
            </Field>

            <Field label="Username *">
              <input
                value={genUsername}
                onChange={(e) => setGenUsername(e.target.value)}
                className={`${inputCls} font-mono`}
                placeholder="root, ubuntu…"
              />
            </Field>

            {/* Algorithm picker (currently only ed25519) */}
            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex items-center gap-1 text-xs text-muted hover:text-gray-300 transition-colors"
              >
                <ChevronDown className={`w-3 h-3 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                Advanced
              </button>
              {showAdvanced && (
                <div className="mt-2 px-3 py-2.5 rounded-lg bg-surface-700 border border-surface-600 text-xs text-muted">
                  Algorithm: <span className="text-gray-300 font-mono">Ed25519</span>
                  <span className="ml-2 text-green-400/80">(recommended)</span>
                </div>
              )}
            </div>

            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-blue-900/10 border border-blue-900/30 text-xs text-blue-300/80">
              <Sparkles className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-blue-400" />
              <span>WARDEN generates an Ed25519 key pair. The private key is stored in <b>Windows Credential Manager</b>. Copy the public key to deploy to your servers.</span>
            </div>

            <SecurityNotice />
            <ErrorBox msg={error} />

            <FormButtons
              onCancel={closeModal}
              disabled={loading || !genName.trim() || !genUsername.trim()}
              loading={loading}
              label="Generate key pair"
            />
          </form>
        )}

        {/* ── Generate success state ───────────────────────────────────────────── */}
        {tab === "generate" && genPublicKey && (
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-2 text-green-400">
              <Check className="w-4 h-4" />
              <span className="text-sm font-medium">Key pair generated &amp; saved</span>
            </div>

            <div>
              <p className="text-xs text-muted mb-1.5">Public key — add this to <code className="text-accent">~/.ssh/authorized_keys</code></p>
              <div className="relative">
                <textarea
                  readOnly
                  value={genPublicKey}
                  rows={3}
                  spellCheck={false}
                  className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-[11px] text-gray-200 font-mono resize-none leading-relaxed"
                />
                <button
                  type="button"
                  onClick={copyPublicKey}
                  className="absolute right-2 top-2 text-muted hover:text-gray-200 transition-colors"
                  title="Copy to clipboard"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Clipboard className="w-3.5 h-3.5" />}
                </button>
              </div>
              {copied && <p className="text-[11px] text-green-400 mt-1">Copied!</p>}
            </div>

            <p className="text-xs text-muted">
              You can also copy the public key any time from the <b>Credentials</b> list.
            </p>

            <button
              onClick={closeModal}
              className="w-full bg-accent hover:bg-blue-500 text-white text-sm py-2 rounded-lg transition-colors font-medium"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

const inputCls =
  "w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-accent placeholder-muted";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-muted mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function ToggleEye({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-gray-300 transition-colors"
    >
      {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
    </button>
  );
}

function SecurityNotice() {
  return (
    <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-green-900/10 border border-green-900/30 text-xs text-green-400/80">
      <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-green-400" />
      <span>Stored in <b>Windows Credential Manager</b> — never written to disk in plaintext.</span>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <p className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg px-3 py-2">
      {msg}
    </p>
  );
}

function FormButtons({
  onCancel,
  disabled,
  loading,
  label,
}: {
  onCancel: () => void;
  disabled: boolean;
  loading: boolean;
  label: string;
}) {
  return (
    <div className="flex gap-3 pt-1">
      <button
        type="button"
        onClick={onCancel}
        className="flex-1 border border-surface-600 hover:bg-surface-700 text-sm py-2 rounded-lg transition-colors text-gray-300"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={disabled}
        className="flex-1 bg-accent hover:bg-blue-500 disabled:opacity-50 text-white text-sm py-2 rounded-lg transition-colors font-medium"
      >
        {loading ? "Working…" : label}
      </button>
    </div>
  );
}
