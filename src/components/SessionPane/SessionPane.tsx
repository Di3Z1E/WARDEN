import { useState, useEffect, useRef, useCallback } from "react";
import { X, Terminal, Monitor, Globe, Zap, HardDrive, PanelRightOpen, PanelRightClose, Cpu, List, Settings2 } from "lucide-react";
import clsx from "clsx";
import { useSessionStore, useInventoryStore } from "../../store";
import { disconnectSession, sftpDisconnect, connectSftp, listProfiles } from "../../lib/tauri";
import TerminalView from "../Terminal/Terminal";
import FileBrowser from "../FileBrowser/FileBrowser";
import RdpSession from "../RdpSession/RdpSession";
import Dashboard from "../Dashboard/Dashboard";
import MetricsPanel from "../SysInfo/MetricsPanel";
import ProcessManager from "../SysInfo/ProcessManager";
import ServiceManager from "../SysInfo/ServiceManager";
import type { SessionTab } from "../../store";

type ToolTab = "terminal" | "metrics" | "processes" | "services";

const PROTOCOL_ICONS: Record<string, React.ReactNode> = {
  SSH: <Terminal className="w-3 h-3" />,
  RDP: <Monitor className="w-3 h-3" />,
  Telnet: <Terminal className="w-3 h-3" />,
  VNC: <Globe className="w-3 h-3" />,
  SFTP: <HardDrive className="w-3 h-3" />,
};

const PROTOCOL_DOT: Record<string, string> = {
  SSH: "bg-green-400",
  RDP: "bg-blue-400",
  Telnet: "bg-yellow-400",
  VNC: "bg-purple-400",
  SFTP: "bg-cyan-400",
};

const PROTOCOL_BADGE: Record<string, string> = {
  SSH: "text-green-400 bg-green-900/20 border-green-800/40",
  RDP: "text-blue-400 bg-blue-900/20 border-blue-800/40",
  Telnet: "text-yellow-400 bg-yellow-900/20 border-yellow-800/40",
  VNC: "text-purple-400 bg-purple-900/20 border-purple-800/40",
  SFTP: "text-cyan-400 bg-cyan-900/20 border-cyan-800/40",
  HTTP: "text-orange-400 bg-orange-900/20 border-orange-800/40",
};

function SessionDuration({ connectedAt }: { connectedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.floor((now - connectedAt) / 60_000);
  if (elapsed < 1) return <span>just connected</span>;
  const h = Math.floor(elapsed / 60);
  const m = elapsed % 60;
  return <span>{h > 0 ? `${h}h ${m}m` : `${m}m`}</span>;
}

/** Manages an optional SFTP session side-panel attached to an SSH/RDP tab */
function useAttachedSftp(tab: SessionTab | undefined) {
  const [sftpSessionId, setSftpSessionId] = useState<string | null>(null);
  const [sftpOpen, setSftpOpen] = useState(false);
  const [sftpLoading, setSftpLoading] = useState(false);
  const [sftpError, setSftpError] = useState<string | null>(null);

  const toggle = useCallback(async () => {
    if (!tab || (tab.protocol !== "SSH" && tab.protocol !== "RDP")) return;

    if (sftpOpen) { setSftpOpen(false); return; }
    if (sftpSessionId) { setSftpOpen(true); return; }

    setSftpLoading(true);
    setSftpError(null);
    try {
      // SSH tabs: the SSH profile itself carries SFTP — reuse it directly.
      // RDP tabs: the RDP profile is on port 3389 and can't carry SFTP.
      //           Look for a dedicated SFTP or SSH profile on the same machine.
      let sftpProfileId = tab.profileId;
      if (tab.protocol === "RDP") {
        const profiles = await listProfiles(tab.machineId);
        const sftpProfile = profiles.find(
          (p) => p.protocol === "SFTP" || p.protocol === "SSH"
        );
        if (!sftpProfile) {
          setSftpError(
            "No SFTP / SSH profile found for this machine. " +
            "Add an SFTP or SSH profile to enable file browsing."
          );
          return;
        }
        sftpProfileId = sftpProfile.id;
      }

      const result = await connectSftp({ profile_id: sftpProfileId });
      setSftpSessionId(result.id);
      setSftpOpen(true);
    } catch (err: unknown) {
      setSftpError((err as { message?: string })?.message ?? "SFTP connect failed");
    } finally {
      setSftpLoading(false);
    }
  }, [tab, sftpOpen, sftpSessionId]);

  // Reset when switching tabs
  useEffect(() => {
    setSftpSessionId(null);
    setSftpOpen(false);
    setSftpError(null);
  }, [tab?.id]);

  return { sftpSessionId, sftpOpen, sftpLoading, sftpError, toggle, setSftpError };
}

/** Drag-to-resize divider between main content and SFTP panel */
function ResizeDivider({ onResize }: { onResize: (dx: number) => void }) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  function onMouseDown(e: React.MouseEvent) {
    dragging.current = true;
    lastX.current = e.clientX;
    e.preventDefault();
  }

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return;
      onResize(e.clientX - lastX.current);
      lastX.current = e.clientX;
    }
    function onUp() {
      dragging.current = false;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onResize]);

  return (
    <div
      onMouseDown={onMouseDown}
      className="w-1 flex-shrink-0 bg-surface-700 hover:bg-accent cursor-col-resize transition-colors select-none"
      title="Drag to resize"
    />
  );
}

