import { useEffect, useRef } from "react";
import Header from "../Header/Header";
import AssetTree from "../AssetTree/AssetTree";
import SessionPane from "../SessionPane/SessionPane";
import Modals from "../modals/Modals";
import CommandPalette from "../CommandPalette/CommandPalette";
import { useUiStore } from "../../store";

const MIN_SIDEBAR = 200;
const MAX_SIDEBAR = 500;

export default function Layout() {
  const { sidebarWidth, setSidebarWidth, commandPaletteOpen, openCommandPalette } = useUiStore();
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(sidebarWidth);

  // Global Ctrl+K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        openCommandPalette();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openCommandPalette]);

  function onDividerMouseDown(e: React.MouseEvent) {
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = ev.clientX - startX.current;
      setSidebarWidth(Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, startW.current + delta)));
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-surface-900 overflow-hidden">
      <Header />

      <div className="flex flex-1 overflow-hidden">
        <aside
          className="flex-shrink-0 bg-surface-800 border-r border-surface-600 flex flex-col overflow-hidden"
          style={{ width: sidebarWidth }}
        >
          <AssetTree />
        </aside>

        <div
          className="w-1 flex-shrink-0 cursor-col-resize hover:bg-accent/50 active:bg-accent transition-colors"
          onMouseDown={onDividerMouseDown}
        />

        <main className="flex-1 overflow-hidden bg-surface-900">
          <SessionPane />
        </main>
      </div>

      {commandPaletteOpen && <CommandPalette />}
      <Modals />
    </div>
  );
}
