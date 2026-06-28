import { useState, useEffect, useCallback, useRef } from "react";
import {
  Folder, File, FolderOpen, ChevronRight, Home, RefreshCw,
  FolderPlus, Trash2, Edit3, Download, Upload, X, ArrowLeft,
  AlertCircle, Loader,
} from "lucide-react";
import clsx from "clsx";
import type { DirEntry } from "../../lib/tauri";
import { sftpListDir, sftpReadFile, sftpWriteFile, sftpDelete, sftpMkdir, sftpRename } from "../../lib/tauri";

interface FileBrowserProps {
  sessionId: string;
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function formatDate(unix: number | null): string {
  if (unix === null) return "";
  return new Date(unix * 1000).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function FileBrowser({ sessionId }: FileBrowserProps) {
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Multi-select: Set of selected names + shift-click anchor
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);

  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newDirName, setNewDirName] = useState("");
  const [busy, setBusy] = useState(false);

  // Download progress for batch downloads
  const [dlProgress, setDlProgress] = useState<{ done: number; total: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    setError(null);
    setSelected(new Set());
    setAnchor(null);
    try {
      const result = await sftpListDir(sessionId, p);
      setEntries(result);
      setPath(p);
    } catch (err: unknown) {
      setError((err as { message?: string })?.message ?? "Failed to list directory");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { load("/"); }, [load]);

  // ── Navigation ───────────────────────────────────────────────────────────────

  function navigate(entry: DirEntry) {
    if (entry.is_dir) {
      load(path === "/" ? `/${entry.name}` : `${path}/${entry.name}`);
    }
  }

  function goUp() {
    if (path === "/") return;
    const parts = path.split("/").filter(Boolean);
    parts.pop();
    load("/" + parts.join("/") || "/");
  }

  function breadcrumbs() {
    return ["/", ...path.split("/").filter(Boolean)];
  }

  // ── Selection ────────────────────────────────────────────────────────────────

  function handleRowClick(entry: DirEntry, e: React.MouseEvent) {
    // Don't steal focus while renaming
    if (renaming) return;

    const name = entry.name;

    if (e.shiftKey && anchor !== null) {
      // Range-select from anchor to this row
      const names = entries.map((en) => en.name);
      const aIdx = names.indexOf(anchor);
      const cIdx = names.indexOf(name);
      const [lo, hi] = aIdx <= cIdx ? [aIdx, cIdx] : [cIdx, aIdx];
      setSelected(new Set(names.slice(lo, hi + 1)));
    } else if (e.ctrlKey || e.metaKey) {
      // Toggle individual item
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      });
      setAnchor(name);
    } else {
      // Single select (deselect if already the only one selected)
      if (selected.size === 1 && selected.has(name)) {
        setSelected(new Set());
        setAnchor(null);
      } else {
        setSelected(new Set([name]));
        setAnchor(name);
      }
    }
  }

  // ── File operations ──────────────────────────────────────────────────────────

  async function handleDelete(entry: DirEntry) {
    if (!window.confirm(`Delete "${entry.name}"?`)) return;
    setBusy(true);
    try {
      const fullPath = path === "/" ? `/${entry.name}` : `${path}/${entry.name}`;
      await sftpDelete(sessionId, fullPath, entry.is_dir);
      load(path);
    } catch (err: unknown) {
      setError((err as { message?: string })?.message ?? "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(entry: DirEntry) {
    const from = path === "/" ? `/${entry.name}` : `${path}/${entry.name}`;
    const to   = path === "/" ? `/${newName}` : `${path}/${newName}`;
    if (!newName || newName === entry.name) { setRenaming(null); return; }
    setBusy(true);
    try {
      await sftpRename(sessionId, from, to);
      setRenaming(null);
      load(path);
    } catch (err: unknown) {
      setError((err as { message?: string })?.message ?? "Rename failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleMkdir() {
    if (!newDirName.trim()) return;
    const dirPath = path === "/" ? `/${newDirName}` : `${path}/${newDirName}`;
    setBusy(true);
    try {
      await sftpMkdir(sessionId, dirPath);
      setCreating(false);
      setNewDirName("");
      load(path);
    } catch (err: unknown) {
      setError((err as { message?: string })?.message ?? "Mkdir failed");
    } finally {
      setBusy(false);
    }
  }

  // Download a single file entry — returns true on success
  async function downloadOne(entry: DirEntry): Promise<boolean> {
    try {
      const fullPath = path === "/" ? `/${entry.name}` : `${path}/${entry.name}`;
      const result = await sftpReadFile(sessionId, fullPath);
      const bytes = Uint8Array.from(atob(result.data_base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes]));
      const a = document.createElement("a");
      a.href = url;
      a.download = entry.name;
      a.click();
      URL.revokeObjectURL(url);
      return true;
    } catch (err: unknown) {
      setError((err as { message?: string })?.message ?? `Download failed: ${entry.name}`);
      return false;
    }
  }

  async function handleDownloadSelected() {
    const fileEntries = entries.filter((e) => selected.has(e.name) && !e.is_dir);
    if (fileEntries.length === 0) return;
    if (fileEntries.length === 1) {
      setBusy(true);
      await downloadOne(fileEntries[0]);
      setBusy(false);
      return;
    }
    // Batch download
    setDlProgress({ done: 0, total: fileEntries.length });
    for (let i = 0; i < fileEntries.length; i++) {
      setDlProgress({ done: i, total: fileEntries.length });
      await downloadOne(fileEntries[i]);
      // Small delay so the browser can process each download trigger
      await new Promise((r) => setTimeout(r, 150));
    }
    setDlProgress({ done: fileEntries.length, total: fileEntries.length });
    await new Promise((r) => setTimeout(r, 600));
    setDlProgress(null);
  }

  async function handleUpload() {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      if (!files.length) return;
      setBusy(true);
      for (const file of files) {
        try {
          const buf = await file.arrayBuffer();
          const bytes = new Uint8Array(buf);
          // encode in chunks to avoid call-stack overflow on large files
          let b64 = "";
          const chunk = 8192;
          for (let i = 0; i < bytes.length; i += chunk) {
            b64 += String.fromCharCode(...bytes.subarray(i, i + chunk));
          }
          const dest = path === "/" ? `/${file.name}` : `${path}/${file.name}`;
          await sftpWriteFile(sessionId, dest, btoa(b64));
        } catch (err: unknown) {
          setError((err as { message?: string })?.message ?? `Upload failed: ${file.name}`);
        }
      }
      setBusy(false);
      load(path);
    };
    input.click();
  }

  // ── Derived values ───────────────────────────────────────────────────────────

  const crumbs = breadcrumbs();
  const selectedFiles = entries.filter((e) => selected.has(e.name) && !e.is_dir);
  const selectedAll = entries.length > 0 && entries.every((e) => selected.has(e.name));

  function toggleSelectAll() {
    if (selectedAll) {
      setSelected(new Set());
      setAnchor(null);
    } else {
      setSelected(new Set(entries.map((e) => e.name)));
    }
  }

  const isWorking = busy || dlProgress !== null;

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full bg-surface-900 text-gray-200 font-mono text-xs select-none"
    >
      {/* ── Toolbar ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-600 bg-surface-800 flex-shrink-0">
        <button onClick={goUp} disabled={path === "/" || loading}
          className="p-1 rounded hover:bg-surface-700 disabled:opacity-30 transition-colors" title="Go up">
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => load("/")} disabled={loading}
          className="p-1 rounded hover:bg-surface-700 disabled:opacity-30 transition-colors" title="Home">
          <Home className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => load(path)} disabled={loading}
          className="p-1 rounded hover:bg-surface-700 disabled:opacity-30 transition-colors" title="Refresh">
          <RefreshCw className={clsx("w-3.5 h-3.5", loading && "animate-spin")} />
        </button>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
          {crumbs.map((crumb, i) => {
            const crumbPath = crumb === "/" ? "/" : "/" + crumbs.slice(1, i + 1).join("/");
            return (
              <span key={i} className="flex items-center gap-1 flex-shrink-0">
                {i > 0 && <ChevronRight className="w-3 h-3 text-muted" />}
                <button onClick={() => load(crumbPath)}
                  className="hover:text-accent transition-colors px-1 py-0.5 rounded hover:bg-surface-700">
                  {crumb === "/" ? <Home className="w-3 h-3" /> : crumb}
                </button>
              </span>
            );
          })}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Batch download — visible when files are selected */}
          {selectedFiles.length > 0 && (
            <button
              onClick={handleDownloadSelected}
              disabled={isWorking}
              className="flex items-center gap-1 px-2 py-1 rounded bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 disabled:opacity-40 transition-colors"
              title={selectedFiles.length === 1 ? `Download ${selectedFiles[0].name}` : `Download ${selectedFiles.length} files`}
            >
              <Download className="w-3 h-3" />
              {selectedFiles.length > 1 ? `Download ${selectedFiles.length}` : "Download"}
            </button>
          )}
          <button onClick={handleUpload} disabled={isWorking || loading}
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-surface-700 disabled:opacity-40 transition-colors" title="Upload file(s)">
            <Upload className="w-3 h-3" /> Upload
          </button>
          <button onClick={() => { setCreating(true); setNewDirName(""); }} disabled={isWorking || loading}
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-surface-700 disabled:opacity-40 transition-colors" title="New folder">
            <FolderPlus className="w-3 h-3" /> Folder
          </button>
        </div>
      </div>

      {/* ── Error banner ─────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-red-900/30 border-b border-red-800/50 text-red-400 flex-shrink-0">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}><X className="w-3 h-3 hover:text-red-200" /></button>
        </div>
      )}

      {/* ── Download progress banner ─────────────────────────────────────────── */}
      {dlProgress !== null && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-accent/10 border-b border-accent/20 text-accent flex-shrink-0">
          <Loader className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
          <span className="flex-1">
            Downloading {dlProgress.done} / {dlProgress.total} files…
          </span>
          <div className="w-24 h-1 bg-surface-600 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${(dlProgress.done / dlProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* ── New folder input ─────────────────────────────────────────────────── */}
      {creating && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-surface-600 bg-surface-800 flex-shrink-0">
          <Folder className="w-3.5 h-3.5 text-accent" />
          <input
            autoFocus value={newDirName} onChange={(e) => setNewDirName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleMkdir(); if (e.key === "Escape") setCreating(false); }}
            placeholder="New folder name"
            className="flex-1 bg-surface-700 border border-surface-500 rounded px-2 py-0.5 text-gray-100 focus:outline-none focus:border-accent"
          />
          <button onClick={handleMkdir}
            className="px-2 py-0.5 bg-accent hover:bg-blue-500 text-white rounded transition-colors">
            Create
          </button>
          <button onClick={() => setCreating(false)} className="text-muted hover:text-gray-200">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── File list ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full gap-2 text-muted">
            <Loader className="w-4 h-4 animate-spin" /> Loading...
          </div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted">Empty directory</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-700 text-muted sticky top-0 bg-surface-900">
                {/* Select-all checkbox */}
                <th className="px-3 py-1.5 w-8">
                  <input
                    type="checkbox"
                    checked={selectedAll}
                    onChange={toggleSelectAll}
                    className="accent-accent cursor-pointer"
                    title="Select all"
                  />
                </th>
                <th className="text-left px-2 py-1.5 font-normal">Name</th>
                <th className="text-right px-3 py-1.5 font-normal w-24">Size</th>
                <th className="text-left px-3 py-1.5 font-normal w-44">Modified</th>
                <th className="px-2 py-1.5 w-20" />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const isSelected = selected.has(entry.name);
                const isRenaming = renaming === entry.name;
                return (
                  <tr
                    key={entry.name}
                    onClick={(e) => handleRowClick(entry, e)}
                    onDoubleClick={() => navigate(entry)}
                    className={clsx(
                      "border-b border-surface-800 cursor-pointer group transition-colors",
                      isSelected ? "bg-accent/15" : "hover:bg-surface-800"
                    )}
                  >
                    {/* Per-row checkbox */}
                    <td className="px-3 py-1.5 w-8" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(entry.name);
                            else next.delete(entry.name);
                            return next;
                          });
                          setAnchor(entry.name);
                        }}
                        className="accent-accent cursor-pointer"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        {entry.is_dir
                          ? isSelected
                            ? <FolderOpen className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                            : <Folder className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                          : <File className="w-4 h-4 text-blue-400 flex-shrink-0" />
                        }
                        {isRenaming ? (
                          <input
                            autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === "Enter") handleRename(entry);
                              if (e.key === "Escape") setRenaming(null);
                            }}
                            className="bg-surface-700 border border-accent rounded px-1.5 py-0.5 text-gray-100 focus:outline-none min-w-0 w-full"
                          />
                        ) : (
                          <span className={clsx(
                            "truncate",
                            entry.is_dir ? "text-yellow-200" : "text-gray-200",
                            entry.is_link && "italic opacity-75"
                          )}>
                            {entry.name}{entry.is_link ? " @" : ""}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-right text-muted">
                      {!entry.is_dir ? formatSize(entry.size) : ""}
                    </td>
                    <td className="px-3 py-1.5 text-muted">{formatDate(entry.modified)}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 justify-end transition-opacity">
                        {!entry.is_dir && (
                          <button
                            onClick={(e) => { e.stopPropagation(); downloadOne(entry); }}
                            className="p-1 rounded hover:bg-surface-600 text-muted hover:text-accent transition-colors"
                            title="Download"
                          >
                            <Download className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenaming(entry.name);
                            setNewName(entry.name);
                          }}
                          className="p-1 rounded hover:bg-surface-600 text-muted hover:text-gray-200 transition-colors"
                          title="Rename"
                        >
                          <Edit3 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(entry); }}
                          className="p-1 rounded hover:bg-red-900/40 text-muted hover:text-red-400 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Status bar ───────────────────────────────────────────────────────── */}
      <div className="flex items-center px-3 py-1 border-t border-surface-700 bg-surface-800 flex-shrink-0 text-muted gap-2">
        <span>{entries.length} item{entries.length !== 1 ? "s" : ""}</span>
        {selected.size > 0 && (
          <>
            <span className="text-surface-500">·</span>
            <span className="text-accent">{selected.size} selected</span>
            {selectedFiles.length > 0 && (
              <span className="text-muted">
                ({selectedFiles.length} file{selectedFiles.length !== 1 ? "s" : ""})
              </span>
            )}
          </>
        )}
        <span className="text-[10px] text-surface-500 ml-1 hidden sm:inline">
          Shift+click to range-select · Ctrl+click to toggle
        </span>
        {isWorking && (
          <span className="ml-auto flex items-center gap-1">
            <Loader className="w-3 h-3 animate-spin" /> Working…
          </span>
        )}
      </div>
    </div>
  );
}
