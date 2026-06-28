import { useEffect, useState, useCallback } from "react";
import { X, FolderOpen, File, ChevronRight, ArrowLeft, RefreshCw, HardDrive } from "lucide-react";
import clsx from "clsx";
import { netListDir } from "../../lib/tauri";
import type { NetFsEntry } from "../../lib/tauri";

interface Props {
  initialPath: string;
  onClose: () => void;
}

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(ts: number | null | undefined): string {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function NetworkShareModal({ initialPath, onClose }: Props) {
  const [path, setPath] = useState(initialPath);
  const [inputPath, setInputPath] = useState(initialPath);
  const [entries, setEntries] = useState<NetFsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);

  const loadPath = useCallback(async (p: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await netListDir(p);
      setEntries(result);
      setPath(p);
      setInputPath(p);
    } catch (e: unknown) {
      setError((e as { message?: string })?.message ?? `Cannot access ${p}`);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPath(initialPath);
  }, [initialPath, loadPath]);

  function navigate(entry: NetFsEntry) {
    if (!entry.is_dir) return;
    setHistory((h) => [...h, path]);
    const sep = path.endsWith("\\") || path.endsWith("/") ? "" : "\\";
    loadPath(path + sep + entry.name);
  }

  function goBack() {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    loadPath(prev);
  }

  function handleNavigate(e: React.FormEvent) {
    e.preventDefault();
    if (inputPath) loadPath(inputPath.trim());
  }

  const pathParts = path.replace(/\\/g, "/").split("/").filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-800 border border-surface-600 rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col" style={{ height: "75vh" }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-600 flex-shrink-0">
          <HardDrive className="w-4 h-4 text-accent" />
          <span className="text-sm font-semibold text-gray-200">Network Share Browser</span>
          <button onClick={onClose} className="ml-auto p-1.5 rounded-lg hover:bg-surface-700 text-muted hover:text-gray-200 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-surface-600 flex-shrink-0">
          <button
            onClick={goBack}
            disabled={history.length === 0}
            className="p-1.5 rounded hover:bg-surface-700 text-muted hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => loadPath(path)}
            className="p-1.5 rounded hover:bg-surface-700 text-muted hover:text-gray-200 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={clsx("w-4 h-4", loading && "animate-spin")} />
          </button>
          <form onSubmit={handleNavigate} className="flex-1 flex gap-2">
            <input
              value={inputPath}
              onChange={(e) => setInputPath(e.target.value)}
              className="flex-1 bg-surface-700 border border-surface-600 rounded-lg px-3 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-accent/50 transition-colors"
              placeholder="\\server\share\path"
              spellCheck={false}
            />
            <button
              type="submit"
              className="px-3 py-1.5 rounded-lg bg-accent/10 hover:bg-accent/20 text-accent text-xs border border-accent/30 transition-colors"
            >
              Go
            </button>
          </form>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 px-4 py-1.5 border-b border-surface-600/50 flex-shrink-0 overflow-x-auto">
          {pathParts.map((part, i) => (
            <div key={i} className="flex items-center gap-1 flex-shrink-0">
              {i > 0 && <ChevronRight className="w-3 h-3 text-muted" />}
              <span className="text-[11px] text-muted">{part}</span>
            </div>
          ))}
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto">
          {error ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6 gap-2">
              <span className="text-xs text-red-400">{error}</span>
              <span className="text-[11px] text-muted">
                Make sure the path is correct and you have network access.
              </span>
            </div>
          ) : loading && entries.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted text-xs animate-pulse">
              Loading…
            </div>
          ) : entries.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted text-xs">
              This folder is empty.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-800">
                <tr className="border-b border-surface-600/50">
                  <th className="text-left px-4 py-2 text-[10px] text-muted uppercase tracking-wider font-medium">Name</th>
                  <th className="text-right px-4 py-2 text-[10px] text-muted uppercase tracking-wider font-medium w-28">Size</th>
                  <th className="text-right px-4 py-2 text-[10px] text-muted uppercase tracking-wider font-medium w-36">Modified</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry.name}
                    onClick={() => navigate(entry)}
                    className={clsx(
                      "border-b border-surface-700/40 transition-colors",
                      entry.is_dir ? "cursor-pointer hover:bg-surface-700/50" : "hover:bg-surface-700/30"
                    )}
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2.5">
                        {entry.is_dir
                          ? <FolderOpen className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                          : <File className="w-4 h-4 text-muted flex-shrink-0" />
                        }
                        <span className={clsx("truncate", entry.is_dir ? "text-gray-200 font-medium" : "text-gray-300")}>
                          {entry.name}
                        </span>
                        {entry.readonly && (
                          <span className="text-[10px] text-muted bg-surface-700 rounded px-1 flex-shrink-0">R</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-muted">
                      {entry.is_dir ? "—" : formatSize(entry.size)}
                    </td>
                    <td className="px-4 py-2 text-right text-muted">
                      {formatDate(entry.modified)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-surface-600/50 text-[10px] text-muted flex-shrink-0">
          <span>{entries.length} item{entries.length !== 1 ? "s" : ""}</span>
          <span className="font-mono truncate max-w-xs">{path}</span>
        </div>
      </div>
    </div>
  );
}