/** Session content with tool tabs (Metrics / Processes / Services) and optional SFTP split panel */
function SessionContent({ tab }: { tab: SessionTab }) {
  const [sftpWidth, setSftpWidth] = useState(340);
  const [toolTab, setToolTab] = useState<ToolTab>("terminal");
  const { sftpSessionId, sftpOpen, sftpLoading, sftpError, toggle, setSftpError } =
    useAttachedSftp(tab);

  const { machines } = useInventoryStore();
  const machine = machines.find((m) => m.id === tab.machineId);
  const isWindows =
    machine?.machine_type === "WindowsServer" || machine?.machine_type === "WindowsClient";
  const platform = isWindows ? "windows" : "linux";

  const supportsSftp = tab.protocol === "SSH" || tab.protocol === "RDP";
  const supportsTools = tab.protocol === "SSH";

  const handleResize = useCallback((dx: number) => {
    setSftpWidth((w) => Math.max(200, Math.min(700, w - dx)));
  }, []);

  // Reset tool tab when switching sessions
  useEffect(() => { setToolTab("terminal"); }, [tab.id]);

  const toolButtons: { id: ToolTab; icon: React.ReactNode; label: string }[] = [
    { id: "metrics",   icon: <Cpu className="w-3 h-3" />,      label: "Metrics"   },
    { id: "processes", icon: <List className="w-3 h-3" />,     label: "Processes" },
    { id: "services",  icon: <Settings2 className="w-3 h-3" />, label: "Services"  },
  ];

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* ── Tool tab bar (SSH sessions only) ── */}
      {supportsTools && (
        <div className="flex items-center gap-1 px-2 py-1 bg-surface-800 border-b border-surface-700 flex-shrink-0">
          <button
            onClick={() => setToolTab("terminal")}
            className={clsx(
              "flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] transition-colors",
              toolTab === "terminal"
                ? "bg-accent/15 text-accent"
                : "text-muted hover:text-gray-200 hover:bg-surface-700"
            )}
          >
            <Terminal className="w-3 h-3" />
            Terminal
          </button>
          <span className="w-px h-3 bg-surface-600 mx-0.5" />
          {toolButtons.map(({ id, icon, label }) => (
            <button
              key={id}
              onClick={() => setToolTab(id)}
              className={clsx(
                "flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] transition-colors",
                toolTab === id
                  ? "bg-accent/15 text-accent"
                  : "text-muted hover:text-gray-200 hover:bg-surface-700"
              )}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── Content row ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Main content */}
        <div className="flex-1 min-w-0 relative flex flex-col overflow-hidden">
          {/* Terminal — always mounted, hidden when tool panel active */}
          <div className={clsx("flex-1 overflow-hidden", toolTab !== "terminal" && "hidden")}>
            {/* SFTP toggle (only in terminal tab) */}
            {supportsSftp && toolTab === "terminal" && (
              <button
                onClick={toggle}
                disabled={sftpLoading}
                title={sftpOpen ? "Hide SFTP browser" : "Open SFTP file browser"}
                className={clsx(
                  "absolute top-2 right-2 z-10 flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium transition-all shadow-md",
                  sftpOpen
                    ? "bg-accent text-white hover:bg-blue-500"
                    : "bg-surface-700/90 text-muted hover:bg-surface-600 hover:text-gray-200 border border-surface-600",
                  sftpLoading && "opacity-60 cursor-wait"
                )}
              >
                {sftpOpen ? <PanelRightClose className="w-3 h-3" /> : <PanelRightOpen className="w-3 h-3" />}
                {sftpLoading ? "Connecting…" : sftpOpen ? "Hide Files" : "Files"}
              </button>
            )}

            {(tab.protocol === "SSH" || tab.protocol === "Telnet") && (
              <TerminalView sessionId={tab.id} />
            )}
            {tab.protocol === "SFTP" && <FileBrowser sessionId={tab.id} />}
            {tab.protocol === "RDP" && (
              <RdpSession sessionId={tab.id} width={1280} height={800} />
            )}
            {tab.protocol !== "SSH" &&
              tab.protocol !== "Telnet" &&
              tab.protocol !== "SFTP" &&
              tab.protocol !== "RDP" && (
                <div className="h-full flex flex-col items-center justify-center gap-3 text-muted">
                  <Globe className="w-10 h-10 opacity-20" />
                  <div className="text-sm">{tab.protocol} is not yet supported</div>
                </div>
              )}
          </div>

          {/* Tool panels */}
          {toolTab === "metrics"   && <MetricsPanel   machineId={tab.machineId} platform={platform} />}
          {toolTab === "processes" && <ProcessManager machineId={tab.machineId} platform={platform} />}
          {toolTab === "services"  && <ServiceManager machineId={tab.machineId} platform={platform} />}
        </div>

        {/* ── SFTP split panel (terminal tab only) ── */}
        {toolTab === "terminal" && sftpOpen && sftpSessionId && (
          <>
            <ResizeDivider onResize={handleResize} />
            <div
              className="flex-shrink-0 flex flex-col border-l border-surface-600 bg-surface-900 overflow-hidden"
              style={{ width: sftpWidth }}
            >
              <div className="flex items-center gap-2 px-2 py-1.5 bg-surface-800 border-b border-surface-700 flex-shrink-0">
                <HardDrive className="w-3 h-3 text-cyan-400" />
                <span className="text-[11px] text-muted font-medium flex-1 truncate">
                  SFTP — {tab.host}
                </span>
                <button
                  onClick={toggle}
                  className="text-muted hover:text-gray-200 transition-colors"
                  title="Close SFTP panel"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <FileBrowser sessionId={sftpSessionId} />
              </div>
            </div>
          </>
        )}
      </div>

      {/* SFTP error toast */}
      {sftpError && (
        <div className="absolute bottom-4 right-4 z-20 flex items-center gap-2 px-3 py-2 bg-red-900/80 border border-red-700/60 rounded text-xs text-red-200 shadow-lg backdrop-blur-sm">
          <span>{sftpError}</span>
          <button onClick={() => setSftpError(null)} className="text-red-300 hover:text-red-100 ml-1">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}

export default function SessionPane() {
  const { tabs, activeTabId, setActiveTab, removeTab } = useSessionStore();

  if (tabs.length === 0) {
    return <Dashboard />;
  }

  async function closeTab(tab: SessionTab, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      if (tab.protocol === "SFTP") {
        await sftpDisconnect(tab.id);
      } else {
        await disconnectSession(tab.id);
      }
    } catch (_) {}
    removeTab(tab.id);
  }

  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-stretch border-b border-surface-600 bg-surface-800 overflow-x-auto flex-shrink-0 h-9">
        {tabs.map((tab) => {
          const isActive = activeTabId === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                "flex items-center gap-2 px-3 text-xs border-r border-surface-600 whitespace-nowrap transition-colors min-w-0 max-w-52 group relative",
                isActive
                  ? "bg-surface-900 text-gray-100"
                  : "text-muted hover:bg-surface-700 hover:text-gray-300"
              )}
            >
              {isActive && (
                <span className="absolute top-0 left-0 right-0 h-0.5 bg-accent" />
              )}
              <span
                className={clsx(
                  "w-1.5 h-1.5 rounded-full flex-shrink-0",
                  PROTOCOL_DOT[tab.protocol] ?? "bg-gray-500"
                )}
              />
              <span className="flex-shrink-0 opacity-60">
                {PROTOCOL_ICONS[tab.protocol] ?? <Zap className="w-3 h-3" />}
              </span>
              <span className="truncate">{tab.label}</span>
              <span
                role="button"
                onClick={(e) => closeTab(tab, e)}
                className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-surface-600 hover:text-red-400 transition-all"
              >
                <X className="w-3 h-3" />
              </span>
            </button>
          );
        })}
      </div>

      {/* Session info bar */}
      {activeTab && (
        <div className="flex items-center gap-3 px-3 py-1 bg-surface-800 border-b border-surface-700 text-[11px] text-muted flex-shrink-0">
          <span
            className={clsx(
              "px-1.5 py-0.5 rounded font-mono text-[10px] border",
              PROTOCOL_BADGE[activeTab.protocol] ?? "text-muted border-surface-600"
            )}
          >
            {activeTab.protocol}
          </span>
          <span className="font-mono text-gray-400">{activeTab.host}</span>
          <span className="text-surface-500">·</span>
          <span>{activeTab.machineName}</span>
          <span className="ml-auto flex items-center gap-1 text-muted">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <SessionDuration connectedAt={activeTab.connectedAt} />
          </span>
        </div>
      )}

      {/* Session content — all tabs mounted, only active shown */}
      <div className="flex-1 overflow-hidden relative">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={clsx(
              "absolute inset-0",
              activeTabId === tab.id ? "flex flex-col" : "hidden"
            )}
          >
            <SessionContent tab={tab} />
          </div>
        ))}
      </div>
    </div>
  );
}
