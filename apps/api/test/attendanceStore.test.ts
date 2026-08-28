import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { excuseMemberFromMeeting, rebuildAttendanceSessions, removeMemberFromMeeting, removeMemberMeetingExcuse, syncKioskEvents } from "../src/attendanceStore";
import type { Env } from "../src/env";
import { buildMeetingAbsenceReport, buildMemberAttendanceReport, buildPresenceReport } from "../src/reports";

describe("kiosk sync acknowledgements", () => {
  it("audits an excuse and removal without changing source attendance", async () => {
    const env = createTestEnv();
    await env.DB.prepare("INSERT INTO scheduled_meetings (id, meeting_date, title, required, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind("meeting-1", "2026-01-09", "Build", 1, "2026-01-01", "2026-01-01").run();
    const excuse = await excuseMemberFromMeeting(env, { memberId: "100001", meetingDate: "2026-01-09", reason: "Family", adminEmail: "mentor@example.org" });
    expect(excuse).toMatchObject({ reason: "Family", createdByEmail: "mentor@example.org" });
    await expect(excuseMemberFromMeeting(env, { memberId: "100001", meetingDate: "2026-01-09", adminEmail: "mentor@example.org" })).rejects.toMatchObject({ status: 409 });
    const removal = await removeMemberMeetingExcuse(env, { memberId: "100001", meetingDate: "2026-01-09", adminEmail: "other@example.org" });
    expect(removal.removedByEmail).toBe("other@example.org");
    expect(await env.DB.prepare("SELECT created_by_email, removed_by_email, removed_at FROM attendance_excuses WHERE id = ?").bind(excuse.id).first()).toMatchObject({ created_by_email: "mentor@example.org", removed_by_email: "other@example.org" });
  });

  it("rejects an excuse for a present member", async () => {
    const env = createTestEnv();
    await env.DB.prepare("INSERT INTO scheduled_meetings (id, meeting_date, title, required, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind("meeting-1", "2026-01-09", "Build", 1, "2026-01-01", "2026-01-01").run();
    await env.DB.prepare("INSERT INTO attendance_sessions (id, student_id, meeting_date, check_in_at, status, source_event_ids, rebuilt_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind("session-1", "100001", "2026-01-09", "2026-01-09T20:00:00.000Z", "open", "[]", "2026-01-09T20:00:00.000Z").run();
    await expect(excuseMemberFromMeeting(env, { memberId: "100001", meetingDate: "2026-01-09", adminEmail: "mentor@example.org" })).rejects.toMatchObject({ status: 409 });
  });
  it("returns welcome and goodbye acknowledgements for remote kiosk scans", async () => {
    const env = createTestEnv();

    const first = await syncKioskEvents(env, "bench-01", [{
      localEventId: "scan-1",
      memberId: "100001",
      occurredAt: "2026-01-02T20:00:00.000Z",
      source: "fingerprint"
    }]);

    expect(first.acknowledgements?.[0]).toMatchObject({
      localEventId: "scan-1",
      memberId: "100001",
      status: "accepted",
      displayName: "Bench Student",
      action: "check_in",
      kioskMessage: "Welcome, Bench Student",
      kioskDetail: "Checked in at 3:00 PM. Attendance 100% (1/1)",
      message: "Welcome, Bench Student",
      attendanceSummary: "Attendance 100% (1/1)"
    });

    const second = await syncKioskEvents(env, "bench-01", [{
      localEventId: "scan-2",
      memberId: "100001",
      occurredAt: "2026-01-02T22:00:00.000Z",
      source: "fingerprint"
    }]);

    expect(second.acknowledgements?.[0]).toMatchObject({
      localEventId: "scan-2",
      status: "accepted",
      action: "check_out",
      kioskMessage: "Goodbye, Bench Student",
      kioskDetail: "Checked out at 5:00 PM. Attendance 100% (1/1)",
      message: "Goodbye, Bench Student",
      attendanceSummary: "Attendance 100% (1/1)"
    });
  });

  it("derives normal single-kiosk acknowledgement actions across repeated scans", async () => {
    const env = createTestEnv();

    const result = await syncKioskEvents(env, "bench-01", [
      {
        localEventId: "scan-1",
        memberId: "100001",
        occurredAt: "2026-01-02T20:00:00.000Z",
        source: "fingerprint"
      },
      {
        localEventId: "scan-2",
        memberId: "100001",
        occurredAt: "2026-01-02T22:00:00.000Z",
        source: "fingerprint"
      },
      {
        localEventId: "scan-3",
        memberId: "100001",
        occurredAt: "2026-01-02T23:00:00.000Z",
        source: "fingerprint"
      }
    ]);

    expect(result.acknowledgements).toEqual([
      expect.objectContaining({
        localEventId: "scan-1",
        status: "accepted",
        action: "check_in",
        kioskMessage: "Welcome, Bench Student",
        kioskDetail: "Checked in at 3:00 PM. Attendance 100% (1/1)"
      }),
      expect.objectContaining({
        localEventId: "scan-2",
        status: "accepted",
        action: "check_out",
        kioskMessage: "Goodbye, Bench Student",
        kioskDetail: "Checked out at 5:00 PM. Attendance 100% (1/1)"
      }),
      expect.objectContaining({
        localEventId: "scan-3",
        status: "accepted",
        action: "check_in",
        kioskMessage: "Welcome, Bench Student",
        kioskDetail: "Checked in at 6:00 PM. Attendance 100% (1/1)"
      })
    ]);
  });

  it("can hide attendance summaries from member-facing kiosk details", async () => {
    const env = createTestEnv({ KIOSK_SHOW_ATTENDANCE_SUMMARY: "false" });

    const result = await syncKioskEvents(env, "bench-01", [{
      localEventId: "scan-no-summary",
      memberId: "100001",
      occurredAt: "2026-01-02T20:00:00.000Z",
      source: "fingerprint"
    }]);

    expect(result.acknowledgements?.[0]).toMatchObject({
      status: "accepted",
      kioskMessage: "Welcome, Bench Student",
      kioskDetail: "Checked in at 3:00 PM.",
      attendanceSummary: "Attendance 100% (1/1)"
    });
  });

  it("returns duplicate acknowledgements inside the duplicate window", async () => {
    const env = createTestEnv();

    await syncKioskEvents(env, "bench-01", [{
      localEventId: "scan-1",
      memberId: "100001",
      occurredAt: "2026-01-02T20:00:00.000Z",
      source: "fingerprint"
    }]);

    const duplicate = await syncKioskEvents(env, "bench-01", [{
      localEventId: "scan-duplicate",
      memberId: "100001",
      occurredAt: "2026-01-02T20:00:30.000Z",
      source: "fingerprint"
    }]);

    expect(duplicate.acknowledgements?.[0]).toMatchObject({
      localEventId: "scan-duplicate",
      memberId: "100001",
      status: "duplicate",
      displayName: "Bench Student",
      kioskMessage: "Already recorded",
      kioskDetail: "Bench Student, your attendance was already recorded. Please wait a moment before scanning again.",
      message: "Bench Student was already recorded."
    });
  });

  it("treats the duplicate window endpoint as inclusive", async () => {
    const env = createTestEnv();

    await syncKioskEvents(env, "bench-01", [{
      localEventId: "scan-1",
      memberId: "100001",
      occurredAt: "2026-01-02T20:00:00.000Z",
      source: "fingerprint"
    }]);

    const exactBoundary = await syncKioskEvents(env, "bench-01", [{
      localEventId: "scan-90s",
      memberId: "100001",
      occurredAt: "2026-01-02T20:01:30.000Z",
      source: "fingerprint"
    }]);
    const justOutsideBoundary = await syncKioskEvents(env, "bench-01", [{
      localEventId: "scan-91s",
      memberId: "100001",
      occurredAt: "2026-01-02T20:01:31.000Z",
      source: "fingerprint"
    }]);

    expect(exactBoundary.acknowledgements?.[0]).toMatchObject({
      localEventId: "scan-90s",
      status: "duplicate",
      kioskMessage: "Already recorded",
      kioskDetail: "Bench Student, your attendance was already recorded. Please wait a moment before scanning again."
    });
    expect(justOutsideBoundary.acknowledgements?.[0]).toMatchObject({
      localEventId: "scan-91s",
      status: "accepted",
      action: "check_out",
      kioskMessage: "Goodbye, Bench Student",
      kioskDetail: "Checked out at 3:01 PM. Attendance 100% (1/1)"
    });
  });

  it("flags delayed duplicate scans even after a later accepted scan has synced", async () => {
    const env = createTestEnv();

    await syncKioskEvents(env, "bench-01", [{
      localEventId: "bench-arrive",
      memberId: "100001",
      occurredAt: "2026-01-02T20:00:00.000Z",
      source: "fingerprint"
    }]);
    await syncKioskEvents(env, "door-02", [{
      localEventId: "door-leave",
      memberId: "100001",
      occurredAt: "2026-01-02T22:00:00.000Z",
      source: "fingerprint"
    }]);

    const delayedDuplicate = await syncKioskEvents(env, "pit-01", [{
      localEventId: "pit-delayed-duplicate",
      memberId: "100001",
      occurredAt: "2026-01-02T20:00:30.000Z",
      source: "fingerprint"
    }]);

    expect(delayedDuplicate.accepted).toHaveLength(0);
    expect(delayedDuplicate.duplicates).toHaveLength(1);
    expect(delayedDuplicate.acknowledgements?.[0]).toMatchObject({
      localEventId: "pit-delayed-duplicate",
      memberId: "100001",
      status: "duplicate",
      kioskMessage: "Already recorded"
    });
  });

  it("accepts delayed scans from different members inside another member's duplicate window", async () => {
    const env = createTestEnv();

    await syncKioskEvents(env, "bench-01", [{
      localEventId: "bench-member-one",
      memberId: "100001",
      occurredAt: "2026-01-02T20:00:00.000Z",
      source: "fingerprint"
    }]);

    const differentMember = await syncKioskEvents(env, "door-02", [{
      localEventId: "door-member-two",
      memberId: "100003",
      occurredAt: "2026-01-02T20:00:30.000Z",
      source: "fingerprint"
    }]);

    expect(differentMember.accepted).toHaveLength(1);
    expect(differentMember.duplicates).toHaveLength(0);
    expect(differentMember.acknowledgements?.[0]).toMatchObject({
      localEventId: "door-member-two",
      memberId: "100003",
      status: "accepted",
      displayName: "Second Student",
      action: "check_in"
    });

    const sessions = await env.DB.prepare(
      "SELECT student_id, meeting_date, check_in_at, check_out_at, status FROM attendance_sessions ORDER BY student_id ASC"
    ).all<{
      student_id: string;
      meeting_date: string;
      check_in_at: string;
      check_out_at: string | null;
      status: string;
    }>();

    expect(sessions.results).toEqual([
      {
        student_id: "100001",
        meeting_date: "2026-01-02",
        check_in_at: "2026-01-02T20:00:00.000Z",
        check_out_at: null,
        status: "open"
      },
      {
        student_id: "100003",
        meeting_date: "2026-01-02",
        check_in_at: "2026-01-02T20:00:30.000Z",
        check_out_at: null,
        status: "open"
      }
    ]);
  });

  it("accepts delayed adjacent-date scans inside the duplicate window", async () => {
    const env = createTestEnv();

    await syncKioskEvents(env, "door-02", [{
      localEventId: "door-jan-3",
      memberId: "100001",
      occurredAt: "2026-01-03T05:00:30.000Z",
      source: "fingerprint"
    }]);

    const delayedPreviousDate = await syncKioskEvents(env, "bench-01", [{
      localEventId: "bench-jan-2",
      memberId: "100001",
      occurredAt: "2026-01-03T04:59:30.000Z",
      source: "fingerprint"
    }]);

    expect(delayedPreviousDate.accepted).toHaveLength(1);
    expect(delayedPreviousDate.duplicates).toHaveLength(0);
    expect(delayedPreviousDate.acknowledgements?.[0]).toMatchObject({
      localEventId: "bench-jan-2",
      memberId: "100001",
      status: "accepted",
      action: "check_in",
      kioskMessage: "Welcome, Bench Student"
    });

    const sessions = await env.DB.prepare(
      "SELECT meeting_date, check_in_at, check_out_at, status, source_event_ids FROM attendance_sessions ORDER BY meeting_date ASC"
    ).all<{
      meeting_date: string;
      check_in_at: string;
      check_out_at: string | null;
      status: string;
      source_event_ids: string;
    }>();

    expect(sessions.results).toEqual([
      {
        meeting_date: "2026-01-02",
        check_in_at: "2026-01-03T04:59:30.000Z",
        check_out_at: null,
        status: "open",
        source_event_ids: JSON.stringify(["bench-01:bench-jan-2"])
      },
      {
        meeting_date: "2026-01-03",
        check_in_at: "2026-01-03T05:00:30.000Z",
        check_out_at: null,
        status: "open",
        source_event_ids: JSON.stringify(["door-02:door-jan-3"])
      }
    ]);
  });

  it("keeps sessions unchanged when a delayed duplicate arrives out of order", async () => {
    const env = createTestEnv();

    await syncKioskEvents(env, "bench-01", [{
      localEventId: "bench-arrive",
      memberId: "100001",
      occurredAt: "2026-01-02T20:00:00.000Z",
      source: "fingerprint"
    }]);
    await syncKioskEvents(env, "door-02", [{
      localEventId: "door-leave",
      memberId: "100001",
      occurredAt: "2026-01-02T22:00:00.000Z",
      source: "fingerprint"
    }]);

    await syncKioskEvents(env, "pit-01", [{
      localEventId: "pit-delayed-duplicate",
      memberId: "100001",
      occurredAt: "2026-01-02T20:01:00.000Z",
      source: "fingerprint"
    }]);

    const sessions = await env.DB.prepare(
      "SELECT check_in_at, check_out_at, status, source_event_ids FROM attendance_sessions ORDER BY check_in_at ASC"
    ).all<{
      check_in_at: string;
      check_out_at: string | null;
      status: string;
      source_event_ids: string;
    }>();

    expect(sessions.results).toEqual([{
      check_in_at: "2026-01-02T20:00:00.000Z",
      check_out_at: "2026-01-02T22:00:00.000Z",
      status: "closed",
      source_event_ids: JSON.stringify(["bench-01:bench-arrive", "door-02:door-leave"])
    }]);
  });

  it("returns roster issue details for inactive member scans", async () => {
    const env = createTestEnv();
    await env.DB.prepare("INSERT INTO students (student_id, first_name, last_name, active) VALUES (?, ?, ?, 0)")
      .bind("100002", "Inactive", "Member")
      .run();

    const rejected = await syncKioskEvents(env, "bench-01", [{
      localEventId: "scan-inactive",
      memberId: "100002",
      occurredAt: "2026-01-02T20:00:00.000Z",
      source: "fingerprint"
    }]);

    expect(rejected.acknowledgements?.[0]).toMatchObject({
      localEventId: "scan-inactive",
      memberId: "100002",
      status: "rejected",
      displayName: "Inactive Member",
      kioskMessage: "Roster issue",
      kioskDetail: "Inactive Member, this Member ID is not active. Ask a mentor for help.",
      message: "this Member ID is not active. Ask a mentor for help."
    });
  });

  it("uses Member ID fallback copy when rejected scans have no roster name", async () => {
    const env = createTestEnv();

    const rejected = await syncKioskEvents(env, "bench-01", [{
      localEventId: "scan-missing-member",
      memberId: "999999",
      occurredAt: "2026-01-02T20:00:00.000Z",
      source: "fingerprint"
    }]);

    expect(rejected.acknowledgements?.[0]).toMatchObject({
      localEventId: "scan-missing-member",
      memberId: "999999",
      status: "rejected",
      displayName: undefined,
      kioskMessage: "Roster issue",
      kioskDetail: "Member ID 999999, this Member ID is not active. Ask a mentor for help.",
      message: "this Member ID is not active. Ask a mentor for help."
    });
  });

  it("uses Member ID fallback copy when replayed accepted and duplicate scans lose their roster name", async () => {
    const env = createTestEnv();

    await syncKioskEvents(env, "bench-01", [{
      localEventId: "scan-accepted",
      memberId: "100001",
      occurredAt: "2026-01-02T20:00:00.000Z",
      source: "fingerprint"
    }]);
    await syncKioskEvents(env, "bench-01", [{
      localEventId: "scan-duplicate",
      memberId: "100001",
      occurredAt: "2026-01-02T20:00:30.000Z",
      source: "fingerprint"
    }]);
    await env.DB.prepare("DELETE FROM students WHERE student_id = ?").bind("100001").run();

    const acceptedReplay = await syncKioskEvents(env, "bench-01", [{
      localEventId: "scan-accepted",
      memberId: "100001",
      occurredAt: "2026-01-02T20:00:00.000Z",
      source: "fingerprint"
    }]);
    const duplicateReplay = await syncKioskEvents(env, "bench-01", [{
      localEventId: "scan-duplicate",
      memberId: "100001",
      occurredAt: "2026-01-02T20:00:30.000Z",
      source: "fingerprint"
    }]);

    expect(acceptedReplay.acknowledgements?.[0]).toMatchObject({
      localEventId: "scan-accepted",
      status: "accepted",
      displayName: undefined,
      action: "check_in",
      kioskMessage: "Welcome, Member ID 100001",
      kioskDetail: "Checked in at 3:00 PM.",
      message: "Welcome, Member ID 100001"
    });
    expect(duplicateReplay.acknowledgements?.[0]).toMatchObject({
      localEventId: "scan-duplicate",
      status: "duplicate",
      displayName: undefined,
      kioskMessage: "Already recorded",
      kioskDetail: "Member ID 100001, your attendance was already recorded. Please wait a moment before scanning again.",
      message: "Scan was already recorded."
    });
  });

  it("rebuilds sessions by scan time when kiosks sync delayed events out of order", async () => {
    const env = createTestEnv();

    await syncKioskEvents(env, "pit-01", [{
      localEventId: "pit-late-checkout",
      memberId: "100001",
      occurredAt: "2026-01-02T22:00:00.000Z",
      source: "fingerprint"
    }]);

    await syncKioskEvents(env, "bench-01", [{
      localEventId: "bench-early-checkin",
      memberId: "100001",
      occurredAt: "2026-01-02T20:00:00.000Z",
      source: "fingerprint"
    }]);

    const sessions = await env.DB.prepare(
      "SELECT student_id, meeting_date, check_in_at, check_out_at, status, source_event_ids FROM attendance_sessions ORDER BY check_in_at ASC"
    ).all<{
      student_id: string;
      meeting_date: string;
      check_in_at: string;
      check_out_at: string | null;
      status: string;
      source_event_ids: string;
    }>();

    expect(sessions.results).toEqual([{
      student_id: "100001",
      meeting_date: "2026-01-02",
      check_in_at: "2026-01-02T20:00:00.000Z",
      check_out_at: "2026-01-02T22:00:00.000Z",
      status: "closed",
      source_event_ids: JSON.stringify(["bench-01:bench-early-checkin", "pit-01:pit-late-checkout"])
    }]);
  });

  it("keeps delayed multi-kiosk scans in chronological session pairs", async () => {
    const env = createTestEnv();

    await syncKioskEvents(env, "door-02", [{
      localEventId: "door-return",
      memberId: "100001",
      occurredAt: "2026-01-02T22:30:00.000Z",
      source: "fingerprint"
    }]);

    await syncKioskEvents(env, "bench-01", [
      {
        localEventId: "bench-arrive",
        memberId: "100001",
        occurredAt: "2026-01-02T20:00:00.000Z",
        source: "fingerprint"
      },
      {
        localEventId: "bench-leave",
        memberId: "100001",
        occurredAt: "2026-01-02T21:00:00.000Z",
        source: "fingerprint"
      }
    ]);

    const sessions = await env.DB.prepare(
      "SELECT check_in_at, check_out_at, status, source_event_ids FROM attendance_sessions ORDER BY check_in_at ASC"
    ).all<{
      check_in_at: string;
      check_out_at: string | null;
      status: string;
      source_event_ids: string;
    }>();

    expect(sessions.results).toEqual([
      {
        check_in_at: "2026-01-02T20:00:00.000Z",
        check_out_at: "2026-01-02T21:00:00.000Z",
        status: "closed",
        source_event_ids: JSON.stringify(["bench-01:bench-arrive", "bench-01:bench-leave"])
      },
      {
        check_in_at: "2026-01-02T22:30:00.000Z",
        check_out_at: null,
        status: "open",
        source_event_ids: JSON.stringify(["door-02:door-return"])
      }
    ]);
  });

  it("orders interleaved delayed multi-student kiosk queues by each student's scan time", async () => {
    const env = createTestEnv();

    await syncKioskEvents(env, "door-02", [
      {
        localEventId: "door-bench-student-out",
        memberId: "100001",
        occurredAt: "2026-01-02T22:00:00.000Z",
        source: "fingerprint"
      },
      {
        localEventId: "door-second-student-out",
        memberId: "100003",
        occurredAt: "2026-01-02T22:15:00.000Z",
        source: "fingerprint"
      }
    ]);

    const delayedReplay = await syncKioskEvents(env, "bench-01", [
      {
        localEventId: "bench-bench-student-in",
        memberId: "100001",
        occurredAt: "2026-01-02T20:00:00.000Z",
        source: "fingerprint"
      },
      {
        localEventId: "bench-second-student-in",
        memberId: "100003",
        occurredAt: "2026-01-02T20:10:00.000Z",
        source: "fingerprint"
      }
    ]);

    expect(delayedReplay.acknowledgements).toEqual([
      expect.objectContaining({
        localEventId: "bench-bench-student-in",
        memberId: "100001",
        status: "accepted",
        action: "check_in",
        kioskMessage: "Welcome, Bench Student"
      }),
      expect.objectContaining({
        localEventId: "bench-second-student-in",
        memberId: "100003",
        status: "accepted",
        action: "check_in",
        kioskMessage: "Welcome, Second Student"
      })
    ]);

    const sessions = await env.DB.prepare(
      "SELECT student_id, check_in_at, check_out_at, status, source_event_ids FROM attendance_sessions ORDER BY student_id ASC, check_in_at ASC"
    ).all<{
      student_id: string;
      check_in_at: string;
      check_out_at: string | null;
      status: string;
      source_event_ids: string;
    }>();

    expect(sessions.results).toEqual([
      {
        student_id: "100001",
        check_in_at: "2026-01-02T20:00:00.000Z",
        check_out_at: "2026-01-02T22:00:00.000Z",
        status: "closed",
        source_event_ids: JSON.stringify(["bench-01:bench-bench-student-in", "door-02:door-bench-student-out"])
      },
      {
        student_id: "100003",
        check_in_at: "2026-01-02T20:10:00.000Z",
        check_out_at: "2026-01-02T22:15:00.000Z",
        status: "closed",
        source_event_ids: JSON.stringify(["bench-01:bench-second-student-in", "door-02:door-second-student-out"])
      }
    ]);
  });

  it("acknowledges a delayed earlier scan by its chronological action", async () => {
    const env = createTestEnv();

    await syncKioskEvents(env, "pit-01", [{
      localEventId: "pit-late-checkout",
      memberId: "100001",
      occurredAt: "2026-01-02T22:00:00.000Z",
      source: "fingerprint"
    }]);

    const delayed = await syncKioskEvents(env, "bench-01", [{
      localEventId: "bench-early-checkin",
      memberId: "100001",
      occurredAt: "2026-01-02T20:00:00.000Z",
      source: "fingerprint"
    }]);

    expect(delayed.acknowledgements?.[0]).toMatchObject({
      localEventId: "bench-early-checkin",
      status: "accepted",
      action: "check_in",
      kioskMessage: "Welcome, Bench Student",
      kioskDetail: "Checked in at 3:00 PM. Attendance 100% (1/1)",
      message: "Welcome, Bench Student"
    });
  });

  it("derives acknowledgement actions per accepted scan when replayed after out-of-order sync", async () => {
    const env = createTestEnv();

    await syncKioskEvents(env, "pit-01", [{
      localEventId: "pit-late-checkout",
      memberId: "100001",
      occurredAt: "2026-01-02T22:00:00.000Z",
      source: "fingerprint"
    }]);
    await syncKioskEvents(env, "bench-01", [{
      localEventId: "bench-early-checkin",
      memberId: "100001",
      occurredAt: "2026-01-02T20:00:00.000Z",
      source: "fingerprint"
    }]);

    const replay = await syncKioskEvents(env, "pit-01", [{
      localEventId: "pit-late-checkout",
      memberId: "100001",
      occurredAt: "2026-01-02T22:00:00.000Z",
      source: "fingerprint"
    }]);

    expect(replay.acknowledgements?.[0]).toMatchObject({
      localEventId: "pit-late-checkout",
      status: "accepted",
      action: "check_out",
      kioskMessage: "Goodbye, Bench Student",
      kioskDetail: "Checked out at 5:00 PM. Attendance 100% (1/1)",
      message: "Goodbye, Bench Student"
    });
  });

  it("audits a per-meeting removal while preserving original scan events", async () => {
    const env = createTestEnv();
    await env.DB.prepare(`
      INSERT INTO scheduled_meetings (id, meeting_date, title, required, created_at, updated_at)
      VALUES ('meeting-jan-2', '2026-01-02', 'Build meeting', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    `).run();
    await syncKioskEvents(env, "bench-01", [{
      localEventId: "remove-me-in",
      memberId: "100001",
      occurredAt: "2026-01-02T20:00:00.000Z",
      source: "fingerprint"
    }, {
      localEventId: "remove-me-out",
      memberId: "100001",
      occurredAt: "2026-01-02T22:00:00.000Z",
      source: "fingerprint"
    }]);

    const correction = await removeMemberFromMeeting(env, {
      memberId: "100001",
      meetingDate: "2026-01-02",
      reason: "Fingerprint was scanned by the wrong member",
      adminEmail: "mentor@example.org"
    });

    expect(correction).toMatchObject({
      memberId: "100001",
      firstName: "Bench",
      lastName: "Student",
      meetingDate: "2026-01-02",
      reason: "Fingerprint was scanned by the wrong member",
      adminEmail: "mentor@example.org",
      preservedSourceEventIds: ["bench-01:remove-me-in", "bench-01:remove-me-out"]
    });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM scan_events WHERE student_id = ?").bind("100001").first<{ count: number }>()).toEqual({ count: 2 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM attendance_sessions WHERE student_id = ? AND meeting_date = ?").bind("100001", "2026-01-02").first<{ count: number }>()).toEqual({ count: 0 });
    expect(await env.DB.prepare("SELECT student_id, meeting_date, reason, admin_email FROM attendance_exclusions").first()).toEqual({
      student_id: "100001",
      meeting_date: "2026-01-02",
      reason: "Fingerprint was scanned by the wrong member",
      admin_email: "mentor@example.org"
    });
    const presence = await buildPresenceReport(env, "2026-01-02");
    expect(presence.rows.find((row) => row.memberId === "100001")?.status).toBe("not_seen");
    const absences = await buildMeetingAbsenceReport(env, "2026-01-02", new Date("2026-01-03T12:00:00.000Z"));
    expect(absences.rows).toContainEqual(expect.objectContaining({ memberId: "100001" }));
    const memberReport = await buildMemberAttendanceReport(env, "100001", {}, new Date("2026-01-03T12:00:00.000Z"));
    expect(memberReport).toMatchObject({ presentMeetings: 0, missedMeetings: 1, attendanceRate: 0 });
  });

  it("keeps an audited removal effective across later session rebuilds", async () => {
    const env = createTestEnv();
    await syncKioskEvents(env, "bench-01", [{
      localEventId: "original-scan",
      memberId: "100001",
      occurredAt: "2026-01-02T20:00:00.000Z",
      source: "fingerprint"
    }]);
    await removeMemberFromMeeting(env, {
      memberId: "100001",
      meetingDate: "2026-01-02",
      reason: "Confirmed absence",
      adminEmail: "mentor@example.org"
    });

    await rebuildAttendanceSessions(env);

    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM scan_events").first<{ count: number }>()).toEqual({ count: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM attendance_sessions").first<{ count: number }>()).toEqual({ count: 0 });
    await expect(removeMemberFromMeeting(env, {
      memberId: "100001",
      meetingDate: "2026-01-02",
      reason: "Duplicate correction",
      adminEmail: "mentor@example.org"
    })).rejects.toMatchObject({ status: 409 });
  });
});

