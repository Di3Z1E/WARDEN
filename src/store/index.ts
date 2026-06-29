import { create } from "zustand";
import type { CurrentUser, Folder, Machine } from "../types";

// ── Auth store ────────────────────────────────────────────────────────────────

interface AuthState {
  user: CurrentUser | null;
  isFirstRun: boolean | null;
  setUser: (user: CurrentUser | null) => void;
  setFirstRun: (v: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isFirstRun: null,
  setUser: (user) => set({ user }),
  setFirstRun: (v) => set({ isFirstRun: v }),
}));

// ── Inventory store ───────────────────────────────────────────────────────────

interface InventoryState {
  folders: Folder[];
  machines: Machine[];
  selectedMachineId: string | null;
  isLoading: boolean;
  setFolders: (folders: Folder[]) => void;
  setMachines: (machines: Machine[]) => void;
  selectMachine: (id: string | null) => void;
  setLoading: (v: boolean) => void;
  upsertMachine: (m: Machine) => void;
  removeMachine: (id: string) => void;
}

export const useInventoryStore = create<InventoryState>((set) => ({
  folders: [],
  machines: [],
  selectedMachineId: null,
  isLoading: false,
  setFolders: (folders) => set({ folders }),
  setMachines: (machines) => set({ machines }),
  selectMachine: (id) => set({ selectedMachineId: id }),
  setLoading: (v) => set({ isLoading: v }),
  upsertMachine: (m) =>
    set((s) => ({
      machines: s.machines.some((x) => x.id === m.id)
        ? s.machines.map((x) => (x.id === m.id ? m : x))
        : [...s.machines, m],
    })),
  removeMachine: (id) =>
    set((s) => ({ machines: s.machines.filter((m) => m.id !== id) })),
}));

// ── Sessions store ────────────────────────────────────────────────────────────

export interface SessionTab {
  id: string;
  protocol: string;
  profileId: string;
  machineId: string;
  machineName: string;
  label: string;
  host: string;
  connectedAt: number;
}

interface SessionState {
  tabs: SessionTab[];
  activeTabId: string | null;
  addTab: (tab: Omit<SessionTab, "connectedAt">) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string | null) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  tabs: [],
  activeTabId: null,
  addTab: (tab) =>
    set((s) => ({
      tabs: [...s.tabs, { ...tab, connectedAt: Date.now() }],
      activeTabId: tab.id,
    })),
  removeTab: (id) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      const activeTabId =
        s.activeTabId === id ? (tabs[tabs.length - 1]?.id ?? null) : s.activeTabId;
      return { tabs, activeTabId };
    }),
  setActiveTab: (id) => set({ activeTabId: id }),
}));

// ── UI store ──────────────────────────────────────────────────────────────────

export type ModalType =
  | "add-machine"
  | "add-credential"
  | "credentials"
  | "add-profile"
  | "user-manager"
  | "audit"
  | "edit-machine"
  | "edit-profile"
  | "my-account"
  | "backup"
  | "about"
  | "scripts"
  | "bulk-exec"
  | "cert-monitor"
  | "monitoring"
  | null;

interface UiState {
  modal: ModalType;
  commandPaletteOpen: boolean;
  openModal: (m: ModalType) => void;
  closeModal: () => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  sidebarWidth: number;
  setSidebarWidth: (w: number) => void;
}

export const useUiStore = create<UiState>((set) => ({
  modal: null,
  commandPaletteOpen: false,
  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),
  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  sidebarWidth: 260,
  setSidebarWidth: (w) => set({ sidebarWidth: w }),
}));

// ── Theme store ───────────────────────────────────────────────────────────────

export type ThemeName = "dark" | "total-dark" | "discord" | "vscode" | "white";

export const THEMES: { id: ThemeName; label: string; dot: string }[] = [
  { id: "dark",       label: "Dark",        dot: "#3b82f6" },
  { id: "total-dark", label: "Total Dark",  dot: "#00d4ff" },
  { id: "discord",    label: "Discord",     dot: "#5865f2" },
  { id: "vscode",     label: "VS Code",     dot: "#007acc" },
  { id: "white",      label: "White",       dot: "#2563eb" },
];

function applyTheme(t: ThemeName) {
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem("warden-theme", t); } catch (_) {}
}

const _savedTheme = (() => {
  try { return (localStorage.getItem("warden-theme") as ThemeName) || "dark"; } catch (_) { return "dark" as ThemeName; }
})();

applyTheme(_savedTheme);

interface ThemeState {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: _savedTheme,
  setTheme: (t) => {
    applyTheme(t);
    set({ theme: t });
  },
}));
