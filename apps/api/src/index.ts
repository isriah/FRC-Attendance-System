import { requireIsoTimestamp, requireNonEmptyString, type KioskSyncRequest } from "@frc-attendance/shared";
import { requireAdmin, requireKiosk, sha256Hex } from "./auth";
import { addManualEvent, syncKioskEvents } from "./attendanceStore";
import type { Env } from "./env";
import { buildLegacySheetExport } from "./export";
import { errorResponse, json, noContent, optionsResponse, readJson } from "./http";
import { claimPendingKioskCommands, completeKioskCommand, createKioskCommand, requireKioskCommandAction } from "./kioskCommands";
import { buildMemberAttendanceReport, buildPresenceReport } from "./reports";
import { syncRoster, type RosterMemberInput } from "./roster";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (request.method === "OPTIONS") return optionsResponse();

      const url = new URL(request.url);
      const route = `${request.method} ${url.pathname}`;

      if (route === "GET /health") return json({ ok: true, service: "frc-attendance-api" });

      if (route === "POST /kiosk/sync") {
        const kioskId = await requireKiosk(request, env);
        const body = await readJson<KioskSyncRequest>(request);
        if (body.kioskId !== kioskId) throw Object.assign(new Error("Kiosk token does not match kioskId"), { status: 403 });
        return json(await syncKioskEvents(env, kioskId, body.events));
      }

      if (route === "GET /kiosk/commands") {
        const kioskId = await requireKiosk(request, env);
        const requestedKioskId = url.searchParams.get("kioskId");
        if (requestedKioskId && requestedKioskId !== kioskId) throw Object.assign(new Error("Kiosk token does not match kioskId"), { status: 403 });
        return json({ commands: await claimPendingKioskCommands(env, kioskId) });
      }

      const kioskCommandCompletion = url.pathname.match(/^\/kiosk\/commands\/([^/]+)\/complete$/);
      if (request.method === "POST" && kioskCommandCompletion) {
        const kioskId = await requireKiosk(request, env);
        const body = await readJson<{ status: "completed" | "failed"; message?: string }>(request);
        const commandId = kioskCommandCompletion[1];
        if (!commandId) throw Object.assign(new Error("Kiosk command id is required"), { status: 400 });
        return json(await completeKioskCommand(env, kioskId, commandId, body));
      }

      if (route === "POST /admin/roster/sync") {
        await requireAdmin(request, env);
        const body = await readJson<{ members: RosterMemberInput[] }>(request);
        return json(await syncRoster(env, body.members));
      }

      if (route === "GET /admin/students") {
        await requireAdmin(request, env);
        const rows = await env.DB.prepare("SELECT student_id, first_name, last_name, active, roster_synced_at FROM students ORDER BY last_name, first_name").all();
        return json({ students: rows.results });
      }

      if (route === "POST /admin/kiosks") {
        await requireAdmin(request, env);
        const body = await readJson<{ kioskId: string; name: string; location?: string; token: string }>(request);
        const tokenHash = await sha256Hex(requireNonEmptyString(body.token, "token"));
        await env.DB.prepare(
          "INSERT INTO kiosks (kiosk_id, name, location, token_hash, active) VALUES (?, ?, ?, ?, 1) ON CONFLICT(kiosk_id) DO UPDATE SET name = excluded.name, location = excluded.location, token_hash = excluded.token_hash, active = 1"
        ).bind(requireNonEmptyString(body.kioskId, "kioskId"), requireNonEmptyString(body.name, "name"), body.location ?? null, tokenHash).run();
        return noContent();
      }

      if (route === "GET /admin/kiosks") {
        await requireAdmin(request, env);
        const rows = await env.DB.prepare("SELECT kiosk_id, name, location, active, last_seen_at FROM kiosks ORDER BY name").all();
        return json({ kiosks: rows.results });
      }

      const adminKioskCommand = url.pathname.match(/^\/admin\/kiosks\/([^/]+)\/commands$/);
      if (request.method === "POST" && adminKioskCommand) {
        const admin = await requireAdmin(request, env);
        const body = await readJson<{ action: unknown }>(request);
        const kioskIdParam = adminKioskCommand[1];
        if (!kioskIdParam) throw Object.assign(new Error("Kiosk id is required"), { status: 400 });
        const kioskId = decodeURIComponent(kioskIdParam);
        return json(await createKioskCommand(env, {
          kioskId,
          action: requireKioskCommandAction(body.action),
          requestedBy: admin.email
        }));
      }

      if (route === "POST /admin/manual-events") {
        const admin = await requireAdmin(request, env);
        const body = await readJson<{ studentId: string; occurredAt: string; action: "check_in" | "check_out"; reason: string }>(request);
        return json(await addManualEvent(env, {
          studentId: requireNonEmptyString(body.studentId, "studentId"),
          occurredAt: requireIsoTimestamp(body.occurredAt, "occurredAt"),
          action: body.action,
          reason: requireNonEmptyString(body.reason, "reason"),
          adminEmail: admin.email
        }));
      }

      if (route === "GET /admin/events") {
        await requireAdmin(request, env);
        const rows = await env.DB.prepare(
          "SELECT id, kiosk_id, local_event_id, student_id, occurred_at, synced_at, source, status, rejection_reason FROM scan_events ORDER BY occurred_at DESC LIMIT 250"
        ).all();
        return json({ events: rows.results });
      }

      if (route === "GET /admin/reports/sessions") {
        await requireAdmin(request, env);
        const rows = await env.DB.prepare(
          "SELECT student_id, meeting_date, check_in_at, check_out_at, status FROM attendance_sessions ORDER BY meeting_date DESC, student_id LIMIT 500"
        ).all();
        return json({ sessions: rows.results });
      }

      if (route === "GET /admin/reports/presence") {
        await requireAdmin(request, env);
        return json(await buildPresenceReport(env, url.searchParams.get("date") ?? undefined));
      }

      if (route === "GET /admin/reports/member") {
        await requireAdmin(request, env);
        return json(await buildMemberAttendanceReport(env, requireNonEmptyString(url.searchParams.get("studentId") ?? undefined, "studentId")));
      }

      if (route === "GET /admin/export/legacy-sheets") {
        await requireAdmin(request, env);
        return json(await buildLegacySheetExport(env));
      }

      return json({ error: "Not found" }, { status: 404 });
    } catch (error) {
      return errorResponse(error);
    }
  }
};
