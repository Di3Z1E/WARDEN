import { Shield, Users, LogOut, BookOpen } from "lucide-react";
import { useAuthStore, useSessionStore, useUiStore } from "../../store";
import { logout } from "../../lib/tauri";

export default function StatusBar() {
  const { user, setUser } = useAuthStore();
  const { tabs } = useSessionStore();
  const { openModal } = useUiStore();

  async function handleLogout() {
    try {
      await logout();
    } catch (_) {}
    setUser(null);
  }

  return (
    <footer className="flex items-center justify-between px-3 py-1 bg-surface-800 border-t border-surface-600 text-xs text-muted flex-shrink-0">
      {/* Left: branding + sessions count */}
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-accent font-semibold tracking-wider">
          <Shield className="w-3.5 h-3.5" />
          WARDEN
        </span>
        {tabs.length > 0 && (
          <span className="text-muted">
            {tabs.length} session{tabs.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Right: user info + quick actions */}
      <div className="flex items-center gap-2">
        {user && (
          <>
            {(user.role === "Admin" || user.role === "Auditor") && (
              <button
                onClick={() => openModal("audit")}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-surface-600 hover:text-gray-200 transition-colors"
                title="Audit log"
              >
                <BookOpen className="w-3 h-3" />
                Audit
              </button>
            )}
            {user.role === "Admin" && (
              <button
                onClick={() => openModal("user-manager")}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-surface-600 hover:text-gray-200 transition-colors"
                title="User manager"
              >
                <Users className="w-3 h-3" />
                Users
              </button>
            )}
            <span className="text-gray-400">
              {user.username}
              <span className="text-muted ml-1">({user.role})</span>
            </span>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-surface-600 hover:text-red-400 transition-colors"
              title="Logout"
            >
              <LogOut className="w-3 h-3" />
              Logout
            </button>
          </>
        )}
      </div>
    </footer>
  );
}
