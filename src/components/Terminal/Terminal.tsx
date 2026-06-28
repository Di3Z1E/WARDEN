import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { listen } from "@tauri-apps/api/event";
import { sessionWrite, sessionResize } from "../../lib/tauri";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  sessionId: string;
}

export default function Terminal({ sessionId }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      theme: {
        background: "#0d0f14",
        foreground: "#e2e8f0",
        cursor: "#3b82f6",
        cursorAccent: "#0d0f14",
        black: "#1e293b",
        brightBlack: "#475569",
        red: "#ef4444",
        brightRed: "#f87171",
        green: "#22c55e",
        brightGreen: "#4ade80",
        yellow: "#f59e0b",
        brightYellow: "#fbbf24",
        blue: "#3b82f6",
        brightBlue: "#60a5fa",
        magenta: "#a855f7",
        brightMagenta: "#c084fc",
        cyan: "#06b6d4",
        brightCyan: "#22d3ee",
        white: "#cbd5e1",
        brightWhite: "#f8fafc",
      },
      fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "block",
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    const links = new WebLinksAddon();

    term.loadAddon(fit);
    term.loadAddon(links);
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    // Send keystrokes to the backend
    const disposeOnData = term.onData((data) => {
      const bytes = Array.from(new TextEncoder().encode(data));
      sessionWrite(sessionId, bytes).catch(console.error);
    });

    // Listen for output from the backend
    let unlisten: (() => void) | null = null;
    listen<number[]>(`session:data:${sessionId}`, (event) => {
      const bytes = new Uint8Array(event.payload);
      term.write(bytes);
    }).then((fn) => {
      unlisten = fn;
    });

    // Listen for disconnect
    let unlistenStatus: (() => void) | null = null;
    listen<string>(`session:status:${sessionId}`, (event) => {
      if (event.payload === "disconnected") {
        term.write("\r\n\x1b[31m[Session closed]\x1b[0m\r\n");
      }
    }).then((fn) => {
      unlistenStatus = fn;
    });

    // Resize observer
    const ro = new ResizeObserver(() => {
      fit.fit();
      const dims = fit.proposeDimensions();
      if (dims) {
        sessionResize(sessionId, dims.cols, dims.rows).catch(() => {});
      }
    });
    ro.observe(containerRef.current);

    return () => {
      disposeOnData.dispose();
      unlisten?.();
      unlistenStatus?.();
      ro.disconnect();
      term.dispose();
    };
  }, [sessionId]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full p-1 bg-surface-900"
      style={{ overflow: "hidden" }}
    />
  );
}
