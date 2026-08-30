export type KioskCommandAction = "restart_display" | "restart_services" | "reboot_system" | "reset_network_settings_pin";
export type KioskCommandStatus = "pending" | "running" | "completed" | "failed";

export interface KioskCommandRow {
  id: string;
  kioskId: string;
  action: KioskCommandAction;
  status: KioskCommandStatus;
  requestedBy?: string;
  requestedAt: string;
  claimedAt?: string;
  completedAt?: string;
  message?: string;
}

export function visibleKioskCommands(commands: KioskCommandRow[], expanded: boolean) {
  return expanded ? commands : commands.slice(0, 1);
}

export function olderKioskCommandCount(commands: KioskCommandRow[]) {
  return Math.max(0, commands.length - 1);
}

export function kioskCommandHistoryToggleLabel(commands: KioskCommandRow[], expanded: boolean) {
  const olderCount = olderKioskCommandCount(commands);
  if (olderCount === 0) return "";
  return expanded ? `Hide ${olderCount} older ${olderCount === 1 ? "command" : "commands"}` : `Show ${olderCount} older ${olderCount === 1 ? "command" : "commands"}`;
}
