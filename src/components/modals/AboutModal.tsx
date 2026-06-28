import { X, Shield, Terminal, Monitor, Network, HardDrive, Wifi, BookOpen, Keyboard } from "lucide-react";
import { useUiStore } from "../../store";

const FEATURES = [
  { icon: <Terminal className="w-4 h-4 text-green-400" />, label: "SSH & Telnet", desc: "Full terminal emulation with xterm" },
  { icon: <Monitor className="w-4 h-4 text-blue-400" />, label: "RDP", desc: "Remote Desktop via IronRDP + NLA/CredSSP" },
  { icon: <HardDrive className="w-4 h-4 text-cyan-400" />, label: "SFTP", desc: "Secure file transfers with full file browser" },
  { icon: <Network className="w-4 h-4 text-purple-400" />, label: "UNC Share Browser", desc: "Browse network shares without RDP/SSH" },
  { icon: <Wifi className="w-4 h-4 text-orange-400" />, label: "Wake-on-LAN", desc: "Remote power-on for managed machines" },
  { icon: <BookOpen className="w-4 h-4 text-yellow-400" />, label: "Audit Log", desc: "Full audit trail for every action" },
];

const SHORTCUTS = [
  { keys: "Ctrl+K", action: "Open command palette / search" },
  { keys: "Escape", action: "Close current modal" },
  { keys: "Double-click", action: "Connect to a profile" },
  { keys: "Right-click", action: "Context menu for machines & profiles" },
];

export default function AboutModal() {
  const { closeModal } = useUiStore();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-800 border border-surface-600 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-surface-600 flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
            <Shield className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-gray-100 tracking-widest">WARDEN</h2>
            <p className="text-[11px] text-muted">v0.1.0 — Unified IT Console</p>
          </div>
          <button
            onClick={closeModal}
            className="ml-auto p-1.5 rounded-lg hover:bg-surface-700 text-muted hover:text-gray-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* Description */}
          <p className="text-xs text-gray-300 leading-relaxed">
            WARDEN is a production-grade IT administration console built for sysadmins managing Windows and Linux
            environments. Designed to replace fragmented tooling with a single, secure, auditable interface.
          </p>

          {/* Features */}
          <div>
            <h3 className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-3">Features</h3>
            <div className="space-y-2">
              {FEATURES.map((f) => (
                <div key={f.label} className="flex items-start gap-3 p-2.5 rounded-lg bg-surface-700/50 border border-surface-600/50">
                  <div className="mt-0.5 flex-shrink-0">{f.icon}</div>
                  <div>
                    <p className="text-xs font-semibold text-gray-200">{f.label}</p>
                    <p className="text-[11px] text-muted mt-0.5">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Keyboard shortcuts */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Keyboard className="w-3.5 h-3.5 text-muted" />
              <h3 className="text-[10px] font-semibold text-muted uppercase tracking-widest">Keyboard Shortcuts</h3>
            </div>
            <div className="space-y-1.5">
              {SHORTCUTS.map((s) => (
                <div key={s.keys} className="flex items-center justify-between text-xs">
                  <span className="text-gray-300">{s.action}</span>
                  <kbd className="ml-2 px-2 py-0.5 rounded bg-surface-700 border border-surface-600 text-muted font-mono text-[10px] flex-shrink-0">
                    {s.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>

          {/* Credits */}
          <div>
            <h3 className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-3">Credits</h3>
            <div className="p-3 rounded-lg bg-surface-700/50 border border-surface-600/50 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted">Developer</span>
                <span className="text-gray-200 font-medium">David Azani</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Framework</span>
                <span className="text-gray-200">Tauri v2 + React 18</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">RDP Engine</span>
                <span className="text-gray-200">IronRDP (Devolutions)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">SSH Engine</span>
                <span className="text-gray-200">russh</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Backend</span>
                <span className="text-gray-200">Rust + SQLite</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">UI</span>
                <span className="text-gray-200">Tailwind CSS + Lucide</span>
              </div>
            </div>
          </div>

          {/* Legal */}
          <p className="text-[10px] text-muted/60 text-center leading-relaxed">
            Built for internal IT operations. All connections are audited. Use responsibly.
          </p>
        </div>
      </div>
    </div>
  );
}
