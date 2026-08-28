import { requireIsoTimestamp, requireNonEmptyString, type KioskHealthReport, type KioskSyncRequest } from "@frc-attendance/shared";
import { listAdminUsers, requireAdmin, requireKiosk, sha256Hex, upsertAdminUser } from "./auth";
import { addManualEvent, clearAttendanceForDate, clearMemberAttendanceSourceData, removeMemberFromMeeting, syncKioskEvents } from "./attendanceStore";
import type { Env } from "./env";
import { buildLegacySheetExport } from "./export";
import { handleDiscordInteraction } from "./discordInteractions";
import { approveAttendanceContest, listAttendanceContests, reviewAttendanceContest, sendDiscordBotMissingMemberNotifications, sendScheduledDiscordBotMissingMemberNotifications, type DiscordBotMissingMemberNotificationInput } from "./discordAttendance";
import { refreshDiscordKioskStatusMessage } from "./discordKioskStatus";
import { syncDiscordScheduledEvents, type DiscordScheduledEventSyncInput } from "./discordScheduledEvents";
import { errorResponse, json, noContent, optionsResponse, readJson } from "./http";
import { claimPendingKioskCommands, completeKioskCommand, createKioskCommand, listRecentKioskCommands, requireKioskCommandAction } from "./kioskCommands";
import { bulkDeleteScheduledMeetings, convertUnscheduledAttendanceToMeeting, createScheduledMeeting, deleteScheduledMeeting, listScheduledMeetings, updateScheduledMeeting, type BulkScheduledMeetingDeleteInput, type ScheduledMeetingInput } from "./meetings";
import { sendDiscordMissingMemberNotifications, sendDiscordTestNotification, sendMeetingAbsenceNotifications, sendMemberAttendanceReportNotification, type DiscordMissingMemberNotificationInput, type DiscordTestNotificationInput, type MeetingAbsenceNotificationInput, type MemberAttendanceReportNotificationInput } from "./notifications";
import { buildAttendanceSessionReport, buildMeetingAbsenceReport, buildMeetingSummaryReport, buildMemberAttendanceReport, buildPresenceReport, buildRosterAttendanceSummary, reportDateRangeFromSearchParams } from "./reports";
import { deactivateMember, hardDeleteMember, listActiveRoster, listRosterMembers, reactivateMember, syncRoster, updateStudentDiscordUserId, updateStudentEmail, type RosterMemberInput } from "./roster";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (request.method === "OPTIONS") return optionsResponse();

      const url = new URL(request.url);
      const route = `${request.method} ${url.pathname}`;

      if (route === "GET /health") return json({ ok: true, service: "frc-attendance-api" });

      if (route === "POST /discord/interactions") {
        return handleDiscordInteraction(request, env);
      }

      if (route === "POST /kiosk/sync") {
        const kioskId = await requireKiosk(request, env);
        const body = await readJson<KioskSyncRequest>(request);
        if (body.kioskId !== kioskId) throw Object.assign(new Error("Kiosk token does not match kioskId"), { status: 403 });
        return json(await syncKioskEvents(env, kioskId, body.events));
      }

      if (route === "GET /kiosk/roster") {
        await requireKiosk(request, env);
        return json(await listActiveRoster(env));
      }

      if (route === "POST /kiosk/health") {
        const kioskId = await requireKiosk(request, env);
        const body = await readJson<KioskHealthReport>(request);
        if (body.kioskId !== kioskId) throw Object.assign(new Error("Kiosk token does not match kioskId"), { status: 403 });
        await updateKioskHealth(env, body);
        return noContent();
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

      if (route === "GET /admin/members" || route === "GET /admin/students") {
        await requireAdmin(request, env);
        const active = url.searchParams.get("active");
        const activeFilter = active === null ? undefined : active === "true" || active === "1";
        const members = await listRosterMembers(env, activeFilter);
        return json(route === "GET /admin/members" ? { members } : { students: members.map(memberToLegacyStudent), members });
      }

      if (route === "GET /admin/admin-users") {
        await requireAdmin(request, env);
        return json({ adminUsers: await listAdminUsers(env) });
      }

      const adminUser = url.pathname.match(/^\/admin\/admin-users\/([^/]+)$/);
      if (request.method === "PUT" && adminUser) {
        await requireAdmin(request, env);
        const email = adminUser[1];
        if (!email) throw Object.assign(new Error("Admin email is required"), { status: 400 });
        const body = await readJson<{ role?: unknown; active?: unknown }>(request);
        return json(await upsertAdminUser(env, decodeURIComponent(email), body));
      }

      const adminMemberEmail = url.pathname.match(/^\/admin\/(?:members|students)\/([^/]+)\/email$/);
      if (request.method === "PUT" && adminMemberEmail) {
        await requireAdmin(request, env);
        const memberId = adminMemberEmail[1];
        if (!memberId) throw Object.assign(new Error("Member id is required"), { status: 400 });
        const body = await readJson<{ email?: string | null }>(request);
        return json(await updateStudentEmail(env, decodeURIComponent(memberId), body.email ?? null));
      }

      const adminMemberDiscord = url.pathname.match(/^\/admin\/(?:members|students)\/([^/]+)\/discord$/);
      if (request.method === "PUT" && adminMemberDiscord) {
        await requireAdmin(request, env);
        const memberId = adminMemberDiscord[1];
        if (!memberId) throw Object.assign(new Error("Member id is required"), { status: 400 });
        const body = await readJson<{ discordUserId?: string | null; discord_user_id?: string | null }>(request);
        return json(await updateStudentDiscordUserId(env, decodeURIComponent(memberId), body.discordUserId ?? body.discord_user_id ?? null));
      }

      const adminMemberDeactivate = url.pathname.match(/^\/admin\/(?:members|students)\/([^/]+)\/deactivate$/);
      if (request.method === "POST" && adminMemberDeactivate) {
        await requireAdmin(request, env);
        const memberId = adminMemberDeactivate[1];
        if (!memberId) throw Object.assign(new Error("Member id is required"), { status: 400 });
        return json(await deactivateMember(env, decodeURIComponent(memberId)));
      }

      const adminMemberReactivate = url.pathname.match(/^\/admin\/(?:members|students)\/([^/]+)\/reactivate$/);
      if (request.method === "POST" && adminMemberReactivate) {
        await requireAdmin(request, env);
        const memberId = adminMemberReactivate[1];
        if (!memberId) throw Object.assign(new Error("Member id is required"), { status: 400 });
        return json(await reactivateMember(env, decodeURIComponent(memberId)));
      }

      const adminMember = url.pathname.match(/^\/admin\/(?:members|students)\/([^/]+)$/);
      if (request.method === "DELETE" && adminMember) {
        await requireAdmin(request, env);
        const memberId = adminMember[1];
        if (!memberId) throw Object.assign(new Error("Member id is required"), { status: 400 });
        return json(await hardDeleteMember(env, decodeURIComponent(memberId)));
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
        const rows = await env.DB.prepare(`
          SELECT kiosk_id, name, location, active, last_seen_at, last_heartbeat_at, reader_online, pending_scan_count, last_sync_at, last_sync_error
          FROM kiosks
          ORDER BY name
        `).all();
        return json({ kiosks: rows.results });
      }

      if (route === "GET /admin/kiosk-commands") {
        await requireAdmin(request, env);
        return json({ commands: await listRecentKioskCommands(env, Number(url.searchParams.get("limit") ?? 50)) });
      }

      if (route === "GET /admin/meetings") {
        await requireAdmin(request, env);
        return json({ meetings: await listScheduledMeetings(env) });
      }

      if (route === "POST /admin/meetings") {
        await requireAdmin(request, env);
        const body = await readJson<ScheduledMeetingInput>(request);
        return json(await createScheduledMeeting(env, body), { status: 201 });
      }

      if (route === "POST /admin/meetings/bulk-delete") {
        await requireAdmin(request, env);
        const body = await readJson<BulkScheduledMeetingDeleteInput>(request);
        return json(await bulkDeleteScheduledMeetings(env, body));
      }

      if (route === "POST /admin/meetings/discord/sync") {
        await requireAdmin(request, env);
        const body = await readJson<DiscordScheduledEventSyncInput>(request);
        return json(await syncDiscordScheduledEvents(env, body));
      }

      if (route === "POST /admin/meetings/convert-unscheduled") {
        await requireAdmin(request, env);
        const body = await readJson<ScheduledMeetingInput>(request);
        return json(await convertUnscheduledAttendanceToMeeting(env, body), { status: 201 });
      }

      const adminMeeting = url.pathname.match(/^\/admin\/meetings\/([^/]+)$/);
      if (adminMeeting && request.method === "PUT") {
        await requireAdmin(request, env);
        const meetingId = adminMeeting[1];
        if (!meetingId) throw Object.assign(new Error("Scheduled meeting id is required"), { status: 400 });
        const body = await readJson<ScheduledMeetingInput>(request);
        return json(await updateScheduledMeeting(env, decodeURIComponent(meetingId), body));
      }

      if (adminMeeting && request.method === "DELETE") {
        await requireAdmin(request, env);
        const meetingId = adminMeeting[1];
        if (!meetingId) throw Object.assign(new Error("Scheduled meeting id is required"), { status: 400 });
        await deleteScheduledMeeting(env, decodeURIComponent(meetingId));
        return noContent();
      }

      const adminMeetingDiscordSync = url.pathname.match(/^\/admin\/meetings\/([^/]+)\/discord\/sync$/);
      if (request.method === "POST" && adminMeetingDiscordSync) {
        await requireAdmin(request, env);
        const meetingId = adminMeetingDiscordSync[1];
        if (!meetingId) throw Object.assign(new Error("Scheduled meeting id is required"), { status: 400 });
        const body = await readJson<Omit<DiscordScheduledEventSyncInput, "meetingIds">>(request);
        return json(await syncDiscordScheduledEvents(env, { ...body, meetingIds: [decodeURIComponent(meetingId)] }));
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
        const body = await readJson<{ memberId?: string; studentId?: string; occurredAt: string; action: "check_in" | "check_out"; reason: string }>(request);
        const memberId = body.memberId ?? body.studentId;
        return json(await addManualEvent(env, {
          memberId: requireNonEmptyString(memberId, "memberId"),
          occurredAt: requireIsoTimestamp(body.occurredAt, "occurredAt"),
          action: body.action,
          reason: requireNonEmptyString(body.reason, "reason"),
          adminEmail: admin.email
        }));
      }

      if (route === "POST /admin/attendance/clear-date") {
        await requireAdmin(request, env);
        const body = await readJson<{ meetingDate?: unknown; confirmation?: unknown }>(request);
        return json(await clearAttendanceForDate(env, body));
      }

      if (route === "POST /admin/attendance/remove-member") {
        const admin = await requireAdmin(request, env);
        const body = await readJson<{ memberId?: unknown; studentId?: unknown; meetingDate?: unknown; reason?: unknown }>(request);
        return json(await removeMemberFromMeeting(env, {
          memberId: requireNonEmptyString(body.memberId ?? body.studentId, "memberId"),
          meetingDate: body.meetingDate,
          reason: requireNonEmptyString(body.reason, "reason"),
          adminEmail: admin.email
        }));
      }

      if (route === "POST /admin/attendance/clear-member-source-data") {
        const admin = await requireAdmin(request, env);
        const body = await readJson<{ memberId?: unknown; studentId?: unknown; meetingDate?: unknown; confirmation?: unknown; reason?: unknown }>(request);
        return json(await clearMemberAttendanceSourceData(env, {
          memberId: requireNonEmptyString(body.memberId ?? body.studentId, "memberId"),
          meetingDate: body.meetingDate,
          confirmation: body.confirmation,
          reason: requireNonEmptyString(body.reason, "reason"),
          adminEmail: admin.email
        }));
      }

      if (route === "POST /admin/notifications/meeting-absence") {
        await requireAdmin(request, env);
        const body = await readJson<MeetingAbsenceNotificationInput>(request);
        return json(await sendMeetingAbsenceNotifications(env, body));
      }

      if (route === "POST /admin/notifications/member-attendance-report") {
        await requireAdmin(request, env);
        const body = await readJson<MemberAttendanceReportNotificationInput>(request);
        return json(await sendMemberAttendanceReportNotification(env, body));
      }

      if (route === "POST /admin/notifications/discord/missing-members") {
        await requireAdmin(request, env);
        const body = await readJson<DiscordMissingMemberNotificationInput>(request);
        return json(await sendDiscordMissingMemberNotifications(env, body));
      }

      if (route === "POST /admin/notifications/discord/bot/missing-members") {
        await requireAdmin(request, env);
        const body = await readJson<DiscordBotMissingMemberNotificationInput>(request);
        return json(await sendDiscordBotMissingMemberNotifications(env, body));
      }

      if (route === "POST /admin/notifications/discord/test") {
        await requireAdmin(request, env);
        const body = await readJson<DiscordTestNotificationInput>(request);
        return json(await sendDiscordTestNotification(env, body));
      }

      if (route === "GET /admin/attendance-contests") {
        await requireAdmin(request, env);
        return json({ contests: await listAttendanceContests(env, url.searchParams.get("status"), url.searchParams.get("meetingDate")) });
      }

      const adminAttendanceContestApproval = url.pathname.match(/^\/admin\/attendance-contests\/([^/]+)\/approve$/);
      if (request.method === "POST" && adminAttendanceContestApproval) {
        const admin = await requireAdmin(request, env);
        const contestId = adminAttendanceContestApproval[1];
        if (!contestId) throw Object.assign(new Error("Attendance contest id is required"), { status: 400 });
        const body = await readJson<{ reviewNote?: unknown }>(request);
        return json(await approveAttendanceContest(env, decodeURIComponent(contestId), body, admin));
      }

      const adminAttendanceContest = url.pathname.match(/^\/admin\/attendance-contests\/([^/]+)$/);
      if (request.method === "PUT" && adminAttendanceContest) {
        const admin = await requireAdmin(request, env);
        const contestId = adminAttendanceContest[1];
        if (!contestId) throw Object.assign(new Error("Attendance contest id is required"), { status: 400 });
        const body = await readJson<{ status?: unknown; reviewNote?: unknown }>(request);
        return json(await reviewAttendanceContest(env, decodeURIComponent(contestId), body, admin));
      }

      if (route === "GET /admin/events") {
        await requireAdmin(request, env);
        const rows = await env.DB.prepare(
          "SELECT id, kiosk_id, local_event_id, student_id, occurred_at, synced_at, source, status, rejection_reason FROM scan_events ORDER BY occurred_at DESC LIMIT 250"
        ).all();
        return json({ events: rows.results.map(rowToScanEventResponse) });
      }

      if (route === "GET /admin/reports/sessions") {
        await requireAdmin(request, env);
        return json({ sessions: await buildAttendanceSessionReport(env, reportDateRangeFromSearchParams(url.searchParams)) });
      }

      if (route === "GET /admin/reports/meetings") {
        await requireAdmin(request, env);
        return json({ meetings: await buildMeetingSummaryReport(env, reportDateRangeFromSearchParams(url.searchParams)) });
      }

      if (route === "GET /admin/reports/meeting-absences") {
        await requireAdmin(request, env);
        return json(await buildMeetingAbsenceReport(env, requireNonEmptyString(url.searchParams.get("date") ?? undefined, "date")));
      }

      if (route === "GET /admin/reports/roster-attendance") {
        await requireAdmin(request, env);
        return json({ members: await buildRosterAttendanceSummary(env, reportDateRangeFromSearchParams(url.searchParams)) });
      }

      if (route === "GET /admin/reports/presence") {
        await requireAdmin(request, env);
        return json(await buildPresenceReport(env, url.searchParams.get("date") ?? undefined));
      }

      if (route === "GET /admin/reports/member") {
        await requireAdmin(request, env);
        const memberId = url.searchParams.get("memberId") ?? url.searchParams.get("studentId") ?? undefined;
        return json(await buildMemberAttendanceReport(
          env,
          requireNonEmptyString(memberId, "memberId"),
          reportDateRangeFromSearchParams(url.searchParams)
        ));
      }

      if (route === "GET /admin/export/legacy-sheets") {
        await requireAdmin(request, env);
        return json(await buildLegacySheetExport(env, reportDateRangeFromSearchParams(url.searchParams)));
      }

      return json({ error: "Not found" }, { status: 404 });
    } catch (error) {
      return errorResponse(error);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(sendScheduledDiscordBotMissingMemberNotifications(env));
    ctx.waitUntil(refreshDiscordKioskStatusMessage(env));
  }
};

