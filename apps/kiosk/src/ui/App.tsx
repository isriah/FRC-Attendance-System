import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { baseDisplayState, type DisplayStatus } from "../kioskStates";
import "./styles.css";

interface KioskDisplayState {
  status: DisplayStatus;
  message: string;
  detail: string;
  updatedAt?: string;
  health?: KioskDisplayHealth;
}

interface KioskDisplayHealth {
  readerOnline?: boolean | null;
  pendingScanCount: number;
  lastSyncAt?: string;
  lastSyncError?: string;
}

const readyState: KioskDisplayState = baseDisplayState("ready");

const kioskBrand = {
  title: import.meta.env.VITE_KIOSK_TITLE ?? "FRC Attendance",
  subtitle: import.meta.env.VITE_KIOSK_SUBTITLE ?? "RoboLancers 321",
  primaryColor: import.meta.env.VITE_KIOSK_PRIMARY_COLOR ?? "#B80100",
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
        const next = await fetchDisplayState();
        if (!isMounted) return;
        setLastRefreshAt(Date.now());
        if (next.updatedAt && next.updatedAt !== lastSeenUpdate) {
          lastSeenUpdate = next.updatedAt;
          setState(next);
        } else {
          setState((current) => ({ ...current, health: next.health }));
        }
      } catch {
        if (isMounted) setState({ ...baseDisplayState("reader_offline"), detail: "Display state service is not responding" });
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
    if (state.status === "ready" || state.status === "reader_offline") return;
    const timer = window.setTimeout(() => setState((current) => ({ ...readyState, health: current.health })), 5000);
    return () => window.clearTimeout(timer);
  }, [state.status, state.updatedAt]);

  const networkStatus = networkStatusFor(state.health, lastRefreshAt);

  return (
    <main className={`kiosk-shell kiosk-shell-${state.status}`}>
      <NetworkStatusIcon status={networkStatus} />
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

function NetworkStatusIcon({ status }: { status: NetworkStatus }) {
  return (
    <div className={`network-status network-status-${status.kind}`} aria-label={status.label} title={status.label}>
      <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <path d="M5.5 13.5C11.3 8.8 20.7 8.8 26.5 13.5" />
        <path d="M10.5 18.2C13.6 15.9 18.4 15.9 21.5 18.2" />
        <path d="M15.1 23.2C15.6 22.8 16.4 22.8 16.9 23.2" />
      </svg>
      <span className="network-status-dot" />
    </div>
  );
}

interface NetworkStatus {
  kind: "online" | "queued" | "offline" | "unknown";
  label: string;
}

function networkStatusFor(health: KioskDisplayHealth | undefined, lastRefreshAt: number | undefined): NetworkStatus {
  if (!lastRefreshAt || !health) return { kind: "unknown", label: "Network status pending" };
  if (health.readerOnline === false) return { kind: "offline", label: "Fingerprint reader offline" };
  if (health.lastSyncError) return { kind: "offline", label: "Remote sync offline" };
  if (health.pendingScanCount > 0) return { kind: "queued", label: `${health.pendingScanCount} scan${health.pendingScanCount === 1 ? "" : "s"} queued` };
  return { kind: "online", label: "Remote sync online" };
}

async function fetchDisplayState() {
  const errors: string[] = [];
  for (const baseUrl of displayBaseUrls()) {
    try {
      const response = await fetch(`${baseUrl}/kiosk/display-state`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Display state request failed: ${response.status}`);
      return (await response.json()) as KioskDisplayState;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(errors.join("; "));
}

function displayBaseUrls() {
  const configured = import.meta.env.VITE_KIOSK_DISPLAY_BASE_URL;
  if (configured) return [configured.replace(/\/$/, "")];
  return [
    `${window.location.protocol}//${window.location.hostname}:8788`,
    `${window.location.protocol}//${window.location.hostname}:8787`
  ];
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
