import type { KioskCommand, KioskCommandAction, KioskCommandStatus } from "@frc-attendance/shared";
import type { Env } from "./env";

const allowedActions: KioskCommandAction[] = ["restart_display", "restart_services", "reboot_system"];
const terminalStatuses: KioskCommandStatus[] = ["completed", "failed"];

export function requireKioskCommandAction(value: unknown): KioskCommandAction {
  if (typeof value === "string" && allowedActions.includes(value as KioskCommandAction)) return value as KioskCommandAction;
  throw Object.assign(new Error("Unsupported kiosk command action"), { status: 400 });
}

export async function createKioskCommand(env: Env, input: { kioskId: string; action: KioskCommandAction; requestedBy?: string }): Promise<KioskCommand> {
  const kiosk = await env.DB.prepare("SELECT kiosk_id FROM kiosks WHERE kiosk_id = ? AND active = 1").bind(input.kioskId).first<{ kiosk_id: string }>();
  if (!kiosk) throw Object.assign(new Error("Kiosk not found or inactive"), { status: 404 });

  const now = new Date().toISOString();
  const command: KioskCommand = {
    id: crypto.randomUUID(),
    kioskId: input.kioskId,
    action: input.action,
    status: "pending",
    requestedBy: input.requestedBy,
    requestedAt: now
  };

  await env.DB.prepare(
    "INSERT INTO kiosk_commands (id, kiosk_id, action, status, requested_by, requested_at) VALUES (?, ?, ?, 'pending', ?, ?)"
  ).bind(command.id, command.kioskId, command.action, command.requestedBy ?? null, command.requestedAt).run();

  return command;
}

export async function claimPendingKioskCommands(env: Env, kioskId: string): Promise<KioskCommand[]> {
  const now = new Date().toISOString();
  const rows = await env.DB.prepare(
    "SELECT * FROM kiosk_commands WHERE kiosk_id = ? AND status = 'pending' ORDER BY requested_at ASC LIMIT 5"
  ).bind(kioskId).all<KioskCommandRow>();
  const commands = rows.results.map(rowToCommand);

  for (const command of commands) {
    await env.DB.prepare("UPDATE kiosk_commands SET status = 'running', claimed_at = ? WHERE id = ? AND status = 'pending'")
      .bind(now, command.id)
      .run();
    command.status = "running";
    command.claimedAt = now;
  }

  return commands;
}

export async function completeKioskCommand(env: Env, kioskId: string, commandId: string, input: { status: KioskCommandStatus; message?: string }): Promise<KioskCommand> {
  if (!terminalStatuses.includes(input.status)) throw Object.assign(new Error("Command completion status must be completed or failed"), { status: 400 });

  const now = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE kiosk_commands SET status = ?, completed_at = ?, message = ? WHERE id = ? AND kiosk_id = ?"
  ).bind(input.status, now, input.message ?? null, commandId, kioskId).run();

  const row = await env.DB.prepare("SELECT * FROM kiosk_commands WHERE id = ? AND kiosk_id = ?").bind(commandId, kioskId).first<KioskCommandRow>();
  if (!row) throw Object.assign(new Error("Kiosk command not found"), { status: 404 });
  return rowToCommand(row);
}

function rowToCommand(row: KioskCommandRow): KioskCommand {
  return {
    id: row.id,
    kioskId: row.kiosk_id,
    action: row.action as KioskCommandAction,
    status: row.status as KioskCommandStatus,
    requestedBy: row.requested_by ?? undefined,
    requestedAt: row.requested_at,
    claimedAt: row.claimed_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    message: row.message ?? undefined
  };
}

interface KioskCommandRow {
  id: string;
  kiosk_id: string;
  action: string;
  status: string;
  requested_by: string | null;
  requested_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  message: string | null;
}