function createTestEnv(overrides: Partial<Env> = {}): Env {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE students (
      student_id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      roster_synced_at TEXT,
      roster_hash TEXT,
      attendance_required_from_date TEXT
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
      rejection_reason TEXT,
      UNIQUE(kiosk_id, local_event_id)
    );

    CREATE TABLE manual_events (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT NOT NULL,
      admin_email TEXT NOT NULL
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

    CREATE TABLE attendance_excuses (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      meeting_date TEXT NOT NULL,
      reason TEXT,
      created_by_email TEXT NOT NULL,
      created_at TEXT NOT NULL,
      removed_by_email TEXT,
      removed_at TEXT
    );
  `);
  sqlite.prepare("INSERT INTO students (student_id, first_name, last_name, active) VALUES (?, ?, ?, 1)").run("100001", "Bench", "Student");
  sqlite.prepare("INSERT INTO students (student_id, first_name, last_name, active) VALUES (?, ?, ?, 1)").run("100003", "Second", "Student");

  return {
    DB: d1(sqlite),
    TIME_ZONE: "America/New_York",
    DUPLICATE_WINDOW_SECONDS: "90",
    ...overrides
  } as unknown as Env;
}

function d1(sqlite: Database.Database) {
  return {
    prepare(sql: string) {
      return new TestStatement(sqlite, sql);
    },
    async batch(statements: TestStatement[]) {
      return statements.map((statement) => statement.run());
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
