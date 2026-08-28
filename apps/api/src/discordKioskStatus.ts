import type { Env } from "./env";

const defaultOfflineThresholdMinutes = 1;
const maxDiscordContentLength = 2000;

type KioskStatus = "online" | "degraded" | "offline" | "inactive" | "unknown";
type OperationStatus = "idle" | "creating" | "editing" | "error";

interface KioskRow {
  kiosk_id: string;
  name: string;
  location: string | null;
  active: number;
  last_seen_at: string | null;
  last_heartbeat_at: string | null;
  reader_online: number | null;
  pending_scan_count: number | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
}

interface StatusSnapshotEntry {
  key: string;
  changedAt: string;
}

type StatusSnapshot = Record<string, StatusSnapshotEntry>;

interface MessageRow {
  channel_id: string;
  message_id: string | null;
  status_snapshot_json: string;
  rendered_hash: string | null;
  operation_status: OperationStatus;
  attempts: number;
}

export interface DiscordKioskStatusRefreshResult {
  notificationKind: "discord_kiosk_status";
  checkedAt: string;
  providerConfigured: boolean;
  offlineThresholdMinutes: number;
  kioskCount: number;
  status: "created" | "edited" | "unchanged" | "skipped_locked" | "error" | "disabled";
  messageId?: string | null;
  error?: string;
}

interface KioskRenderedStatus {
  kioskId: string;
  name: string;
  location: string | null;
  status: KioskStatus;
  statusKey: string;
  changedAt: string;
  details: string[];
}

export async function refreshDiscordKioskStatusMessage(
  env: Env,
  now = new Date()
): Promise<DiscordKioskStatusRefreshResult> {
  const provider = discordBotMessageProvider(env);
  const offlineThresholdMinutes = kioskDiscordOfflineThresholdMinutes(env);
  const checkedAt = now.toISOString();
  if (!provider.configured) {
    return {
      notificationKind: "discord_kiosk_status",
      checkedAt,
      providerConfigured: false,
      offlineThresholdMinutes,
      kioskCount: 0,
      status: "disabled",
      error: "Discord kiosk status requires DISCORD_BOT_TOKEN and DISCORD_ATTENDANCE_CHANNEL_ID"
    };
  }

  const row = await getMessageRow(env, provider.channelId);
  const kiosks = await listKiosks(env);
  const previousSnapshot = parseSnapshot(row?.status_snapshot_json);
  const snapshot = buildSnapshot(kiosks, previousSnapshot, now, offlineThresholdMinutes);
  const rendered = renderKioskStatusMessage(snapshot.renderedStatuses, offlineThresholdMinutes);
  const renderedHash = await sha256Hex(rendered);

  if (!row?.message_id) {
    const claimed = await claimCreate(env, provider.channelId, checkedAt, row);
    if (!claimed) {
      return {
        notificationKind: "discord_kiosk_status",
        checkedAt,
        providerConfigured: true,
        offlineThresholdMinutes,
        kioskCount: kiosks.length,
        status: "skipped_locked",
        messageId: row?.message_id ?? null
      };
    }

    try {
      const created = await provider.create(rendered);
      await markSuccess(env, provider.channelId, created.messageId, snapshot.nextSnapshot, renderedHash, checkedAt);
      return {
        notificationKind: "discord_kiosk_status",
        checkedAt,
        providerConfigured: true,
        offlineThresholdMinutes,
        kioskCount: kiosks.length,
        status: "created",
        messageId: created.messageId
      };
    } catch (error) {
      const message = errorMessage(error);
      await markError(env, provider.channelId, message, checkedAt);
      return {
        notificationKind: "discord_kiosk_status",
        checkedAt,
        providerConfigured: true,
        offlineThresholdMinutes,
        kioskCount: kiosks.length,
        status: "error",
        error: message
      };
    }
  }

  if (row.rendered_hash === renderedHash) {
    await markUnchanged(env, provider.channelId, checkedAt);
    return {
      notificationKind: "discord_kiosk_status",
      checkedAt,
      providerConfigured: true,
      offlineThresholdMinutes,
      kioskCount: kiosks.length,
      status: "unchanged",
      messageId: row.message_id
    };
  }

  const claimed = await claimEdit(env, provider.channelId, row.rendered_hash, checkedAt);
  if (!claimed) {
    return {
      notificationKind: "discord_kiosk_status",
      checkedAt,
      providerConfigured: true,
      offlineThresholdMinutes,
      kioskCount: kiosks.length,
      status: "skipped_locked",
      messageId: row.message_id
    };
  }

  try {
    await provider.edit(row.message_id, rendered);
    await markSuccess(env, provider.channelId, row.message_id, snapshot.nextSnapshot, renderedHash, checkedAt);
    return {
      notificationKind: "discord_kiosk_status",
      checkedAt,
      providerConfigured: true,
      offlineThresholdMinutes,
      kioskCount: kiosks.length,
      status: "edited",
      messageId: row.message_id
    };
  } catch (error) {
    const message = errorMessage(error);
    await markError(env, provider.channelId, message, checkedAt);
    return {
      notificationKind: "discord_kiosk_status",
      checkedAt,
      providerConfigured: true,
      offlineThresholdMinutes,
      kioskCount: kiosks.length,
      status: "error",
      messageId: row.message_id,
      error: message
    };
  }
}

