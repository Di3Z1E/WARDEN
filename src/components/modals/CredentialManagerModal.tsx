import { useEffect, useState } from "react";
import {
  Check,
  Clipboard,
  Key,
  KeyRound,
  Loader2,
  Plus,
  Send,
  Shield,
  Trash2,
  X,
} from "lucide-react";
import {
  deleteCredentialSet,
  deployPublicKey,
  getPublicKey,
  listCredentialSets,
  listMachines,
} from "../../lib/tauri";
import { useUiStore } from "../../store";
import type { CredentialSet, Machine } from "../../types";
import AddCredentialModal from "./AddCredentialModal";

export default function CredentialManagerModal() {
  const { closeModal } = useUiStore();
  const [creds, setCreds] = useState<CredentialSet[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  // Per-row state
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deployingId, setDeployingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Deploy dialog state
  const [deployTarget, setDeployTarget] = useState<string>("");
  const [deployAuth, setDeployAuth] = useState<string>("");
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deployBusy, setDeployBusy] = useState(false);
  const [deployDone, setDeployDone] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([listCredentialSets(), listMachines()])
      .then(([c, m]) => { setCreds(c); setMachines(m); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function copyPublicKey(cred: CredentialSet) {
    try {
      const pk = await getPublicKey(cred.id);
      await navigator.clipboard.writeText(pk);
      setCopiedId(cred.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err: unknown) {
      alert((err as { message?: string })?.message ?? "Failed to read public key");
    }
  }

  function openDeploy(cred: CredentialSet) {
    setDeployingId(cred.id);
    setDeployTarget("");
    setDeployAuth("");
    setDeployError(null);
    setDeployDone(false);
  }

  async function handleDeploy(credId: string) {
    if (!deployTarget || !deployAuth) return;
    setDeployError(null);
    setDeployBusy(true);
    try {
      await deployPublicKey({
        credential_set_id: credId,
        target_machine_id: deployTarget,
        auth_credential_set_id: deployAuth,
      });
      setDeployDone(true);
    } catch (err: unknown) {
      setDeployError((err as { message?: string })?.message ?? "Deploy failed");
    } finally {
      setDeployBusy(false);
    }
  }

  async function handleDelete(credId: string) {
    if (!window.confirm("Delete this credential? This cannot be undone.")) return;
    setDeletingId(credId);
    try {
      await deleteCredentialSet(credId);
      load();
    } catch (err: unknown) {
      alert((err as { message?: string })?.message ?? "Failed to delete");
    } finally {
      setDeletingId(null);
    }
  }

  // Auth credentials: any non-TOTP credential (not the one being deployed)
  const authCreds = (deployingId: string | null) =>
    creds.filter((c) => c.kind !== "Totp" && c.id !== deployingId);

  if (showAdd) {
    return (
      <AddCredentialModal
        onCreated={() => {
          setShowAdd(false);
          load();
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={closeModal}>
      <div
        className="w-[600px] max-h-[80vh] flex flex-col bg-surface-800 rounded-xl border border-surface-600 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-600 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-gray-100">Credentials</h2>
            {!loading && (
              <span className="text-xs text-muted">({creds.length})</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent hover:bg-blue-500 text-white text-xs font-medium transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add credential
            </button>
            <button onClick={closeModal} className="text-muted hover:text-gray-200 transition-colors ml-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-3 space-y-2">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 text-muted animate-spin" />
            </div>
          )}

          {!loading && creds.length === 0 && (
            <div className="text-center py-12 text-xs text-muted">
              No credentials yet. Click <b>Add credential</b> to get started.
            </div>
          )}

          {!loading && creds.map((cred) => (
            <div
              key={cred.id}
              className="rounded-lg border border-surface-600 bg-surface-700/50 overflow-hidden"
            >
              {/* Credential row */}
              <div className="flex items-center gap-3 px-4 py-3">
                <KindIcon kind={cred.kind} />

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-100 truncate">{cred.name}</p>
                  <p className="text-xs text-muted font-mono truncate">{cred.username ?? "—"}</p>
                </div>

                <KindBadge kind={cred.kind} />

                {/* Actions */}
                <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                  {cred.kind === "SshKey" && (
                    <>
                      <ActionButton
                        title="Copy public key"
                        onClick={() => copyPublicKey(cred)}
                      >
                        {copiedId === cred.id ? (
                          <Check className="w-3.5 h-3.5 text-green-400" />
                        ) : (
                          <Clipboard className="w-3.5 h-3.5" />
                        )}
                      </ActionButton>
                      <ActionButton
                        title="Deploy public key to a machine"
                        onClick={() =>
                          deployingId === cred.id
                            ? setDeployingId(null)
                            : openDeploy(cred)
                        }
                        active={deployingId === cred.id}
                      >
                        <Send className="w-3.5 h-3.5" />
                      </ActionButton>
                    </>
                  )}
                  <ActionButton
                    title="Delete credential"
                    onClick={() => handleDelete(cred.id)}
                    danger
                    disabled={deletingId === cred.id}
                  >
                    {deletingId === cred.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </ActionButton>
                </div>
              </div>

              {/* Deploy panel */}
              {deployingId === cred.id && (
                <div className="border-t border-surface-600 px-4 py-3 bg-surface-700 space-y-3">
                  {deployDone ? (
                    <div className="flex items-center gap-2 text-green-400 text-xs">
                      <Check className="w-3.5 h-3.5" />
                      Public key deployed successfully to <code>~/.ssh/authorized_keys</code>.
                      <button
                        className="ml-auto underline text-muted hover:text-gray-300"
                        onClick={() => setDeployingId(null)}
                      >
                        Close
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-muted">
                        Append this key's public key to a machine's <code>~/.ssh/authorized_keys</code> over SSH.
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-muted block mb-1">Target machine *</label>
                          <select
                            value={deployTarget}
                            onChange={(e) => setDeployTarget(e.target.value)}
                            className="w-full bg-surface-600 border border-surface-500 rounded-md px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-accent"
                          >
                            <option value="">Select machine…</option>
                            {machines.map((m) => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-muted block mb-1">Auth as *</label>
                          <select
                            value={deployAuth}
                            onChange={(e) => setDeployAuth(e.target.value)}
                            className="w-full bg-surface-600 border border-surface-500 rounded-md px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-accent"
                          >
                            <option value="">Select credential…</option>
                            {authCreds(cred.id).map((c) => (
                              <option key={c.id} value={c.id}>{c.name} ({c.username})</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {deployError && (
                        <p className="text-xs text-red-400 bg-red-900/20 border border-red-900/30 rounded px-2 py-1.5">
                          {deployError}
                        </p>
                      )}

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleDeploy(cred.id)}
                          disabled={deployBusy || !deployTarget || !deployAuth}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
                        >
                          {deployBusy ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Send className="w-3 h-3" />
                          )}
                          {deployBusy ? "Deploying…" : "Deploy"}
                        </button>
                        <button
                          onClick={() => setDeployingId(null)}
                          className="text-xs text-muted hover:text-gray-300 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KindIcon({ kind }: { kind: string }) {
  if (kind === "SshKey") return <KeyRound className="w-4 h-4 text-purple-400 flex-shrink-0" />;
  if (kind === "Totp")   return <Shield className="w-4 h-4 text-green-400 flex-shrink-0" />;
  return <Key className="w-4 h-4 text-accent/70 flex-shrink-0" />;
}

function KindBadge({ kind }: { kind: string }) {
  const map: Record<string, string> = {
    Password: "bg-surface-600 text-muted",
    SshKey:   "bg-purple-900/30 text-purple-300",
    Totp:     "bg-green-900/30 text-green-300",
  };
  const labels: Record<string, string> = { Password: "Password", SshKey: "SSH Key", Totp: "TOTP" };
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${map[kind] ?? map.Password}`}>
      {labels[kind] ?? kind}
    </span>
  );
}

function ActionButton({
  children,
  title,
  onClick,
  danger,
  active,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  danger?: boolean;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors disabled:opacity-40 ${
        danger
          ? "text-red-400/70 hover:text-red-400 hover:bg-red-900/20"
          : active
          ? "text-accent bg-accent/10"
          : "text-muted hover:text-gray-300 hover:bg-surface-600"
      }`}
    >
      {children}
    </button>
  );
}
