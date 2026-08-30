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

interface LocalNetworkStatus {
  connected: boolean;
  connection?: string;
  type?: "wifi" | "ethernet";
}

interface WirelessNetwork {
  ssid: string;
  signal?: number;
  secured: boolean;
  active: boolean;
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
  const [localNetwork, setLocalNetwork] = useState<LocalNetworkStatus>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wifiNetworks, setWifiNetworks] = useState<WirelessNetwork[]>([]);
  const [selectedNetwork, setSelectedNetwork] = useState<WirelessNetwork>();
  const [password, setPassword] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--primary-color", kioskBrand.primaryColor);
    root.style.setProperty("--accent-color", kioskBrand.accentColor);
  }, []);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const next = await fetchNetworkStatus();
        if (!mounted) return;
        setLocalNetwork(next);
        if (next.connected && !settingsOpen) setSelectedNetwork(undefined);
      } catch {
        // The display service may still be starting. Keep attendance usable rather than assuming the Pi is offline.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3_000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [settingsOpen]);

  useEffect(() => {
    if (localNetwork?.connected !== false || settingsOpen) return;
    void openNetworkSettings();
  }, [localNetwork?.connected, settingsOpen]);

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

  const networkStatus = networkStatusFor(state.health, lastRefreshAt, localNetwork);
  const networkSetupRequired = localNetwork?.connected === false;

  async function openNetworkSettings() {
    setSettingsOpen(true);
    setSettingsError("");
    setPassword("");
    try {
      setWifiNetworks(await fetchWifiNetworks());
    } catch (error) {
      setSettingsError(errorMessage(error));
    }
  }

  async function connectWifi() {
    if (!selectedNetwork) return;
    setSettingsError("");
    setIsConnecting(true);
    try {
      const response = await fetch(`${networkServiceBaseUrl()}/kiosk/wifi-connect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ssid: selectedNetwork.ssid, password })
      });
      if (!response.ok) throw new Error(await responseError(response));
      const status = await waitForNetworkConnection();
      setLocalNetwork(status);
      setSettingsOpen(false);
      setSelectedNetwork(undefined);
      setPassword("");
    } catch (error) {
      setSettingsError(errorMessage(error));
    } finally {
      setIsConnecting(false);
    }
  }

  return (
    <main className={`kiosk-shell kiosk-shell-${state.status}`}>
      <NetworkStatusIcon status={networkStatus} onOpenSettings={() => void openNetworkSettings()} />
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
      {(settingsOpen || networkSetupRequired) && (
        <NetworkSettings
          required={networkSetupRequired}
          status={localNetwork}
          networks={wifiNetworks}
          selected={selectedNetwork}
          password={password}
          error={settingsError}
          isConnecting={isConnecting}
          onSelect={(network) => { setSelectedNetwork(network); setPassword(""); setSettingsError(""); }}
          onPasswordChange={setPassword}
          onRefresh={() => void openNetworkSettings()}
          onConnect={() => void connectWifi()}
          onClose={() => { if (!networkSetupRequired) setSettingsOpen(false); }}
        />
      )}
    </main>
  );
}

function NetworkStatusIcon({ status, onOpenSettings }: { status: NetworkStatus; onOpenSettings: () => void }) {
  const [holding, setHolding] = useState(false);
  useEffect(() => {
    if (!holding) return;
    const timer = window.setTimeout(() => {
      setHolding(false);
      onOpenSettings();
    }, 3_000);
    return () => window.clearTimeout(timer);
  }, [holding, onOpenSettings]);
  return (
    <button
      type="button"
      className={`network-status network-status-${status.kind} ${holding ? "network-status-holding" : ""}`}
      aria-label={`${status.label}. Hold for three seconds to open network settings.`}
      title={`${status.label}. Hold for settings.`}
      onPointerDown={() => setHolding(true)}
      onPointerUp={() => setHolding(false)}
      onPointerCancel={() => setHolding(false)}
      onPointerLeave={() => setHolding(false)}
    >
      <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <path d="M5.5 13.5C11.3 8.8 20.7 8.8 26.5 13.5" />
        <path d="M10.5 18.2C13.6 15.9 18.4 15.9 21.5 18.2" />
        <path d="M15.1 23.2C15.6 22.8 16.4 22.8 16.9 23.2" />
      </svg>
      <span className="network-status-dot" />
    </button>
  );
}

interface NetworkStatus {
  kind: "online" | "queued" | "offline" | "unknown";
  label: string;
}

function networkStatusFor(health: KioskDisplayHealth | undefined, lastRefreshAt: number | undefined, localNetwork: LocalNetworkStatus | undefined): NetworkStatus {
  if (localNetwork?.connected === false) return { kind: "offline", label: "No wired or Wi-Fi network connection" };
  const localLabel = localNetwork?.connected ? `${localNetwork.type === "ethernet" ? "Wired" : "Wi-Fi"} network connected${localNetwork.connection ? `: ${localNetwork.connection}` : ""}` : undefined;
  if (!lastRefreshAt || !health) return { kind: localLabel ? "online" : "unknown", label: localLabel ?? "Network status pending" };
  if (health.readerOnline === false) return { kind: "offline", label: `${localLabel ? `${localLabel}; ` : ""}fingerprint reader offline` };
  if (health.lastSyncError) return { kind: "offline", label: `${localLabel ? `${localLabel}; ` : ""}remote attendance sync offline` };
  if (health.pendingScanCount > 0) return { kind: "queued", label: `${localLabel ? `${localLabel}; ` : ""}${health.pendingScanCount} scan${health.pendingScanCount === 1 ? "" : "s"} queued` };
  return { kind: "online", label: localLabel ?? "Remote sync online" };
}

function NetworkSettings({ required, status, networks, selected, password, error, isConnecting, onSelect, onPasswordChange, onRefresh, onConnect, onClose }: {
  required: boolean;
  status: LocalNetworkStatus | undefined;
  networks: WirelessNetwork[];
  selected: WirelessNetwork | undefined;
  password: string;
  error: string;
  isConnecting: boolean;
  onSelect: (network: WirelessNetwork) => void;
  onPasswordChange: (value: string) => void;
  onRefresh: () => void;
  onConnect: () => void;
  onClose: () => void;
}) {
  return <section className="network-settings" aria-label="Network settings">
    <div className="network-settings-card">
      <header><h2>{required ? "Connect this kiosk" : "Network settings"}</h2><p>{status?.connected ? `Connected through ${status.connection ?? status.type ?? "the network"}.` : "Select the team Wi-Fi network to restore online sync."}</p></header>
      <div className="wifi-list" aria-label="Available Wi-Fi networks">
        {networks.length ? networks.map((network) => <button type="button" key={network.ssid} className={network.ssid === selected?.ssid ? "selected" : ""} onClick={() => onSelect(network)}>
          <span>{network.ssid}</span><small>{network.active ? "Connected" : `${network.signal ?? "?"}%${network.secured ? " · secured" : ""}`}</small>
        </button>) : <p className="empty-network-list">No Wi-Fi networks found yet.</p>}
      </div>
      {selected && <div className="wifi-password">
        <label htmlFor="wifi-password">{selected.secured ? `Password for ${selected.ssid}` : `${selected.ssid} does not require a password`}</label>
        {selected.secured && <><input id="wifi-password" type="password" inputMode="text" autoComplete="off" value={password} onChange={(event) => onPasswordChange(event.target.value)} readOnly />
          <TouchKeyboard value={password} onChange={onPasswordChange} /></>}
      </div>}
      {error && <p className="network-error" role="alert">{error}</p>}
      <footer><button type="button" className="secondary-button" onClick={onRefresh}>Refresh networks</button>{!required && <button type="button" className="secondary-button" onClick={onClose}>Back to attendance</button>}<button type="button" className="primary-button" disabled={!selected || isConnecting} onClick={onConnect}>{isConnecting ? "Connecting…" : "Connect"}</button></footer>
    </div>
  </section>;
}

function TouchKeyboard({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [shift, setShift] = useState(false);
  const rows = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890!@#$%"];
  const add = (character: string) => onChange(`${value}${shift ? character.toUpperCase() : character}`);
  return <div className="touch-keyboard" aria-label="On-screen password keyboard">
    {rows.map((row) => <div key={row}>{[...row].map((character) => <button type="button" key={character} onClick={() => add(character)}>{shift ? character.toUpperCase() : character}</button>)}</div>)}
    <div><button type="button" onClick={() => setShift(!shift)}>Shift</button><button type="button" onClick={() => add(" ")}>Space</button><button type="button" onClick={() => onChange(value.slice(0, -1))}>Delete</button></div>
  </div>;
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
    networkServiceBaseUrl(),
    `${window.location.protocol}//${window.location.hostname}:8787`
  ];
}

function networkServiceBaseUrl() {
  return `${window.location.protocol}//127.0.0.1:8788`;
}

async function fetchNetworkStatus(): Promise<LocalNetworkStatus> {
  const response = await fetch(`${networkServiceBaseUrl()}/kiosk/network-status`, { cache: "no-store" });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<LocalNetworkStatus>;
}

async function fetchWifiNetworks(): Promise<WirelessNetwork[]> {
  const response = await fetch(`${networkServiceBaseUrl()}/kiosk/wifi-networks`, { cache: "no-store" });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<WirelessNetwork[]>;
}

async function waitForNetworkConnection(): Promise<LocalNetworkStatus> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const status = await fetchNetworkStatus();
    if (status.connected) return status;
    await new Promise((resolve) => window.setTimeout(resolve, 1_000));
  }
  throw new Error("The Wi-Fi connection was not confirmed. Check the password and try again.");
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string };
    return body.error ?? `Request failed: ${response.status}`;
  } catch {
    return `Request failed: ${response.status}`;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Network setup could not be completed.";
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
