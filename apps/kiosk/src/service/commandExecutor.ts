import { spawn } from "node:child_process";
import type { KioskCommand, KioskCommandAction } from "@frc-attendance/shared";
import type { KioskConfig } from "./config";

export function commandLabel(action: KioskCommandAction): string {
  if (action === "restart_display") return "Restart browser display";
  if (action === "restart_services") return "Restart kiosk services";
  return "Reboot system";
}

export async function executeKioskCommand(command: KioskCommand, config: KioskConfig): Promise<string> {
  if (command.action === "restart_display") {
    await runCommand("systemctl", ["--user", "restart", "frc-kiosk-ui"]);
    return "Restarted frc-kiosk-ui";
  }

  if (command.action === "restart_services") {
    await runCommand("systemctl", ["--user", "restart", "frc-bench-api", "frc-kiosk-ui", "frc-dashboard-ui"]);
    scheduleDetached("systemctl", ["--user", "restart", "frc-kiosk-service"], config.selfRestartDelayMs);
    return "Restarted kiosk UI, dashboard UI, bench API, and scheduled frc-kiosk-service restart";
  }

  if (command.action === "reboot_system") {
    scheduleDetached("sudo", ["-n", "systemctl", "reboot"], config.systemRebootDelayMs);
    return "Scheduled system reboot";
  }

  throw new Error(`Unsupported kiosk command action: ${command.action}`);
}

function runCommand(command: string, args: string[], timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out. ${output.trim()}`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}. ${output.trim()}`));
    });
  });
}

function scheduleDetached(command: string, args: string[], delayMs: number) {
  setTimeout(() => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
  }, delayMs);
}
