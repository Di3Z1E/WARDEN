import { useEffect } from "react";
import { useUiStore } from "../../store";
import AddMachineModal from "./AddMachineModal";
import AddCredentialModal from "./AddCredentialModal";
import UserManagerModal from "./UserManagerModal";
import AuditLogModal from "./AuditLogModal";
import MyAccountModal from "./MyAccountModal";
import BackupModal from "./BackupModal";
import AboutModal from "./AboutModal";
import ScriptLibrary from "../ScriptLibrary/ScriptLibrary";
import BulkExec from "../BulkExec/BulkExec";
import CertMonitor from "../CertMonitor/CertMonitor";
import MonitoringPanel from "../Monitoring/MonitoringPanel";

export default function Modals() {
  const { modal, closeModal } = useUiStore();

  useEffect(() => {
    if (!modal) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeModal();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal, closeModal]);

  if (modal === "add-machine")   return <AddMachineModal />;
  if (modal === "add-credential") return <AddCredentialModal />;
  if (modal === "user-manager")  return <UserManagerModal />;
  if (modal === "audit")         return <AuditLogModal />;
  if (modal === "my-account")    return <MyAccountModal />;
  if (modal === "backup")        return <BackupModal />;
  if (modal === "about")         return <AboutModal />;
  if (modal === "scripts")       return <ScriptLibrary onClose={closeModal} />;
  if (modal === "bulk-exec")     return <BulkExec onClose={closeModal} />;
  if (modal === "cert-monitor")  return <CertMonitor onClose={closeModal} />;
  if (modal === "monitoring")    return <MonitoringPanel onClose={closeModal} />;

  return null;
}
