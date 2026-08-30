import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface NetworkStatus {
  connected: boolean;
  connection?: string;
  device?: string;
  type?: "wifi" | "ethernet";
}

export interface WirelessNetwork {
  ssid: string;
  signal?: number;
  secured: boolean;
  active: boolean;
}

export interface NetworkManager {
  status(): Promise<NetworkStatus>;
  listWifi(): Promise<WirelessNetwork[]>;
  connectWifi(ssid: string, password: string): Promise<void>;
}

export function createNetworkManager(run = runNmcli): NetworkManager {
  return {
    async status() {
      const output = await run(["-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device", "status"]);
      return parseNetworkStatus(output);
    },
    async listWifi() {
      const output = await run(["-t", "--escape", "yes", "-f", "SSID,SIGNAL,SECURITY,IN-USE", "device", "wifi", "list", "--rescan", "auto"]);
      return parseWifiNetworks(output);
    },
    async connectWifi(ssid, password) {
      if (!ssid.trim()) throw new Error("Choose a Wi-Fi network first.");
      const args = ["--wait", "30", "device", "wifi", "connect", ssid];
      if (password) args.push("password", password);
      await run(args);
    }
  };
}

export function parseNetworkStatus(output: string): NetworkStatus {
  for (const line of output.split(/\r?\n/)) {
    const [device, type, state, connection] = splitNmcliLine(line);
    if (!device || device === "lo" || state !== "connected") continue;
    if (type === "wifi" || type === "ethernet") {
      return { connected: true, device, type, connection: connection || undefined };
    }
  }
  return { connected: false };
}

export function parseWifiNetworks(output: string): WirelessNetwork[] {
  const networks = new Map<string, WirelessNetwork>();
  for (const line of output.split(/\r?\n/)) {
    const [ssid, signal, security, inUse] = splitNmcliLine(line);
    if (!ssid) continue;
    const current = networks.get(ssid);
    const candidate: WirelessNetwork = {
      ssid,
      signal: Number.isFinite(Number(signal)) ? Number(signal) : undefined,
      secured: Boolean(security && security !== "--"),
      active: inUse === "*"
    };
    if (!current || candidate.active || (candidate.signal ?? -1) > (current.signal ?? -1)) networks.set(ssid, candidate);
  }
  return [...networks.values()].sort((a, b) => Number(b.active) - Number(a.active) || (b.signal ?? -1) - (a.signal ?? -1) || a.ssid.localeCompare(b.ssid));
}

function splitNmcliLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let escaped = false;
  for (const character of line) {
    if (escaped) {
      value += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === ":") {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

async function runNmcli(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("nmcli", args, { timeout: 35_000, maxBuffer: 512 * 1024 });
    return stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`NetworkManager could not complete that request: ${message}`);
  }
}
