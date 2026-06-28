import { useRef, useState } from "react";
import { Shield, Search, Users, BookOpen, LogOut, Terminal as TerminalIcon, DatabaseBackup, Info, Palette } from "lucide-react";
import clsx from "clsx";
import { useAuthStore, useSessionStore, useUiStore, useThemeStore, THEMES } from "../../store";
import { logout } from "../../lib/tauri";

const ROLE_COLORS: Record<string, string> = {
  Admin: "bg-red-900/40 text-red-300 border-red-800/60",
  Operator: "bg-blue-900/40 text-blue-300 border-blue-800/60",
  Auditor: "bg-purple-900/40 text-purple-300 border-purple-800/60",
  ReadOnly: "bg-surface-700 text-muted border-surface-600",
};

export default function Header() {
  const { user, setUser } = useAuthStore();
  const { tabs } = useSessionStore();
  const { openModal, openCommandPalette } = useUiStore();
  const { theme, setTheme } = useThemeStore();
  const [themeOpen, setThemeOpen] = useState(false);
  const themeRef = useRef<HTMLDivElement>(null);

  async function handleLogout() {
    try { await logout(); } catch (_) {}
    setUser(null);
  }

  return (
    <header className="flex items-center h-10 px-3 gap-2 bg-surface-800 border-b border-surface-600 flex-shrink-0 select-none relative">
      {/* Brand */}
      <div className="flex items-center gap-1.5 font-bold tracking-widest text-sm text-accent pr-1">
        <Shield className="w-4 h-4" />
        WARDEN
      </div>

      <div className="w-px h-4 bg-surface-600 mx-1" />

      {/* Global search trigger */}
      <button
        onClick={openCommandPalette}
        className="flex items-center gap-2 px-2.5 py-1 rounded bg-surface-700 border border-surface-600 text-muted text-xs hover:border-accent/50 hover:text-gray-300 transition-all group min-w-44"
      >
        <Search className="w-3 h-3 group-hover:text-accent transition-colors" />
        <span>Search machines…</span>
        <span className="ml-auto font-mono text-[10px] text-surface-500 group-hover:text-muted">Ctrl+K</span>
      </button>

      <div className="flex-1" />

      {/* Active session badge */}
      {tabs.length > 0 && (
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-green-900/30 border border-green-800/40 text-green-400 text-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          {tabs.length} session{tabs.length !== 1 ? "s" : ""}
          <TerminalIcon className="w-3 h-3 ml-0.5" />
        </div>
      )}

      {/* Theme picker */}
      <div className="relative" ref={themeRef}>
        <button
          onClick={() => setThemeOpen((v) => !v)}
          className="flex items-center gap-1 px-2 py-1 rounded hover:bg-surface-700 text-muted hover:text-gray-200 transition-colors text-xs"
          title="Change theme"
        >
          <Palette className="w-3.5 h-3.5" />
        </button>

        {themeOpen && (
          <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-40" onClick={() => setThemeOpen(false)} />
            <div className="absolute right-0 top-full mt-1.5 z-50 bg-surface-700 border border-surface-500 rounded-xl shadow-2xl p-3 min-w-44">
              <p className="text-[10px] text-muted uppercase tracking-widest mb-2.5 px-1">Theme</p>
              <div className="space-y-0.5">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { setTheme(t.id); setThemeOpen(false); }}
                    className={clsx(
                      "w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors",
                      theme === t.id
                        ? "bg-accent/15 text-gray-100"
                        : "text-gray-300 hover:bg-surface-600"
                    )}
                  >
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0 border border-white/20"
                      style={{ background: t.dot }}
                    />
                    {t.label}
                    {theme === t.id && (
                      <span className="ml-auto w-1.5 h-1.5 rounded-full bg-accent" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* About button */}
      <button
        onClick={() => openModal("about")}
        className="flex items-center gap-1 px-2 py-1 rounded hover:bg-surface-700 text-muted hover:text-gray-200 transition-colors text-xs"
        title="About WARDEN"
      >
        <Info className="w-3.5 h-3.5" />
      </button>

      {user && (
        <>
          <div className="w-px h-4 bg-surface-600 mx-1" />

          {(user.role === "Admin" || user.role === "Auditor") && (
            <button
              onClick={() => openModal("audit")}
              className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-surface-700 text-muted hover:text-gray-200 transition-colors text-xs"
              title="Audit log"
            >
              <BookOpen className="w-3.5 h-3.5" />
              Audit
            </button>
          )}

          {user.role === "Admin" && (
            <button
              onClick={() => openModal("user-manager")}
              className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-surface-700 text-muted hover:text-gray-200 transition-colors text-xs"
              title="Manage users"
            >
              <Users className="w-3.5 h-3.5" />
              Users
            </button>
          )}

          {user.role === "Admin" && (
            <button
              onClick={() => openModal("backup")}
              className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-surface-700 text-muted hover:text-gray-200 transition-colors text-xs"
              title="Backup / restore profiles"
            >
              <DatabaseBackup className="w-3.5 h-3.5" />
              Backup
            </button>
          )}

          <div className="w-px h-4 bg-surface-600 mx-1" />

          <button
            onClick={() => openModal("my-account")}
            className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-700 transition-colors group"
            title="My account"
          >
            <span className="text-xs text-gray-300 font-medium group-hover:text-gray-100">{user.username}</span>
            <span className={clsx(
              "text-[10px] px-1.5 py-0.5 rounded border font-medium",
              ROLE_COLORS[user.role] ?? "bg-surface-700 text-muted border-surface-600"
            )}>
              {user.role}
            </span>
          </button>

          <button
            onClick={handleLogout}
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-red-900/20 hover:text-red-400 text-muted transition-colors text-xs ml-1"
            title="Sign out"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </header>
  );
}
