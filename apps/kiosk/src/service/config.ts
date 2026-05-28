export interface KioskConfig {
  kioskId: string;
  apiBaseUrl: string;
  kioskToken: string;
  databasePath: string;
  pythonPath: string;
  fingerprintBridgePath: string;
  commandPollSeconds: number;
  selfRestartDelayMs: number;
  systemRebootDelayMs: number;
}

export function loadConfig(env = process.env): KioskConfig {
  return {
    kioskId: required(env.KIOSK_ID, "KIOSK_ID"),
    apiBaseUrl: required(env.API_BASE_URL, "API_BASE_URL").replace(/\/$/, ""),
    kioskToken: required(env.KIOSK_TOKEN, "KIOSK_TOKEN"),
    databasePath: env.KIOSK_DB_PATH ?? "./kiosk-cache.sqlite",
    pythonPath: env.PYTHON_PATH ?? "python3",
    fingerprintBridgePath: env.FINGERPRINT_BRIDGE_PATH ?? "./fingerprint_bridge.py",
    commandPollSeconds: numberEnv(env.KIOSK_COMMAND_POLL_SECONDS, 10),
    selfRestartDelayMs: numberEnv(env.KIOSK_SELF_RESTART_DELAY_MS, 1000),
    systemRebootDelayMs: numberEnv(env.KIOSK_SYSTEM_REBOOT_DELAY_MS, 1000)
  };
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function numberEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
