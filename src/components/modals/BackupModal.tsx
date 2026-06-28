import { useState } from "react";
import {
  Download, Upload, Key, Eye, EyeOff,
  CheckCircle, AlertCircle, Loader, X,
} from "lucide-react";
import { exportConfig, importConfig, listFolders, listMachines } from "../../lib/tauri";
import { useUiStore, useInventoryStore } from "../../store";
import type { ImportResult } from "../../lib/tauri";

export default function BackupModal() {
  const { closeModal } = useUiStore();
  const { setFolders, setMachines } = useInventoryStore();

  const [tab, setTab] = useState<"export" | "import">("export");

  // Export state
  const [exportPass, setExportPass] = useState("");
  const [exportConfirm, setExportConfirm] = useState("");
  const [showExportPass, setShowExportPass] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exported, setExported] = useState(false);

  // Import state
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPass, setImportPass] = useState("");
  const [showImportPass, setShowImportPass] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  async function handleExport() {
    setExportError(null);
    if (!exportPass) { setExportError("Passphrase required"); return; }
    if (exportPass.length < 8) { setExportError("Passphrase must be at least 8 characters"); return; }
    if (exportPass !== exportConfirm) { setExportError("Passphrases do not match"); return; }

    setExportLoading(true);
    try {
      const json = await exportConfig(exportPass);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `warden-backup-${new Date().toISOString().slice(0, 10)}.warden`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportPass("");
      setExportConfirm("");
      setExported(true);
    } catch (err: unknown) {
      setExportError((err as { message?: string })?.message ?? "Export failed");
    } finally {
      setExportLoading(false);
    }
  }

  async function handleImport() {
    setImportError(null);
    setImportResult(null);
    if (!importFile) { setImportError("Select a .warden file first"); return; }
    if (!importPass) { setImportError("Passphrase required"); return; }

    setImportLoading(true);
    try {
      const text = await importFile.text();
      const result = await importConfig(text, importPass);
      setImportResult(result);
      setImportPass("");
      setImportFile(null);
      // Refresh the inventory tree
      const [folders, machines] = await Promise.all([listFolders(), listMachines()]);
      setFolders(folders);
      setMachines(machines);
    } catch (err: unknown) {
      setImportError((err as { message?: string })?.message ?? "Import failed");
    } finally {
      setImportLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-800 border border-surface-600 rounded-lg shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-700">
          <div className="flex items-center gap-2 text-gray-100 font-medium text-sm">
            <Key className="w-4 h-4 text-accent" />
            Profile Backup
          </div>
          <button
            onClick={closeModal}
            className="p-1 rounded text-muted hover:text-gray-200 hover:bg-surface-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-surface-700">
          <button
            onClick={() => { setTab("export"); setExported(false); setExportError(null); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
              tab === "export"
                ? "text-accent border-b-2 border-accent"
                : "text-muted hover:text-gray-300"
            }`}
          >
            <Download className="w-3 h-3" /> Export
          </button>
          <button
            onClick={() => { setTab("import"); setImportResult(null); setImportError(null); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
              tab === "import"
                ? "text-accent border-b-2 border-accent"
                : "text-muted hover:text-gray-300"
            }`}
          >
            <Upload className="w-3 h-3" /> Import
          </button>
        </div>

        <div className="p-5 space-y-4">
          {tab === "export" ? (
            <>
              <p className="text-xs text-muted leading-relaxed">
                Exports all machines, profiles, folders, and credentials into an encrypted{" "}
                <code className="text-accent">.warden</code> file. Keep the passphrase safe — without it the backup cannot be decrypted.
              </p>

              <div className="space-y-1.5">
                <label className="text-xs text-muted">Encryption passphrase</label>
                <div className="relative">
                  <input
                    type={showExportPass ? "text" : "password"}
                    value={exportPass}
                    onChange={(e) => { setExportPass(e.target.value); setExported(false); }}
                    placeholder="Choose a strong passphrase (min. 8 chars)"
                    className="w-full bg-surface-700 border border-surface-500 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-accent pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowExportPass((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-gray-300"
                  >
                    {showExportPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-muted">Confirm passphrase</label>
                <input
                  type="password"
                  value={exportConfirm}
                  onChange={(e) => { setExportConfirm(e.target.value); setExported(false); }}
                  onKeyDown={(e) => e.key === "Enter" && handleExport()}
                  placeholder="Repeat passphrase"
                  className="w-full bg-surface-700 border border-surface-500 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-accent"
                />
              </div>

              {exportError && (
                <div className="flex items-center gap-2 text-red-400 text-xs bg-red-900/20 rounded px-3 py-2 border border-red-800/40">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  {exportError}
                </div>
              )}

              {exported && (
                <div className="flex items-center gap-2 text-green-400 text-xs bg-green-900/20 rounded px-3 py-2 border border-green-800/40">
                  <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  Backup downloaded successfully.
                </div>
              )}

              <button
                onClick={handleExport}
                disabled={exportLoading}
                className="w-full py-2.5 bg-accent hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors flex items-center justify-center gap-2"
              >
                {exportLoading
                  ? <><Loader className="w-4 h-4 animate-spin" /> Encrypting…</>
                  : <><Download className="w-4 h-4" /> Download backup</>}
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-muted leading-relaxed">
                Restores machines, profiles, folders, and credentials from a{" "}
                <code className="text-accent">.warden</code> backup. Existing data is kept — imported items are added alongside it.
              </p>

              {/* File picker */}
              <div className="space-y-1.5">
                <label className="text-xs text-muted">Backup file</label>
                <label className="flex items-center gap-2 w-full bg-surface-700 border border-surface-500 rounded px-3 py-2 text-sm cursor-pointer hover:border-accent/60 transition-colors">
                  <Upload className="w-3.5 h-3.5 text-muted flex-shrink-0" />
                  <span className={importFile ? "text-gray-200 truncate" : "text-muted"}>
                    {importFile ? importFile.name : "Choose a .warden file…"}
                  </span>
                  <input
                    type="file"
                    accept=".warden,application/json"
                    className="hidden"
                    onChange={(e) => {
                      setImportFile(e.target.files?.[0] ?? null);
                      setImportResult(null);
                      setImportError(null);
                    }}
                  />
                </label>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-muted">Passphrase</label>
                <div className="relative">
                  <input
                    type={showImportPass ? "text" : "password"}
                    value={importPass}
                    onChange={(e) => setImportPass(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleImport()}
                    placeholder="Passphrase used when exporting"
                    className="w-full bg-surface-700 border border-surface-500 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-accent pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowImportPass((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-gray-300"
                  >
                    {showImportPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {importError && (
                <div className="flex items-center gap-2 text-red-400 text-xs bg-red-900/20 rounded px-3 py-2 border border-red-800/40">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  {importError}
                </div>
              )}

              {importResult && (
                <div className="flex items-start gap-2 text-green-400 text-xs bg-green-900/20 rounded px-3 py-2 border border-green-800/40">
                  <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <div>
                    Import complete:{" "}
                    <span className="font-medium">{importResult.machines}</span> machine{importResult.machines !== 1 ? "s" : ""},
                    {" "}<span className="font-medium">{importResult.profiles}</span> profile{importResult.profiles !== 1 ? "s" : ""},
                    {" "}<span className="font-medium">{importResult.credentials}</span> credential{importResult.credentials !== 1 ? "s" : ""},
                    {" "}<span className="font-medium">{importResult.folders}</span> folder{importResult.folders !== 1 ? "s" : ""}.
                  </div>
                </div>
              )}

              <button
                onClick={handleImport}
                disabled={importLoading || !importFile}
                className="w-full py-2.5 bg-accent hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors flex items-center justify-center gap-2"
              >
                {importLoading
                  ? <><Loader className="w-4 h-4 animate-spin" /> Importing…</>
                  : <><Upload className="w-4 h-4" /> Import backup</>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
