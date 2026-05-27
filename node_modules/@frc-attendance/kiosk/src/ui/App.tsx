import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

interface ScanState {
  status: "ready" | "matched" | "offline";
  studentId?: string;
  message: string;
}

function KioskApp() {
  const [state, setState] = useState<ScanState>({ status: "ready", message: "Place finger on reader" });

  useEffect(() => {
    const timer = window.setInterval(() => {
      setState((current) => current.status === "matched" ? { status: "ready", message: "Place finger on reader" } : current);
    }, 2500);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main className="kiosk-shell">
      <section className={`scan-panel scan-panel-${state.status}`}>
        <div className="reader-mark" aria-hidden="true" />
        <h1>{state.message}</h1>
        {state.studentId ? <p>Student {state.studentId}</p> : <p>Attendance kiosk ready</p>}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<KioskApp />);
