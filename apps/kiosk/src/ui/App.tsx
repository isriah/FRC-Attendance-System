import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
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

  useEffect(() => {
    let lastSeenUpdate = "";
    let isMounted = true;

    async function pollDisplayState() {
      try {
        const response = await fetch(`${apiBaseUrl()}/kiosk/display-state`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Display state request failed: ${response.status}`);
        const next = (await response.json()) as KioskDisplayState;
        if (!isMounted) return;
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
    if (state.status === "ready" || state.status === "offline") return;
    const timer = window.setTimeout(() => setState(readyState), 5000);
    return () => window.clearTimeout(timer);
  }, [state.updatedAt, state.status]);

  return (
    <main className="kiosk-shell" style={themeStyle()}>
      <header className="kiosk-brand">
        <span>{kioskBrand.title}</span>
        <strong>{kioskBrand.subtitle}</strong>
      </header>
      <section className={`scan-panel scan-panel-${state.status}`}>
        <div className="reader-mark" aria-hidden="true" />
        <h1>{state.message}</h1>
        <p>{state.detail}</p>
      </section>
    </main>
  );
}

function themeStyle() {
  return {
    "--primary-color": kioskBrand.primaryColor,
    "--accent-color": kioskBrand.accentColor
  } as CSSProperties;
}

function apiBaseUrl() {
  return `${window.location.protocol}//${window.location.hostname}:8787`;
}

createRoot(document.getElementById("root")!).render(<KioskApp />);