function buildSnapshot(
  kiosks: KioskRow[],
  previousSnapshot: StatusSnapshot,
  now: Date,
  offlineThresholdMinutes: number
) {
  const nextSnapshot: StatusSnapshot = {};
  const renderedStatuses = kiosks.map((kiosk) => {
    const computed = kioskStatus(kiosk, now, offlineThresholdMinutes);
    const previous = previousSnapshot[kiosk.kiosk_id];
    const changedAt = previous?.key === computed.statusKey ? previous.changedAt : now.toISOString();
    nextSnapshot[kiosk.kiosk_id] = { key: computed.statusKey, changedAt };
    return {
      kioskId: kiosk.kiosk_id,
      name: kiosk.name,
      location: kiosk.location,
      status: computed.status,
      statusKey: computed.statusKey,
      changedAt,
      details: computed.details
    };
  });
  return { nextSnapshot, renderedStatuses };
}

function kioskStatus(kiosk: KioskRow, now: Date, offlineThresholdMinutes: number): Omit<KioskRenderedStatus, "kioskId" | "name" | "location" | "changedAt"> {
  const pendingScanCount = Math.max(0, Math.floor(Number(kiosk.pending_scan_count) || 0));
  const syncError = kiosk.last_sync_error?.trim() ?? "";
  const heartbeatAt = timestampOrNull(kiosk.last_heartbeat_at);
  const thresholdMs = offlineThresholdMinutes * 60_000;

  if (!kiosk.active) {
    return {
      status: "inactive",
      statusKey: `inactive|pending:${pendingScanCount}|reader:${readerKey(kiosk.reader_online)}|syncError:${syncError}`,
      details: ["inactive registration"]
    };
  }
  if (!heartbeatAt) {
    return {
      status: "unknown",
      statusKey: `unknown|pending:${pendingScanCount}|reader:${readerKey(kiosk.reader_online)}|syncError:${syncError}`,
      details: ["no heartbeat yet"]
    };
  }
  if (now.getTime() - heartbeatAt.getTime() > thresholdMs) {
    return {
      status: "offline",
      statusKey: `offline|pending:${pendingScanCount}|reader:${readerKey(kiosk.reader_online)}|syncError:${syncError}`,
      details: [`heartbeat older than ${offlineThresholdMinutes} min`]
    };
  }

  const degradedDetails: string[] = [];
  if (kiosk.reader_online === 0) degradedDetails.push("reader offline");
  if (pendingScanCount > 0) degradedDetails.push(`${pendingScanCount} queued scan${pendingScanCount === 1 ? "" : "s"}`);
  if (syncError) degradedDetails.push(`sync error: ${truncate(syncError, 140)}`);
  if (degradedDetails.length > 0) {
    return {
      status: "degraded",
      statusKey: `degraded|pending:${pendingScanCount}|reader:${readerKey(kiosk.reader_online)}|syncError:${syncError}`,
      details: degradedDetails
    };
  }
  return {
    status: "online",
    statusKey: `online|pending:0|reader:${readerKey(kiosk.reader_online)}|syncError:`,
    details: [kiosk.reader_online === null ? "reader unknown" : "reader online"]
  };
}

