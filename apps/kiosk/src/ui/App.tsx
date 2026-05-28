import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type DisplayStatus = "ready" | "welcome" | "goodbye" | "duplicate" | "rejected" | "unknown" | "offline";

interface KioskDisplayState {
  status: DisplayStatus;
  message: string;
  detail: string;
  updatedAt?: string;
}

const readyState: KioskDisplayState = {
  status: "ready",
  message: "Place finger on reader",
  detail: "Attendance kiosk ready"
};

const kioskBrand = {
  title: import.meta.env.VITE_KIOSK_TITLE ?? "FRC Attendance",
  subtitle: import.meta.env.VITE_KIOSK_SUBTITLE ?? "RoboLancers 321",
  primaryColor: import.meta.env.VITE_KIOSK_PRIMARY_COLOR ?? "#1d7a8c",
  accentColor: import.meta.env.VITE_KIOSK_ACCENT_COLOR ?? "#f2c14e"
};

function KioskApp() {
  const [state, setState] = useState<KioskDisplayState>(readyState);
  const [startedAt] = useState(() => Date.now());
  const [lastRefreshAt, setLastRefreshAt] = useState<number>();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--primary-color", kioskBrand.primaryColor);
    root.style.setProperty("--accent-color", kioskBrand.accentColor);
  }, []);

  useEffect(() => {
    let lastSeenUpdate = "";
    let isMounted = true;

    async function pollDisplayState() {
      try {
        const response = await fetch(`${apiBaseUrl()}/kiosk/display-state`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Display state request failed: ${response.status}`);
        const next = (await response.json()) as KioskDisplayState;
        if (!isMounted) return;
        setLastRefreshAt(Date.now());
        if (next.updatedAt && next.updatedAt !== lastSeenUpdate) {
          lastSeenUpdate = next.updatedAt;
          setState(next);
        }
      } catch {
        if (isMounted) setState({ status: "offline", message: "Connection offline", detail: "Scans will continue caching locally" });
      }
    }

    pollDisplayState();
    const timer = window.setInterval(pollDisplayState, 750);
    return () => {
      isMounted = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (state.status === "ready" || state.status === "offline") return;
    const timer = window.setTimeout(() => setState(readyState), 5000);
    return () => window.clearTimeout(timer);
  }, [state.updatedAt, state.status]);

  return (
    <main className="kiosk-shell">
      <header className="kiosk-brand">
        <span>{kioskBrand.title}</span>
        <strong>{kioskBrand.subtitle}</strong>
      </header>
      <section className={`scan-panel scan-panel-${state.status}`}>
        <div className="reader-mark" aria-hidden="true" />
        <h1>{state.message}</h1>
        <p>{state.detail}</p>
      </section>
      <footer className="debug-status" aria-label="Kiosk debug timing">
        <span>Uptime {formatDuration(now - startedAt)}</span>
        <span>{lastRefreshAt ? `Last refresh ${formatDuration(now - lastRefreshAt)} ago` : "Last refresh pending"}</span>
      </footer>
    </main>
  );
}

function apiBaseUrl() {
  return `${window.location.protocol}//${window.location.hostname}:8787`;
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

createRoot(document.getElementById("root")!).render(<KioskApp />);
