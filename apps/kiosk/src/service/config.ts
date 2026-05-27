export interface KioskConfig {
  kioskId: string;
  apiBaseUrl: string;
  kioskToken: string;
  databasePath: string;
  pythonPath: string;
  fingerprintBridgePath: string;
}

export function loadConfig(env = process.env): KioskConfig {
  return {
    kioskId: required(env.KIOSK_ID, "KIOSK_ID"),
    apiBaseUrl: required(env.API_BASE_URL, "API_BASE_URL").replace(/\/$/, ""),
    kioskToken: required(env.KIOSK_TOKEN, "KIOSK_TOKEN"),
    databasePath: env.KIOSK_DB_PATH ?? "./kiosk-cache.sqlite",
    pythonPath: env.PYTHON_PATH ?? "python3",
    fingerprintBridgePath: env.FINGERPRINT_BRIDGE_PATH ?? "./fingerprint_bridge.py"
  };
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}