function renderKioskStatusMessage(kiosks: KioskRenderedStatus[], offlineThresholdMinutes: number): string {
  const lines = [
    "**FRC Attendance kiosk status**",
    `Offline threshold: ${offlineThresholdMinutes} min without a kiosk health heartbeat.`,
    ""
  ];

  if (kiosks.length === 0) {
    lines.push("No kiosks are registered yet.");
  } else {
    for (const kiosk of kiosks) {
      const location = kiosk.location ? ` (${kiosk.location})` : "";
      lines.push(`${statusIcon(kiosk.status)} **${kiosk.name}** \`${kiosk.kioskId}\`${location}`);
      lines.push(`Status: ${statusLabel(kiosk.status)} since ${discordTimestamp(kiosk.changedAt)}`);
      lines.push(`Details: ${kiosk.details.join("; ")}`);
      lines.push("");
    }
  }

  const content = lines.join("\n").trim();
  return content.length <= maxDiscordContentLength ? content : `${content.slice(0, maxDiscordContentLength - 20)}\n...truncated`;
}

function discordBotMessageProvider(env: Env) {
  const token = env.DISCORD_BOT_TOKEN?.trim();
  const channelId = normalizeDiscordId(env.DISCORD_ATTENDANCE_CHANNEL_ID);
  if (!token || !channelId) {
    return {
      configured: false as const,
      channelId: channelId ?? "",
      async create(_content: string): Promise<{ messageId: string }> {
        throw new Error("Discord bot delivery is not configured");
      },
      async edit(_messageId: string, _content: string): Promise<void> {
        throw new Error("Discord bot delivery is not configured");
      }
    };
  }
  return {
    configured: true as const,
    channelId,
    async create(content: string): Promise<{ messageId: string }> {
      const response = await discordFetch(token, `https://discord.com/api/v10/channels/${channelId}/messages`, "POST", content);
      const messageId = providerMessageIdFromResponse(await response.text());
      if (!messageId) throw new Error("Discord bot API response did not include a message id");
      return { messageId };
    },
    async edit(messageId: string, content: string): Promise<void> {
      await discordFetch(token, `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, "PATCH", content);
    }
  };
}

async function discordFetch(token: string, url: string, method: "POST" | "PATCH", content: string): Promise<Response> {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bot ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      content,
      allowed_mentions: { parse: [] }
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Discord bot API returned ${response.status}`);
  }
  return response;
}

async function listKiosks(env: Env): Promise<KioskRow[]> {
  const rows = await env.DB.prepare(`
    SELECT kiosk_id, name, location, active, last_seen_at, last_heartbeat_at, reader_online, pending_scan_count, last_sync_at, last_sync_error
    FROM kiosks
    ORDER BY active DESC, name, kiosk_id
  `).all<KioskRow>();
  return rows.results;
}

async function getMessageRow(env: Env, channelId: string): Promise<MessageRow | null> {
  return await env.DB.prepare(`
    SELECT channel_id, message_id, status_snapshot_json, rendered_hash, operation_status, attempts
    FROM discord_kiosk_status_messages
    WHERE channel_id = ?
  `).bind(channelId).first<MessageRow>();
}

async function claimCreate(env: Env, channelId: string, now: string, row: MessageRow | null): Promise<boolean> {
  if (!row) {
    const insert = await env.DB.prepare(`
      INSERT INTO discord_kiosk_status_messages (
        channel_id, operation_status, attempts, locked_at, last_attempt_at, created_at, updated_at
      ) VALUES (?, 'creating', 1, ?, ?, ?, ?)
      ON CONFLICT(channel_id) DO NOTHING
    `).bind(channelId, now, now, now, now).run();
    return changed(insert);
  }
  if (row.operation_status !== "error") return false;
  const update = await env.DB.prepare(`
    UPDATE discord_kiosk_status_messages
    SET operation_status = 'creating',
      attempts = attempts + 1,
      locked_at = ?,
      last_attempt_at = ?,
      error_message = NULL,
      updated_at = ?
    WHERE channel_id = ?
      AND message_id IS NULL
      AND operation_status = 'error'
  `).bind(now, now, now, channelId).run();
  return changed(update);
}

async function claimEdit(env: Env, channelId: string, renderedHash: string | null, now: string): Promise<boolean> {
  const hashCondition = renderedHash === null ? "rendered_hash IS NULL" : "rendered_hash = ?";
  const statement = env.DB.prepare(`
    UPDATE discord_kiosk_status_messages
    SET operation_status = 'editing',
      attempts = attempts + 1,
      locked_at = ?,
      last_attempt_at = ?,
      error_message = NULL,
      updated_at = ?
    WHERE channel_id = ?
      AND message_id IS NOT NULL
      AND ${hashCondition}
      AND operation_status IN ('idle', 'error')
  `);
  const update = renderedHash === null
    ? await statement.bind(now, now, now, channelId).run()
    : await statement.bind(now, now, now, channelId, renderedHash).run();
  return changed(update);
}

async function markSuccess(env: Env, channelId: string, messageId: string, snapshot: StatusSnapshot, renderedHash: string, now: string) {
  await env.DB.prepare(`
    UPDATE discord_kiosk_status_messages
    SET message_id = ?,
      status_snapshot_json = ?,
      rendered_hash = ?,
      operation_status = 'idle',
      locked_at = NULL,
      last_success_at = ?,
      error_message = NULL,
      updated_at = ?
    WHERE channel_id = ?
  `).bind(messageId, JSON.stringify(snapshot), renderedHash, now, now, channelId).run();
}

async function markUnchanged(env: Env, channelId: string, now: string) {
  await env.DB.prepare(`
    UPDATE discord_kiosk_status_messages
    SET operation_status = 'idle',
      locked_at = NULL,
      last_success_at = ?,
      updated_at = ?
    WHERE channel_id = ?
  `).bind(now, now, channelId).run();
}

async function markError(env: Env, channelId: string, message: string, now: string) {
  await env.DB.prepare(`
    UPDATE discord_kiosk_status_messages
    SET operation_status = 'error',
      locked_at = NULL,
      error_message = ?,
      updated_at = ?
    WHERE channel_id = ?
  `).bind(message.slice(0, 1000), now, channelId).run();
}

function parseSnapshot(value: string | undefined | null): StatusSnapshot {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as StatusSnapshot;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function kioskDiscordOfflineThresholdMinutes(env: Env): number {
  const raw = env.KIOSK_DISCORD_OFFLINE_THRESHOLD_MINUTES?.trim();
  if (!raw) return defaultOfflineThresholdMinutes;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 1440) {
    throw new Error("KIOSK_DISCORD_OFFLINE_THRESHOLD_MINUTES must be an integer from 1 to 1440");
  }
  return value;
}

function timestampOrNull(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function readerKey(value: number | null): string {
  return value === null || value === undefined ? "unknown" : value ? "online" : "offline";
}

function statusIcon(status: KioskStatus): string {
  if (status === "online") return ":green_circle:";
  if (status === "degraded") return ":yellow_circle:";
  if (status === "offline") return ":red_circle:";
  if (status === "inactive") return ":black_circle:";
  return ":white_circle:";
}

function statusLabel(status: KioskStatus): string {
  if (status === "online") return "Online";
  if (status === "degraded") return "Degraded";
  if (status === "offline") return "Offline";
  if (status === "inactive") return "Inactive";
  return "Unknown";
}

function discordTimestamp(value: string): string {
  const seconds = Math.floor(new Date(value).getTime() / 1000);
  return Number.isFinite(seconds) ? `<t:${seconds}:f>` : value;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function normalizeDiscordId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^\d{5,25}$/.test(normalized) ? normalized : null;
}

function providerMessageIdFromResponse(text: string): string | undefined {
  if (!text.trim()) return undefined;
  try {
    const parsed = JSON.parse(text) as { id?: unknown };
    return typeof parsed.id === "string" && parsed.id.trim() ? parsed.id.trim() : undefined;
  } catch {
    return undefined;
  }
}

async function sha256Hex(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function changed(result: unknown): boolean {
  const row = result as { changes?: number; meta?: { changes?: number } };
  return Number(row.changes ?? row.meta?.changes ?? 0) > 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
