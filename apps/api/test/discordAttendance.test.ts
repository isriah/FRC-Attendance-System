import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import {
  attendanceContestCustomId,
  contestAttendanceAbsence,
  parseAttendanceContestCustomId,
  sendDiscordBotMissingMemberNotifications,
  sendScheduledDiscordBotMissingMemberNotifications
} from "../src/discordAttendance";
import { refreshDiscordKioskStatusMessage } from "../src/discordKioskStatus";
import type { Env } from "../src/env";

describe("Discord bot attendance notifications", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends one bot message with explicit mentions and a contest button", async () => {
    const env = createTestEnv({
      DISCORD_BOT_TOKEN: "test-bot-token",
      DISCORD_ATTENDANCE_CHANNEL_ID: "890334748730351629",
      DISCORD_MISSING_MEMBER_DELAY_MINUTES: "30"
    });
    insertStudent(env, "100001", "Present", "Member", "111111111111111111");
    insertStudent(env, "100002", "Missing", "One", "222222222222222222");
    insertStudent(env, "100003", "Missing", "Two", "333333333333333333");
    insertMeeting(env, "2026-01-02", "2026-01-02T22:00:00.000Z");
    insertSession(env, "100001", "2026-01-02");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "444444444444444444" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendDiscordBotMissingMemberNotifications(env, { meetingDate: "2026-01-02" }, new Date("2026-01-02T22:30:00.000Z"));

    expect(result).toMatchObject({
      notificationKind: "discord_bot_missing_members",
      providerConfigured: true,
      mode: "send",
      delayMinutes: 30,
      eligibleAt: "2026-01-02T22:30:00.000Z",
      sentCount: 2,
      errorCount: 0
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/v10/channels/890334748730351629/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bot test-bot-token" })
      })
    );
    const payload = fetchBody(fetchMock);
    expect(payload.allowed_mentions).toEqual({
      parse: [],
      users: ["222222222222222222", "333333333333333333"]
    });
    expect(payload.components).toEqual([{
      type: 1,
      components: [{
        type: 2,
        style: 2,
        label: "Contest absence",
        custom_id: "attendance-contest:v1:2026-01-02"
      }]
    }]);
    expect(String(payload.content)).toContain("<@222222222222222222> <@333333333333333333>");
    expect(deliveryMessageIds(env)).toEqual(["444444444444444444", "444444444444444444"]);
  });

  it("enforces the configured post-meeting delay", async () => {
    const env = createTestEnv({ DISCORD_MISSING_MEMBER_DELAY_MINUTES: "45" });
    insertStudent(env, "100001", "Missing", "Member", "111111111111111111");
    insertMeeting(env, "2026-01-02", "2026-01-02T22:00:00.000Z");

    await expect(sendDiscordBotMissingMemberNotifications(
      env,
      { meetingDate: "2026-01-02", preview: true },
      new Date("2026-01-02T22:44:59.000Z")
    )).rejects.toThrow("delayed until 2026-01-02T22:45:00.000Z");
  });

  it("automatically sends eligible completed required meetings once from the scheduled path", async () => {
    const env = createTestEnv({
      DISCORD_BOT_TOKEN: "test-bot-token",
      DISCORD_ATTENDANCE_CHANNEL_ID: "890334748730351629",
      DISCORD_MISSING_MEMBER_DELAY_MINUTES: "30"
    });
    insertStudent(env, "100001", "Missing", "Member", "111111111111111111");
    insertMeeting(env, "2026-01-02", "2026-01-02T22:00:00.000Z");
    insertMeeting(env, "2026-01-03", "2026-01-03T22:00:00.000Z");
    await env.DB.prepare("UPDATE scheduled_meetings SET required = 0 WHERE meeting_date = '2026-01-03'").run();
    insertMeeting(env, "2026-01-04", "2026-01-04T22:00:00.000Z");
    await env.DB.prepare("UPDATE scheduled_meetings SET ends_at = NULL WHERE meeting_date = '2026-01-04'").run();
    insertMeeting(env, "2026-01-05", "not-a-date");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "444444444444444444" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendScheduledDiscordBotMissingMemberNotifications(env, new Date("2026-01-02T22:30:00.000Z"));

    expect(result).toMatchObject({
      notificationKind: "scheduled_discord_bot_missing_members",
      eligibleCount: 1,
      claimedCount: 1,
      sentMeetingCount: 1,
      skippedLockedCount: 0,
      errorCount: 0,
      meetings: [{
        meetingDate: "2026-01-02",
        status: "sent",
        sentCount: 1,
        eligibleAt: "2026-01-02T22:30:00.000Z"
      }]
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lockRows(env)).toEqual([{ meeting_date: "2026-01-02", status: "sent", attempts: 1 }]);
    expect(deliveryMessageIds(env)).toEqual(["444444444444444444"]);
  });

  it("uses the scheduled lock to avoid duplicate messages after retries", async () => {
    const env = createTestEnv({
      DISCORD_BOT_TOKEN: "test-bot-token",
      DISCORD_ATTENDANCE_CHANNEL_ID: "890334748730351629"
    });
    insertStudent(env, "100001", "Missing", "Member", "111111111111111111");
    insertMeeting(env, "2026-01-02", "2026-01-02T22:00:00.000Z");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "444444444444444444" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await sendScheduledDiscordBotMissingMemberNotifications(env, new Date("2026-01-02T22:30:00.000Z"));
    const second = await sendScheduledDiscordBotMissingMemberNotifications(env, new Date("2026-01-02T22:40:00.000Z"));

    expect(first.sentMeetingCount).toBe(1);
    expect(second).toMatchObject({
      eligibleCount: 1,
      claimedCount: 0,
      sentMeetingCount: 0,
      skippedLockedCount: 1
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(deliveryMessageIds(env)).toEqual(["444444444444444444"]);
  });

  it("retries scheduled meetings after provider errors without treating them as delivered", async () => {
    const env = createTestEnv({
      DISCORD_BOT_TOKEN: "test-bot-token",
      DISCORD_ATTENDANCE_CHANNEL_ID: "890334748730351629"
    });
    insertStudent(env, "100001", "Missing", "Member", "111111111111111111");
    insertMeeting(env, "2026-01-02", "2026-01-02T22:00:00.000Z");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("temporary Discord failure", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "444444444444444444" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await sendScheduledDiscordBotMissingMemberNotifications(env, new Date("2026-01-02T22:30:00.000Z"));
    const second = await sendScheduledDiscordBotMissingMemberNotifications(env, new Date("2026-01-02T22:40:00.000Z"));

    expect(first).toMatchObject({ sentMeetingCount: 0, errorCount: 1 });
    expect(second).toMatchObject({ sentMeetingCount: 1, errorCount: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lockRows(env)).toEqual([{ meeting_date: "2026-01-02", status: "sent", attempts: 2 }]);
    expect(deliveryMessageIds(env)).toEqual(["444444444444444444"]);
  });

  it("strictly validates contest custom IDs", () => {
    expect(attendanceContestCustomId("2026-01-02")).toBe("attendance-contest:v1:2026-01-02");
    expect(parseAttendanceContestCustomId("attendance-contest:v1:2026-01-02")).toEqual({ meetingDate: "2026-01-02" });
    expect(parseAttendanceContestCustomId("attendance-contest:v1:2026-99-99")).toBeNull();
    expect(parseAttendanceContestCustomId("other:v1:2026-01-02")).toBeNull();
    expect(parseAttendanceContestCustomId("attendance-contest:v1:2026-01-02:100001")).toBeNull();
  });
});

describe("Discord kiosk status message", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates one persistent bot status message when absent", async () => {
    const env = createTestEnv({
      DISCORD_BOT_TOKEN: "test-bot-token",
      DISCORD_ATTENDANCE_CHANNEL_ID: "890334748730351629"
    });
    insertKiosk(env, {
      kioskId: "bench-01",
      name: "Bench kiosk",
      lastHeartbeatAt: "2026-01-02T22:29:30.000Z",
      readerOnline: 1
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "555555555555555555" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await refreshDiscordKioskStatusMessage(env, new Date("2026-01-02T22:30:00.000Z"));

    expect(result).toMatchObject({
      notificationKind: "discord_kiosk_status",
      providerConfigured: true,
      offlineThresholdMinutes: 1,
      kioskCount: 1,
      status: "created",
      messageId: "555555555555555555"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/v10/channels/890334748730351629/messages",
      expect.objectContaining({ method: "POST" })
    );
    const body = fetchBody(fetchMock);
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(String(body.content)).toContain("FRC Attendance kiosk status");
    expect(String(body.content)).toContain("Status: Online since <t:1767393000:f>");
    expect(statusMessageRows(env)).toMatchObject([{
      channel_id: "890334748730351629",
      message_id: "555555555555555555",
      operation_status: "idle",
      attempts: 1,
      error_message: null
    }]);
  });

  it("edits the persistent message when rendered status changes", async () => {
    const env = createTestEnv({
      DISCORD_BOT_TOKEN: "test-bot-token",
      DISCORD_ATTENDANCE_CHANNEL_ID: "890334748730351629"
    });
    insertKiosk(env, {
      kioskId: "bench-01",
      name: "Bench kiosk",
      lastHeartbeatAt: "2026-01-02T22:29:30.000Z",
      readerOnline: 1
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "555555555555555555" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await refreshDiscordKioskStatusMessage(env, new Date("2026-01-02T22:30:00.000Z"));
    await env.DB.prepare("UPDATE kiosks SET reader_online = 0, last_heartbeat_at = '2026-01-02T22:30:30.000Z' WHERE kiosk_id = 'bench-01'").run();

    const result = await refreshDiscordKioskStatusMessage(env, new Date("2026-01-02T22:31:00.000Z"));

    expect(result).toMatchObject({ status: "edited", messageId: "555555555555555555" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[1]?.[0]).toBe("https://discord.com/api/v10/channels/890334748730351629/messages/555555555555555555");
    expect(calls[1]?.[1]).toMatchObject({ method: "PATCH" });
    const editBody = fetchBodyAt(fetchMock, 1);
    expect(String(editBody.content)).toContain("Status: Degraded since <t:1767393060:f>");
    expect(String(editBody.content)).toContain("reader offline");
  });

  it("does not call Discord when status rendering is unchanged", async () => {
    const env = createTestEnv({
      DISCORD_BOT_TOKEN: "test-bot-token",
      DISCORD_ATTENDANCE_CHANNEL_ID: "890334748730351629"
    });
    insertKiosk(env, {
      kioskId: "bench-01",
      name: "Bench kiosk",
      lastHeartbeatAt: "2026-01-02T22:29:30.000Z",
      readerOnline: 1
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "555555555555555555" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await refreshDiscordKioskStatusMessage(env, new Date("2026-01-02T22:30:00.000Z"));
    await env.DB.prepare("UPDATE kiosks SET last_heartbeat_at = '2026-01-02T22:30:45.000Z' WHERE kiosk_id = 'bench-01'").run();

    const result = await refreshDiscordKioskStatusMessage(env, new Date("2026-01-02T22:31:00.000Z"));

    expect(result).toMatchObject({ status: "unchanged", messageId: "555555555555555555" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const snapshot = JSON.parse(statusMessageRows(env)[0]?.status_snapshot_json ?? "{}") as Record<string, { changedAt: string }>;
    expect(snapshot["bench-01"]?.changedAt).toBe("2026-01-02T22:30:00.000Z");
  });

  it("does not edit offline status for hidden health detail changes", async () => {
    const env = createTestEnv({
      DISCORD_BOT_TOKEN: "test-bot-token",
      DISCORD_ATTENDANCE_CHANNEL_ID: "890334748730351629",
      KIOSK_DISCORD_OFFLINE_THRESHOLD_MINUTES: "1"
    });
    insertKiosk(env, {
      kioskId: "bench-01",
      name: "Bench kiosk",
      lastHeartbeatAt: "2026-01-02T22:28:59.000Z",
      readerOnline: 1
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "555555555555555555" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await refreshDiscordKioskStatusMessage(env, new Date("2026-01-02T22:30:00.000Z"));
    await env.DB.prepare(`
      UPDATE kiosks
      SET reader_online = 0, pending_scan_count = 3, last_sync_error = 'still offline'
      WHERE kiosk_id = 'bench-01'
    `).run();

    const result = await refreshDiscordKioskStatusMessage(env, new Date("2026-01-02T22:40:00.000Z"));

    expect(result).toMatchObject({ status: "unchanged", messageId: "555555555555555555" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const snapshot = JSON.parse(statusMessageRows(env)[0]?.status_snapshot_json ?? "{}") as Record<string, { changedAt: string }>;
    expect(snapshot["bench-01"]?.changedAt).toBe("2026-01-02T22:30:00.000Z");
  });

  it("marks a kiosk offline when heartbeat exceeds the configured threshold", async () => {
    const env = createTestEnv({
      DISCORD_BOT_TOKEN: "test-bot-token",
      DISCORD_ATTENDANCE_CHANNEL_ID: "890334748730351629",
      KIOSK_DISCORD_OFFLINE_THRESHOLD_MINUTES: "1"
    });
    insertKiosk(env, {
      kioskId: "bench-01",
      name: "Bench kiosk",
      lastHeartbeatAt: "2026-01-02T22:28:59.000Z",
      readerOnline: 1
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "555555555555555555" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await refreshDiscordKioskStatusMessage(env, new Date("2026-01-02T22:30:00.000Z"));

    expect(result).toMatchObject({ status: "created" });
    const body = fetchBody(fetchMock);
    expect(String(body.content)).toContain("Status: Offline since <t:1767393000:f>");
    expect(String(body.content)).toContain("heartbeat older than 1 min");
  });

  it("records Discord errors and retries a failed initial create", async () => {
    const env = createTestEnv({
      DISCORD_BOT_TOKEN: "test-bot-token",
      DISCORD_ATTENDANCE_CHANNEL_ID: "890334748730351629"
    });
    insertKiosk(env, {
      kioskId: "bench-01",
      name: "Bench kiosk",
      lastHeartbeatAt: "2026-01-02T22:29:30.000Z",
      readerOnline: 1
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("temporary Discord failure", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "555555555555555555" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await refreshDiscordKioskStatusMessage(env, new Date("2026-01-02T22:30:00.000Z"));
    const second = await refreshDiscordKioskStatusMessage(env, new Date("2026-01-02T22:40:00.000Z"));

    expect(first).toMatchObject({ status: "error", error: "temporary Discord failure" });
    expect(second).toMatchObject({ status: "created", messageId: "555555555555555555" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(statusMessageRows(env)).toMatchObject([{
      message_id: "555555555555555555",
      operation_status: "idle",
      attempts: 2,
      error_message: null
    }]);
  });
});

describe("attendance contest lifecycle", () => {
  it("matches the clicking member to the delivered message and creates one pending contest idempotently", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Ada", "Lovelace", "111111111111111111");
    insertStudent(env, "100002", "Grace", "Hopper", "222222222222222222");
    insertMeeting(env, "2026-01-02", "2026-01-02T22:00:00.000Z");
    insertDelivery(env, "100001", "111111111111111111", "444444444444444444");

    const first = await contestAttendanceAbsence(env, contestInput("555555555555555551", "111111111111111111"));
    const repeated = await contestAttendanceAbsence(env, contestInput("555555555555555552", "111111111111111111"));
    const wrongMember = await contestAttendanceAbsence(env, contestInput("555555555555555553", "222222222222222222"));

    expect(first).toMatchObject({ status: "created", contest: { memberId: "100001", status: "pending" } });
    expect(repeated).toMatchObject({ status: "already_pending", contest: { memberId: "100001", status: "pending" } });
    if (first.status === "created" && repeated.status === "already_pending") {
      expect(repeated.contest.id).toBe(first.contest.id);
    }
    expect(wrongMember).toEqual({ status: "not_eligible" });
    expect(countRows(env, "attendance_contests")).toBe(1);
  });

  it("does not create a contest when attendance already shows the member present", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Ada", "Lovelace", "111111111111111111");
    insertMeeting(env, "2026-01-02", "2026-01-02T22:00:00.000Z");
    insertDelivery(env, "100001", "111111111111111111", "444444444444444444");
    insertSession(env, "100001", "2026-01-02");

    expect(await contestAttendanceAbsence(env, contestInput("555555555555555551", "111111111111111111")))
      .toEqual({ status: "already_present" });
    expect(countRows(env, "attendance_contests")).toBe(0);
  });

  it("lets authenticated admins list and review contests without changing attendance", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Ada", "Lovelace", "111111111111111111");
    insertMeeting(env, "2026-01-02", "2026-01-02T22:00:00.000Z");
    insertDelivery(env, "100001", "111111111111111111", "444444444444444444");
    const created = await contestAttendanceAbsence(env, contestInput("555555555555555551", "111111111111111111"));
    if (created.status !== "created") throw new Error("Expected a created contest");

    const listResponse = await adminRequest(env, "GET", "/admin/attendance-contests?status=pending");
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toMatchObject({
      contests: [{
        id: created.contest.id,
        memberId: "100001",
        firstName: "Ada",
        lastName: "Lovelace",
        meetingDate: "2026-01-02",
        status: "pending"
      }]
    });

    const meetingListResponse = await adminRequest(env, "GET", "/admin/attendance-contests?meetingDate=2026-01-02");
    expect(meetingListResponse.status).toBe(200);
    expect(await meetingListResponse.json()).toMatchObject({
      contests: [{ id: created.contest.id, meetingDate: "2026-01-02" }]
    });

    const reviewResponse = await adminRequest(env, "PUT", `/admin/attendance-contests/${created.contest.id}`, {
      status: "resolved",
      reviewNote: "Added a manual check-in after confirming with the drive coach."
    });
    expect(reviewResponse.status).toBe(200);
    expect(await reviewResponse.json()).toMatchObject({
      id: created.contest.id,
      status: "resolved",
      reviewedByAdminEmail: "mentor@example.com",
      reviewNote: "Added a manual check-in after confirming with the drive coach."
    });
    expect(countRows(env, "attendance_sessions")).toBe(0);
  });

  it("approves a pending contest through an audited manual correction and normal attendance rebuild", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Ada", "Lovelace", "111111111111111111");
    insertMeeting(env, "2026-01-02", "2026-01-02T22:00:00.000Z");
    insertDelivery(env, "100001", "111111111111111111", "444444444444444444");
    const created = await contestAttendanceAbsence(env, contestInput("555555555555555551", "111111111111111111"));
    if (created.status !== "created") throw new Error("Expected a created contest");

    const approveResponse = await adminRequest(env, "POST", `/admin/attendance-contests/${created.contest.id}/approve`, {
      reviewNote: "Drive coach confirmed the member attended."
    });

    expect(approveResponse.status).toBe(200);
    expect(await approveResponse.json()).toMatchObject({
      contest: {
        id: created.contest.id,
        status: "resolved",
        reviewedByAdminEmail: "mentor@example.com",
        reviewNote: "Drive coach confirmed the member attended."
      },
      manualEvent: {
        memberId: "100001",
        action: "confirm_present",
        adminEmail: "mentor@example.com"
      },
      supersededAttendanceExclusionId: null
    });
    expect(await env.DB.prepare("SELECT action, reason, admin_email FROM manual_events").first()).toEqual({
      action: "confirm_present",
      reason: "Discord contest approved by mentor@example.com: Drive coach confirmed the member attended.",
      admin_email: "mentor@example.com"
    });
    expect(countRows(env, "attendance_sessions")).toBe(1);

    const absenceResponse = await adminRequest(env, "GET", "/admin/reports/meeting-absences?date=2026-01-02");
    expect(absenceResponse.status).toBe(200);
    expect(await absenceResponse.json()).toMatchObject({ absentCount: 0, rows: [] });
  });

  it("uses a valid local-noon correction timestamp for legacy meeting start values", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Ada", "Lovelace", "111111111111111111");
    insertMeeting(env, "2026-01-02", "2026-01-02T22:00:00.000Z");
    await env.DB.prepare("UPDATE scheduled_meetings SET starts_at = '15:00' WHERE meeting_date = '2026-01-02'").run();
    insertDelivery(env, "100001", "111111111111111111", "444444444444444444");
    const created = await contestAttendanceAbsence(env, contestInput("555555555555555551", "111111111111111111"));
    if (created.status !== "created") throw new Error("Expected a created contest");

    const approveResponse = await adminRequest(env, "POST", `/admin/attendance-contests/${created.contest.id}/approve`, {});

    expect(approveResponse.status).toBe(200);
    expect(await env.DB.prepare("SELECT occurred_at FROM manual_events").first()).toEqual({
      occurred_at: "2026-01-02T17:00:00.000Z"
    });
    expect(countRows(env, "attendance_sessions")).toBe(1);
  });

  it("supersedes an existing absent correction while preserving its audit record", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Ada", "Lovelace", "111111111111111111");
    insertMeeting(env, "2026-01-02", "2026-01-02T22:00:00.000Z");
    insertDelivery(env, "100001", "111111111111111111", "444444444444444444");
    const created = await contestAttendanceAbsence(env, contestInput("555555555555555551", "111111111111111111"));
    if (created.status !== "created") throw new Error("Expected a created contest");
    await env.DB.prepare(`
      INSERT INTO scan_events (id, kiosk_id, local_event_id, student_id, occurred_at, synced_at, source, status)
      VALUES ('scan-1', 'kiosk-1', 'local-1', '100001', '2026-01-02T20:15:00.000Z', '2026-01-02T20:15:01.000Z', 'fingerprint', 'accepted')
    `).run();
    await env.DB.prepare(`
      INSERT INTO attendance_exclusions (id, student_id, meeting_date, reason, admin_email)
      VALUES ('exclusion-1', '100001', '2026-01-02', 'Incorrect prior removal', 'other-mentor@example.com')
    `).run();

    const approveResponse = await adminRequest(env, "POST", `/admin/attendance-contests/${created.contest.id}/approve`, {});
    expect(approveResponse.status).toBe(200);
    expect(await approveResponse.json()).toMatchObject({ supersededAttendanceExclusionId: "exclusion-1" });
    expect(await env.DB.prepare(`
      SELECT reason, admin_email, superseded_by_admin_email, superseded_reason
      FROM attendance_exclusions
      WHERE id = 'exclusion-1'
    `).first()).toEqual({
      reason: "Incorrect prior removal",
      admin_email: "other-mentor@example.com",
      superseded_by_admin_email: "mentor@example.com",
      superseded_reason: "Discord contest approved by mentor@example.com."
    });
    expect(countRows(env, "attendance_exclusions")).toBe(1);
    expect(countRows(env, "attendance_sessions")).toBe(1);
  });
});

function contestInput(interactionId: string, discordUserId: string) {
  return {
    interactionId,
    discordUserId,
    customId: "attendance-contest:v1:2026-01-02",
    sourceMessageId: "444444444444444444",
    sourceChannelId: "890334748730351629"
  };
}

function createTestEnv(overrides: Partial<Env> = {}): Env {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE admin_users (
      email TEXT PRIMARY KEY,
      role TEXT NOT NULL DEFAULT 'mentor',
      active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT
    );
    CREATE TABLE students (
      student_id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      discord_user_id TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      attendance_required_from_date TEXT
    );
    CREATE TABLE attendance_sessions (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      meeting_date TEXT NOT NULL,
      check_in_at TEXT NOT NULL,
      check_out_at TEXT,
      status TEXT NOT NULL,
      source_event_ids TEXT NOT NULL,
      rebuilt_at TEXT NOT NULL
    );
    CREATE TABLE scan_events (
      id TEXT PRIMARY KEY,
      kiosk_id TEXT NOT NULL,
      local_event_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      rejection_reason TEXT
    );
    CREATE TABLE manual_events (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT NOT NULL,
      admin_email TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE attendance_exclusions (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      meeting_date TEXT NOT NULL,
      reason TEXT NOT NULL,
      admin_email TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      superseded_at TEXT,
      superseded_by_admin_email TEXT,
      superseded_reason TEXT
    );
    CREATE UNIQUE INDEX attendance_exclusions_active_member_date_unique_idx
    ON attendance_exclusions(student_id, meeting_date)
    WHERE superseded_at IS NULL;
    CREATE TABLE scheduled_meetings (
      id TEXT PRIMARY KEY,
      meeting_date TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 1,
      starts_at TEXT,
      ends_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE notification_deliveries (
      id TEXT PRIMARY KEY,
      notification_kind TEXT NOT NULL,
      meeting_date TEXT NOT NULL,
      student_id TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_message_id TEXT,
      error_message TEXT,
      sent_at TEXT,
      error_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE scheduled_notification_locks (
      id TEXT PRIMARY KEY,
      notification_kind TEXT NOT NULL,
      meeting_date TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 1,
      locked_at TEXT,
      completed_at TEXT,
      last_attempt_at TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(notification_kind, meeting_date)
    );
    CREATE TABLE kiosks (
      kiosk_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      location TEXT,
      token_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      last_seen_at TEXT,
      last_heartbeat_at TEXT,
      reader_online INTEGER,
      pending_scan_count INTEGER NOT NULL DEFAULT 0,
      last_sync_at TEXT,
      last_sync_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE discord_kiosk_status_messages (
      channel_id TEXT PRIMARY KEY,
      message_id TEXT,
      status_snapshot_json TEXT NOT NULL DEFAULT '{}',
      rendered_hash TEXT,
      operation_status TEXT NOT NULL DEFAULT 'idle',
      attempts INTEGER NOT NULL DEFAULT 0,
      locked_at TEXT,
      last_attempt_at TEXT,
      last_success_at TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE attendance_contests (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(student_id),
      scheduled_meeting_id TEXT NOT NULL,
      meeting_date TEXT NOT NULL,
      discord_user_id TEXT NOT NULL,
      interaction_id TEXT NOT NULL UNIQUE,
      source_message_id TEXT,
      source_channel_id TEXT,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      reviewed_by_admin_email TEXT,
      review_note TEXT
    );
    CREATE UNIQUE INDEX attendance_contests_member_meeting_unique_idx
    ON attendance_contests(student_id, scheduled_meeting_id);
  `);
  return {
    DB: d1(sqlite),
    TIME_ZONE: "America/New_York",
    GOOGLE_ALLOWED_EMAILS: "mentor@example.com",
    GOOGLE_ALLOWED_DOMAIN: "",
    GOOGLE_CLIENT_ID: "",
    DUPLICATE_WINDOW_SECONDS: "90",
    ...overrides
  } as unknown as Env;
}

function insertStudent(env: Env, memberId: string, firstName: string, lastName: string, discordUserId: string | null) {
  return env.DB.prepare("INSERT INTO students (student_id, first_name, last_name, discord_user_id, active) VALUES (?, ?, ?, ?, 1)")
    .bind(memberId, firstName, lastName, discordUserId)
    .run();
}

function insertMeeting(env: Env, meetingDate: string, endsAt: string) {
  return env.DB.prepare(`
    INSERT INTO scheduled_meetings (id, meeting_date, title, required, starts_at, ends_at, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?)
  `).bind(
    `meeting-${meetingDate}`,
    meetingDate,
    "Required Build",
    `${meetingDate}T20:00:00.000Z`,
    endsAt,
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z"
  ).run();
}

function insertSession(env: Env, memberId: string, meetingDate: string) {
  return env.DB.prepare(`
    INSERT INTO attendance_sessions (id, student_id, meeting_date, check_in_at, check_out_at, status, source_event_ids, rebuilt_at)
    VALUES (?, ?, ?, ?, ?, 'closed', '[]', ?)
  `).bind(`session-${memberId}-${meetingDate}`, memberId, meetingDate, `${meetingDate}T20:00:00.000Z`, `${meetingDate}T22:00:00.000Z`, new Date().toISOString()).run();
}

function insertDelivery(env: Env, memberId: string, discordUserId: string, providerMessageId: string) {
  const now = "2026-01-02T22:30:00.000Z";
  return env.DB.prepare(`
    INSERT INTO notification_deliveries (
      id, notification_kind, meeting_date, student_id, recipient_email, status,
      provider_message_id, sent_at, created_at, updated_at
    ) VALUES (?, 'discord_bot_missing_members', '2026-01-02', ?, ?, 'sent', ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), memberId, discordUserId, providerMessageId, now, now, now).run();
}

function adminRequest(env: Env, method: string, path: string, body?: unknown) {
  return worker.fetch(new Request(`https://api.test${path}`, {
    method,
    headers: { "content-type": "application/json", "x-admin-email": "mentor@example.com" },
    body: body === undefined ? undefined : JSON.stringify(body)
  }), env);
}

function fetchBody(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchBodyAt(fetchMock, 0);
}

function fetchBodyAt(fetchMock: ReturnType<typeof vi.fn>, index: number) {
  const init = fetchMock.mock.calls[index]?.[1] as RequestInit | undefined;
  if (!init || typeof init.body !== "string") throw new Error("Expected JSON request body");
  return JSON.parse(init.body) as Record<string, unknown>;
}

function deliveryMessageIds(env: Env): string[] {
  const db = env.DB as unknown as ReturnType<typeof d1>;
  const rows = db.sqlite.prepare("SELECT provider_message_id FROM notification_deliveries WHERE status = 'sent' ORDER BY student_id").all() as Array<{ provider_message_id: string }>;
  return rows.map((row) => row.provider_message_id);
}

function lockRows(env: Env): Array<{ meeting_date: string; status: string; attempts: number }> {
  const db = env.DB as unknown as ReturnType<typeof d1>;
  return db.sqlite.prepare("SELECT meeting_date, status, attempts FROM scheduled_notification_locks ORDER BY meeting_date").all() as Array<{ meeting_date: string; status: string; attempts: number }>;
}

function statusMessageRows(env: Env): Array<{
  channel_id: string;
  message_id: string | null;
  status_snapshot_json: string;
  operation_status: string;
  attempts: number;
  error_message: string | null;
}> {
  const db = env.DB as unknown as ReturnType<typeof d1>;
  return db.sqlite.prepare(`
    SELECT channel_id, message_id, status_snapshot_json, operation_status, attempts, error_message
    FROM discord_kiosk_status_messages
    ORDER BY channel_id
  `).all() as Array<{
    channel_id: string;
    message_id: string | null;
    status_snapshot_json: string;
    operation_status: string;
    attempts: number;
    error_message: string | null;
  }>;
}

function insertKiosk(env: Env, input: {
  kioskId: string;
  name: string;
  location?: string | null;
  active?: number;
  lastHeartbeatAt?: string | null;
  readerOnline?: number | null;
  pendingScanCount?: number;
  lastSyncError?: string | null;
}) {
  return env.DB.prepare(`
    INSERT INTO kiosks (
      kiosk_id, name, location, token_hash, active, last_heartbeat_at,
      reader_online, pending_scan_count, last_sync_error
    ) VALUES (?, ?, ?, 'token-hash', ?, ?, ?, ?, ?)
  `).bind(
    input.kioskId,
    input.name,
    input.location ?? null,
    input.active ?? 1,
    input.lastHeartbeatAt ?? null,
    input.readerOnline ?? null,
    input.pendingScanCount ?? 0,
    input.lastSyncError ?? null
  ).run();
}

function countRows(env: Env, table: string): number {
  const db = env.DB as unknown as ReturnType<typeof d1>;
  return (db.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function d1(sqlite: Database.Database) {
  return {
    sqlite,
    prepare(sql: string) {
      return new TestStatement(sqlite, sql);
    },
    async batch(statements: TestStatement[]) {
      const transaction = sqlite.transaction(() => statements.map((statement) => statement.run()));
      return transaction();
    }
  };
}

class TestStatement {
  private params: unknown[] = [];

  constructor(private readonly sqlite: Database.Database, private readonly sql: string) {}

  bind(...params: unknown[]) {
    const next = new TestStatement(this.sqlite, this.sql);
    next.params = params;
    return next;
  }

  async first<T>() {
    return this.sqlite.prepare(this.sql).get(...this.params) as T | null;
  }

  async all<T>() {
    return { results: this.sqlite.prepare(this.sql).all(...this.params) as T[] };
  }

  async run() {
    return this.sqlite.prepare(this.sql).run(...this.params);
  }
}