async function updateKioskHealth(env: Env, report: KioskHealthReport) {
  const pendingScanCount = Math.max(0, Math.floor(Number(report.pendingScanCount) || 0));
  await env.DB.prepare(`
    UPDATE kiosks
    SET
      last_heartbeat_at = ?,
      reader_online = ?,
      pending_scan_count = ?,
      last_sync_at = ?,
      last_sync_error = ?
    WHERE kiosk_id = ?
  `).bind(
    new Date().toISOString(),
    report.readerOnline === null || report.readerOnline === undefined ? null : report.readerOnline ? 1 : 0,
    pendingScanCount,
    report.lastSyncAt ?? null,
    report.lastSyncError ?? null,
    report.kioskId
  ).run();
}

function rowToScanEventResponse(row: Record<string, unknown>) {
  return {
    id: row.id,
    kioskId: row.kiosk_id,
    localEventId: row.local_event_id,
    memberId: row.student_id,
    occurredAt: row.occurred_at,
    syncedAt: row.synced_at,
    source: row.source,
    status: row.status,
    rejectionReason: row.rejection_reason
  };
}

function memberToLegacyStudent(member: {
  memberId: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  discordUserId?: string | null;
  active: boolean;
  rosterSyncedAt?: string | null;
}) {
  return {
    student_id: member.memberId,
    first_name: member.firstName,
    last_name: member.lastName,
    email: member.email ?? null,
    discord_user_id: member.discordUserId ?? null,
    active: member.active,
    roster_synced_at: member.rosterSyncedAt ?? null
  };
}
