import { useEffect, useState } from "react";
import { firstRunCheck, getCurrentUser } from "./lib/tauri";
import { useAuthStore } from "./store";
import Layout from "./components/Layout/Layout";
import LoginModal from "./components/modals/LoginModal";
import SetupWizard from "./components/modals/SetupWizard";

export default function App() {
  const { user, isFirstRun, setUser, setFirstRun } = useAuthStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function init() {
      try {
        const first = await firstRunCheck();
        setFirstRun(first);
        if (!first) {
          const current = await getCurrentUser();
          setUser(current);
        }
      } catch (e) {
        console.error("Init failed:", e);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-surface-900">
        <div className="text-muted text-sm tracking-widest animate-pulse">
          WARDEN
        </div>
      </div>
    );
  }

  if (isFirstRun) {
    return <SetupWizard />;
  }

  if (!user) {
    return <LoginModal />;
  }

  return <Layout />;
}
