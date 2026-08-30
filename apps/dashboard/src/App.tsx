import { FormEvent, Fragment, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { apiBaseUrl, apiDelete, apiGet, apiPost, apiPut, type DashboardSession } from "./api";
import { buildClearMemberAttendanceSourceDataPayload, clearMemberAttendanceConfirmation } from "./attendanceDebugAction";
import { fingerLabelOptions, fingerprintEnrollmentName, fingerprintOwnerNavigation, nextAvailableFingerprintSlot, normalizeFingerLabel, type FingerprintEnrollment } from "./fingerprintEnrollment";
import { formatDateTime, formatTime, localTimeInputValue } from "./timeFormat";
import { publicDocsUrl } from "./publicDocs";
import "./styles.css";

type Tab = "overview" | "roster" | "admins" | "meetings" | "contests" | "kiosks" | "events" | "reports" | "export" | "docs";
type RosterViewTab = "active" | "deactivated" | "import";
type MeetingViewTab = "calendar" | "all" | "form";
type ThemeMode = "themed" | "light" | "dark";
type KioskCommandAction = "restart_display" | "restart_services" | "reboot_system";
type KioskCommandStatus = "pending" | "running" | "completed" | "failed";
type KioskHealthStatus = "online" | "degraded" | "offline" | "unknown";

interface MemberRow {
  [key: string]: unknown;
  memberId: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  discordUserId?: string | null;
  active: boolean;
  rosterSyncedAt?: string | null;
}

interface KioskRow {
  kiosk_id: string;
  name: string;
  location?: string;
  active: number;
  last_seen_at?: string;
  last_heartbeat_at?: string;
  reader_online?: number | null;
  pending_scan_count?: number;
  last_sync_at?: string;
  last_sync_error?: string;
}

interface KioskCommandRow {
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

interface AdminUserRow {
  email: string;
  role: "mentor" | "admin";
  active: boolean;
  lastLoginAt?: string;
}

interface ScheduledMeeting {
  id: string;
  meetingDate: string;
  title: string;
  required: boolean;
  startsAt?: string;
  endsAt?: string;
  notes?: string;
  discordScheduledEvent?: {
    guildId: string;
    eventId: string;
    location: string;
    status: string;
    lastSyncedAt?: string;
    lastError?: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

interface MeetingFormState {
  meetingDate: string;
  title: string;
  required: boolean;
  startTime: string;
  endTime: string;
  notes: string;
  repeats: boolean;
  startDate: string;
  endDate: string;
  weekdays: number[];
}

interface BulkMeetingEditState {
  titleEnabled: boolean;
  title: string;
  requiredEnabled: boolean;
  required: boolean;
  timesEnabled: boolean;
  startTime: string;
  endTime: string;
  notesEnabled: boolean;
  notes: string;
}

interface MeetingAbsenceNotificationResult {
  meetingDate: string;
  title: string | null;
  notificationKind: "meeting_absence";
  providerConfigured: boolean;
  mode: "preview" | "send";
  sentCount: number;
  skippedDuplicateCount: number;
  errorCount: number;
  recipients: Array<{
    memberId: string;
    firstName: string;
    lastName: string;
    email: string;
    status: "would_send" | "sent" | "error" | "skipped_duplicate";
    error?: string;
  }>;
  missingEmail: Array<{
    memberId: string;
    firstName: string;
    lastName: string;
    status: "missing_email";
  }>;
  warnings: string[];
}

interface MemberAttendanceReportNotificationResult {
  memberId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  reportDate: string;
  notificationKind: "member_attendance_report";
  providerConfigured: boolean;
  mode: "preview" | "send";
  sentCount: number;
  skippedDuplicateCount: number;
  errorCount: number;
  recipient: {
    memberId: string;
    firstName: string;
    lastName: string;
    email: string;
    status: "would_send" | "sent" | "error" | "skipped_duplicate";
    error?: string;
  } | null;
  missingEmail: Array<{
    memberId: string;
    firstName: string;
    lastName: string;
    status: "missing_email";
  }>;
  report: {
    attendanceRate: number | null;
    totalMeetings: number;
    presentMeetings: number;
    missedMeetings: number;
    missedMeetingsList: Array<{ meetingDate: string; title: string | null }>;
    optionalMeetings: Array<{ meetingDate: string; title: string | null; attended: boolean }>;
  };
  warnings: string[];
}

interface DiscordMissingMemberNotificationResult {
  meetingDate: string;
  title: string | null;
  notificationKind: "discord_missing_members" | "discord_bot_missing_members";
  providerConfigured: boolean;
  mode: "preview" | "send";
  sentCount: number;
  skippedDuplicateCount: number;
  errorCount: number;
  delayMinutes?: number;
  eligibleAt?: string;
  recipients: Array<{
    memberId: string;
    firstName: string;
    lastName: string;
    discordUserId: string;
    mention: string;
    status: "would_send" | "sent" | "error" | "skipped_duplicate";
    error?: string;
  }>;
  missingDiscord: Array<{
    memberId: string;
    firstName: string;
    lastName: string;
    status: "missing_discord";
  }>;
  warnings: string[];
}

type AttendanceContestStatus = "pending" | "acknowledged" | "resolved" | "rejected";

interface AttendanceContestRow {
  id: string;
  memberId: string;
  firstName: string;
  lastName: string;
  scheduledMeetingId: string;
  meetingDate: string;
  meetingTitle: string | null;
  discordUserId: string;
  sourceMessageId: string | null;
  sourceChannelId: string | null;
  reason: string | null;
  status: AttendanceContestStatus;
  createdAt: string;
  reviewedAt: string | null;
  reviewedByAdminEmail: string | null;
  reviewNote: string | null;
}

interface DiscordTestNotificationResult {
  notificationKind: "discord_test";
  providerConfigured: boolean;
  mode: "preview" | "send";
  sentCount: number;
  errorCount: number;
  status: "would_send" | "sent" | "error";
  providerMessageId?: string;
  error?: string;
  metadata: {
    appName: string;
    service: string;
    timestamp: string;
    notificationKind: "discord_test";
    workerVersion: string | null;
    workerVersionMetadataId: string | null;
    webhookKind: "missing_members";
  };
  warnings: string[];
}

interface DiscordScheduledEventSyncResult {
  notificationKind: "discord_scheduled_event_sync";
  providerConfigured: boolean;
  guildId: string | null;
  location: string;
  syncedCount: number;
  createdCount: number;
  updatedCount: number;
  errorCount: number;
  meetings: Array<{
    meetingId: string;
    meetingDate?: string;
    title?: string;
    discordEventId?: string;
    status: "created" | "updated" | "error";
    error?: string;
  }>;
  warnings: string[];
}

const defaultMeetingTitle = "Regular Meeting";
const defaultMeetingStartTime = "15:00";
const defaultMeetingEndTime = "17:30";
const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const googleAuthEnabled = Boolean(googleClientId);
const docsUrl = publicDocsUrl(import.meta.env.VITE_PUBLIC_DOCS_URL);
const fingerprintEnrollmentAvailable = !apiBaseUrl.includes("workers.dev");
const productionRosterPullAvailable = fingerprintEnrollmentAvailable;
const weekdayOptions = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" }
];

function App() {
  const [session, setSession] = useState<DashboardSession>(readStoredSession);
  const [tab, setTab] = useState<Tab>("overview");
  const [themeMode, setThemeMode] = useState<ThemeMode>(readStoredThemeMode);
  const [rosterNavigation, setRosterNavigation] = useState<{ memberId: string; requestId: string }>();

  function openRosterMember(memberId: string) {
    setRosterNavigation({ memberId, requestId: crypto.randomUUID() });
    setTab("roster");
  }

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    localStorage.setItem("dashboardThemeMode", themeMode);
  }, [themeMode]);

  if (!session.email || (googleAuthEnabled && !session.idToken)) {
    return <Login onLocalLogin={(email) => {
      localStorage.setItem("adminEmail", email);
      setSession({ email });
    }} onGoogleLogin={(googleSession) => {
      setSession(googleSession);
    }} themeMode={themeMode} onThemeChange={setThemeMode} />;
  }

  return (
    <main className="dashboard">
      <aside>
        <h1>Attendance Admin</h1>
        {(["overview", "roster", "admins", "meetings", "contests", "kiosks", "events", "reports", "export", "docs"] as Tab[]).map((item) => (
          <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
            {item}
          </button>
        ))}
      </aside>
      <section className="content">
        <header>
          <ThemeControl value={themeMode} onChange={setThemeMode} />
          <span>{session.email}</span>
          <button onClick={() => {
            localStorage.removeItem("adminEmail");
            sessionStorage.removeItem("googleIdToken");
            setSession({ email: "" });
          }}>Sign out</button>
        </header>
        {tab === "overview" && <Overview session={session} />}
        {tab === "roster" && <Roster session={session} navigation={rosterNavigation} />}
        {tab === "admins" && <AdminUsers session={session} />}
        {tab === "meetings" && <Meetings session={session} onOpenMember={openRosterMember} />}
        {tab === "contests" && <AttendanceContests session={session} onOpenReports={() => setTab("reports")} onOpenMember={openRosterMember} />}
        {tab === "kiosks" && <Kiosks session={session} />}
        {tab === "events" && <Events session={session} onOpenMember={openRosterMember} />}
        {tab === "reports" && <Reports session={session} onOpenMember={openRosterMember} />}
        {tab === "export" && <LegacyExport session={session} />}
        {tab === "docs" && <PublicDocs />}
      </section>
    </main>
  );
}

function PublicDocs() {
  const [frameState, setFrameState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const fallbackTimer = window.setTimeout(() => {
      setFrameState((current) => current === "loading" ? "error" : current);
    }, 12_000);
    return () => window.clearTimeout(fallbackTimer);
  }, []);

  return <section className="docs-reader" aria-labelledby="docs-reader-title" aria-busy={frameState === "loading"}>
    <div className="docs-reader-heading">
      <div>
        <h2 id="docs-reader-title">Operations Guide</h2>
        <p>Public, task-focused guidance for mentors and kiosk operators.</p>
      </div>
      <a className="docs-reader-open" href={docsUrl} target="_blank" rel="noreferrer">Open in new tab</a>
    </div>
    {frameState === "loading" ? <p className="notice info docs-reader-status">Loading the public guide…</p> : null}
    {frameState === "error" ? <div className="notice error docs-reader-status">The embedded guide could not load. <a href={docsUrl} target="_blank" rel="noreferrer">Open it in a new tab</a>.</div> : null}
    <iframe
      className="docs-reader-frame"
      title="FRC Attendance System public operations guide"
      src={docsUrl}
      onLoad={() => setFrameState("ready")}
      onError={() => setFrameState("error")}
    />
  </section>;
}

function AttendanceContests({ session, onOpenReports, onOpenMember }: { session: DashboardSession; onOpenReports: () => void; onOpenMember: (memberId: string) => void }) {
  const { data, error, loading, reload } = useApi<{ contests: AttendanceContestRow[] }>("/admin/attendance-contests", session);
  const [statusFilter, setStatusFilter] = useState<AttendanceContestStatus | "all">("pending");
  const contests = data?.contests ?? [];
  const visibleContests = statusFilter === "all" ? contests : contests.filter((contest) => contest.status === statusFilter);

  return (
    <section>
      <div className="section-heading">
        <div>
          <h2>Attendance Contests</h2>
          <p className="report-context">Approve a verified contest to create an audited present correction. Rejecting or marking reviewed leaves attendance unchanged.</p>
        </div>
        <button type="button" onClick={reload} disabled={loading}>Refresh</button>
      </div>
      <div className="toolbar wrap">
        <label className="field-label">
          <span>Status</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as AttendanceContestStatus | "all")}>
            <option value="pending">Pending</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="resolved">Resolved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
        </label>
        <button type="button" onClick={onOpenReports}>Open attendance correction tools</button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <AttendanceContestCards
        contests={visibleContests}
        session={session}
        onOpenMember={onOpenMember}
        onChanged={reload}
        emptyMessage={!loading ? `No ${statusFilter === "all" ? "" : `${statusFilter} `}attendance contests.` : "Loading attendance contests..."}
      />
    </section>
  );
}

function AttendanceContestCards({
  contests,
  session,
  onOpenMember,
  onChanged,
  emptyMessage
}: {
  contests: AttendanceContestRow[];
  session: DashboardSession;
  onOpenMember: (memberId: string) => void;
  onChanged: () => void;
  emptyMessage: string;
}) {
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [busyContestId, setBusyContestId] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string }>();

  async function reviewContest(contest: AttendanceContestRow, status: "acknowledged" | "rejected") {
    setBusyContestId(contest.id);
    setMessage(undefined);
    try {
      await apiPut<AttendanceContestRow>(`/admin/attendance-contests/${encodeURIComponent(contest.id)}`, {
        status,
        reviewNote: reviewNotes[contest.id]?.trim() || undefined
      }, session);
      const action = status === "rejected" ? "Rejected" : "Marked reviewed";
      setMessage({ kind: "success", text: `${action}: ${contest.firstName} ${contest.lastName}'s ${contest.meetingDate} contest. Attendance was not changed.` });
      onChanged();
    } catch (err) {
      setMessage({ kind: "error", text: friendlyDashboardError(err) });
    } finally {
      setBusyContestId("");
    }
  }

  async function approveContest(contest: AttendanceContestRow) {
    if (!window.confirm(`Approve ${contest.firstName} ${contest.lastName}'s contest and create an audited present correction for ${contest.meetingDate}?`)) return;
    setBusyContestId(contest.id);
    setMessage(undefined);
    try {
      await apiPost(`/admin/attendance-contests/${encodeURIComponent(contest.id)}/approve`, {
        reviewNote: reviewNotes[contest.id]?.trim() || undefined
      }, session);
      setMessage({ kind: "success", text: `Approved ${contest.firstName} ${contest.lastName}'s contest and marked them present for ${contest.meetingDate}.` });
      onChanged();
    } catch (err) {
      setMessage({ kind: "error", text: friendlyDashboardError(err) });
    } finally {
      setBusyContestId("");
    }
  }

  return (
    <>
      {message ? <p className={`notice ${message.kind}`}>{message.text}</p> : null}
      {contests.length === 0 ? <p className="empty-state">{emptyMessage}</p> : null}
      <div className="contest-list">
        {contests.map((contest) => (
          <article className="contest-row" key={contest.id}>
            <div className="contest-summary">
              <div>
                <button type="button" className="link-button member-name-link" onClick={() => onOpenMember(contest.memberId)} title="Open roster details">
                  {contest.firstName} {contest.lastName}
                </button>
                <span>Member {contest.memberId} · Discord {contest.discordUserId}</span>
              </div>
              <span className={`status-badge ${contest.status}`}>{contest.status}</span>
            </div>
            <p><strong>{contest.meetingTitle ?? "Required meeting"}</strong> · {contest.meetingDate}</p>
            <p className="report-context">
              Contested {formatDateTime(contest.createdAt)}
              {contest.reviewedAt ? ` · Reviewed ${formatDateTime(contest.reviewedAt)} by ${contest.reviewedByAdminEmail ?? "admin"}` : ""}
            </p>
            {contest.reason ? <p className="report-context">Member note: {contest.reason}</p> : null}
            {contest.reviewNote ? <p className="notice info">Review note: {contest.reviewNote}</p> : null}
            {contest.status === "pending" ? (
              <>
                <label className="field-label wide-field">
                  <span>Review or correction note</span>
                  <input
                    value={reviewNotes[contest.id] ?? ""}
                    onChange={(event) => setReviewNotes((notes) => ({ ...notes, [contest.id]: event.target.value }))}
                    placeholder="Optional; approval also records the reviewing admin"
                    maxLength={1000}
                  />
                </label>
                <div className="kiosk-actions">
                  <button type="button" disabled={busyContestId === contest.id} onClick={() => approveContest(contest)}>Approve and mark present</button>
                  <button type="button" disabled={busyContestId === contest.id} onClick={() => reviewContest(contest, "acknowledged")}>Mark reviewed/no attendance change</button>
                  <button type="button" className="danger-button" disabled={busyContestId === contest.id} onClick={() => reviewContest(contest, "rejected")}>Reject</button>
                </div>
              </>
            ) : null}
          </article>
        ))}
      </div>
    </>
  );
}

function ThemeControl({ value, onChange }: { value: ThemeMode; onChange: (value: ThemeMode) => void }) {
  return (
    <label className="theme-control">
      <span>Theme</span>
      <select value={value} onChange={(event) => onChange(event.target.value as ThemeMode)}>
        <option value="themed">Themed</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}

function Login({
  onLocalLogin,
  onGoogleLogin,
  themeMode,
  onThemeChange
}: {
  onLocalLogin: (email: string) => void;
  onGoogleLogin: (session: DashboardSession) => void;
  themeMode: ThemeMode;
  onThemeChange: (value: ThemeMode) => void;
}) {
  useEffect(() => {
    if (!googleClientId) return;
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const google = (window as unknown as {
        google?: {
          accounts: {
            id: {
              initialize: (config: { client_id: string; callback: (response: { credential: string }) => void }) => void;
              renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
            };
          };
        };
      }).google;
      const target = document.getElementById("google-sign-in");
      if (!google || !target) return;
      google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (response) => {
          const encodedPayload = response.credential.split(".")[1];
          if (!encodedPayload) return;
          const payload = decodeGooglePayload(encodedPayload);
          const email = payload.email.toLowerCase();
          localStorage.setItem("adminEmail", email);
          sessionStorage.setItem("googleIdToken", response.credential);
          onGoogleLogin({ email, idToken: response.credential });
        }
      });
      google.accounts.id.renderButton(target, { theme: "outline", size: "large", width: 320 });
    };
    document.head.appendChild(script);
    return () => script.remove();
  }, []);

  if (googleAuthEnabled) {
    return (
      <main className="login">
        <div className="login-theme"><ThemeControl value={themeMode} onChange={onThemeChange} /></div>
        <section className="login-panel">
          <h1>Attendance Admin</h1>
          <p>Sign in with the configured Google account to manage attendance.</p>
          <div id="google-sign-in" />
          <p className="login-note">Email-only local login is disabled for this configured deployment.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="login">
      <div className="login-theme"><ThemeControl value={themeMode} onChange={onThemeChange} /></div>
      <form onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onLocalLogin(String(form.get("email")));
      }}>
        <h1>Attendance Admin</h1>
        <p>Local development can use an allowlisted mentor email when no Google client ID is configured.</p>
        <input name="email" type="email" placeholder="mentor@example.org" required />
        <button>Continue</button>
      </form>
    </main>
  );
}

function Overview({ session }: { session: DashboardSession }) {
  const { data: kiosks } = useApi<{ kiosks: unknown[] }>("/admin/kiosks", session);
  const { data: events } = useApi<{ events: unknown[] }>("/admin/events", session);
  const [discordTestBusy, setDiscordTestBusy] = useState(false);
  const [discordTestResult, setDiscordTestResult] = useState<DiscordTestNotificationResult>();
  const [discordTestMessage, setDiscordTestMessage] = useState<{ kind: "success" | "error"; text: string }>();

  async function sendDiscordTest() {
    setDiscordTestBusy(true);
    setDiscordTestMessage(undefined);
    try {
      const result = await apiPost<DiscordTestNotificationResult>("/admin/notifications/discord/test", {}, session);
      setDiscordTestResult(result);
      setDiscordTestMessage({
        kind: result.errorCount > 0 ? "error" : "success",
        text: discordTestSummary(result)
      });
    } catch (err) {
      setDiscordTestMessage({ kind: "error", text: friendlyDashboardError(err) });
    } finally {
      setDiscordTestBusy(false);
    }
  }

  return (
    <>
      <div className="grid">
        <Metric label="Kiosks" value={kiosks?.kiosks.length ?? 0} />
        <Metric label="Recent Events" value={events?.events.length ?? 0} />
        <Metric label="System" value="Online" />
      </div>
      <section>
        <h2>Notification Checks</h2>
        <div className="toolbar wrap">
          <button type="button" onClick={sendDiscordTest} disabled={discordTestBusy}>
            {discordTestBusy ? "Sending..." : "Send Discord test"}
          </button>
        </div>
        {discordTestMessage ? <p className={`notice ${discordTestMessage.kind}`}>{discordTestMessage.text}</p> : null}
        {discordTestResult ? <DiscordTestResultPanel result={discordTestResult} /> : null}
      </section>
    </>
  );
}

function Roster({ session, navigation }: { session: DashboardSession; navigation?: { memberId: string; requestId: string } }) {
  const { data, error, reload } = useApi<{ members: MemberRow[] }>("/admin/members", session);
  const { data: rosterSummary, error: rosterSummaryError, reload: reloadRosterSummary } = useApi<{ members: RosterAttendanceSummaryRow[] }>("/admin/reports/roster-attendance", session);
  const { data: meetingSummary } = useApi<{ meetings: MeetingSummaryReportRow[] }>("/admin/reports/meetings", session);
  const { data: enrollmentData, error: enrollmentError, reload: reloadEnrollments } = useOptionalApi<{ enrollments: FingerprintEnrollment[] }>(
    fingerprintEnrollmentAvailable ? "/admin/fingerprint/enrollments" : undefined,
    session
  );
  const [rosterViewTab, setRosterViewTab] = useState<RosterViewTab>("active");
  const [rosterSearch, setRosterSearch] = useState("");
  const [importText, setImportText] = useState("memberId,firstName,lastName,email,discordUserId\n100001,Bench,Member,bench@example.org,");
  const [importMessage, setImportMessage] = useState<string>();
  const [emailDrafts, setEmailDrafts] = useState<Record<string, string>>({});
  const [discordDrafts, setDiscordDrafts] = useState<Record<string, string>>({});
  const [memberMessage, setMemberMessage] = useState<{ kind: "success" | "error"; text: string }>();
  const [busyMemberId, setBusyMemberId] = useState<string>();
  const [memberReportEmailBusyId, setMemberReportEmailBusyId] = useState<string>();
  const [memberReportEmailResult, setMemberReportEmailResult] = useState<MemberAttendanceReportNotificationResult>();
  const [pullingRoster, setPullingRoster] = useState(false);
  const [selectedDetailMemberId, setSelectedDetailMemberId] = useState("");
  const [enrollMemberId, setEnrollMemberId] = useState("");
  const [enrollSlot, setEnrollSlot] = useState("");
  const [enrollFingerLabel, setEnrollFingerLabel] = useState("right-index");
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [enrollMessage, setEnrollMessage] = useState<{ kind: "info" | "success" | "error"; text: string }>();
  const [enrolling, setEnrolling] = useState(false);
  const { data: memberReport, error: memberReportError, reload: reloadMemberReport } = useOptionalApi<MemberAttendanceReport>(
    selectedDetailMemberId ? `/admin/reports/member?memberId=${encodeURIComponent(selectedDetailMemberId)}` : undefined,
    session
  );
  const { data: sessionRows } = useOptionalApi<{ sessions: Array<Record<string, unknown>> }>(
    selectedDetailMemberId ? "/admin/reports/sessions" : undefined,
    session
  );
  const activeMembers = data?.members.filter((member) => member.active) ?? [];
  const deactivatedMembers = data?.members.filter((member) => !member.active) ?? [];
  const rosterSearchQuery = rosterSearch.trim();
  const attendanceByMemberId = new Map((rosterSummary?.members ?? []).map((member) => [member.memberId, member]));
  const activeRosterRows = activeMembers.map((member) => {
    const attendance = attendanceByMemberId.get(member.memberId);
    return {
      ...member,
      attendance: formatPercent(attendance?.attendanceRate ?? null)
    };
  });
  const filteredActiveRosterRows = activeRosterRows.filter((member) => memberMatchesRosterSearch(member, rosterSearchQuery));
  const filteredDeactivatedMembers = deactivatedMembers.filter((member) => memberMatchesRosterSearch(member, rosterSearchQuery));
  const activeEmptyMessage = rosterSearchQuery ? "No active members match this search." : "No active members yet.";
  const deactivatedEmptyMessage = rosterSearchQuery ? "No deactivated members match this search." : "No deactivated members.";
  const enrollments = enrollmentData?.enrollments ?? [];
  const meetingSummaryRows = meetingSummary?.meetings ?? [];
  const nextOpenSlot = nextAvailableFingerprintSlot(enrollments);
  const selectedSlot = Number(enrollSlot);
  const occupiedEnrollment = Number.isFinite(selectedSlot) && selectedSlot > 0
    ? enrollments.find((enrollment) => enrollment.slot === selectedSlot)
    : undefined;
  const selectedEnrollmentMember = activeMembers.find((member) => member.memberId === enrollMemberId);
  const overwriteBlocked = Boolean(occupiedEnrollment && !confirmOverwrite);
  const selectedDetailMember = data?.members.find((member) => member.memberId === selectedDetailMemberId);

  useEffect(() => {
    if (!fingerprintEnrollmentAvailable || enrollSlot) return;
    setEnrollSlot(String(nextAvailableFingerprintSlot(enrollments)));
  }, [enrollSlot, enrollments]);

  useEffect(() => {
    setConfirmOverwrite(false);
  }, [enrollSlot, enrollMemberId]);

  useEffect(() => {
    if (!selectedDetailMember?.active) return;
    setEnrollMemberId(selectedDetailMember.memberId);
  }, [selectedDetailMember?.active, selectedDetailMember?.memberId]);

  useEffect(() => {
    if (!data?.members) return;
    setEmailDrafts((drafts) => {
      const next = { ...drafts };
      for (const member of data.members) {
        if (next[member.memberId] === undefined) next[member.memberId] = member.email ?? "";
      }
      return next;
    });
    setDiscordDrafts((drafts) => {
      const next = { ...drafts };
      for (const member of data.members) {
        if (next[member.memberId] === undefined) next[member.memberId] = member.discordUserId ?? "";
      }
      return next;
    });
  }, [data?.members]);

  useEffect(() => {
    if (!navigation || !data?.members) return;
    const member = data.members.find((candidate) => candidate.memberId === navigation.memberId);
    if (!member) return;
    setRosterViewTab(member.active ? "active" : "deactivated");
    setRosterSearch(member.memberId);
    setSelectedDetailMemberId(member.memberId);
  }, [data?.members, navigation?.requestId]);

  async function saveMemberEmail(member: MemberRow) {
    const email = emailDrafts[member.memberId]?.trim() ?? "";
    setBusyMemberId(member.memberId);
    setMemberMessage(undefined);
    try {
      await apiPut(`/admin/members/${encodeURIComponent(member.memberId)}/email`, { email: email || null }, session);
      setMemberMessage({ kind: "success", text: `Saved email for ${member.firstName} ${member.lastName}.` });
      reload();
      reloadMemberReport();
    } catch (error) {
      setMemberMessage({ kind: "error", text: friendlyDashboardError(error) });
    } finally {
      setBusyMemberId(undefined);
    }
  }

  async function saveMemberDiscordUserId(member: MemberRow) {
    const discordUserId = discordDrafts[member.memberId]?.trim() ?? "";
    setBusyMemberId(member.memberId);
    setMemberMessage(undefined);
    try {
      await apiPut(`/admin/members/${encodeURIComponent(member.memberId)}/discord`, { discordUserId: discordUserId || null }, session);
      setMemberMessage({ kind: "success", text: `Saved Discord user ID for ${member.firstName} ${member.lastName}.` });
      reload();
    } catch (error) {
      setMemberMessage({ kind: "error", text: friendlyDashboardError(error) });
    } finally {
      setBusyMemberId(undefined);
    }
  }

  async function emailMemberAttendanceReport(member: MemberRow) {
    setMemberReportEmailBusyId(member.memberId);
    setMemberReportEmailResult(undefined);
    setMemberMessage(undefined);
    try {
      const preview = await apiPost<MemberAttendanceReportNotificationResult>("/admin/notifications/member-attendance-report", {
        memberId: member.memberId,
        preview: true
      }, session);
      setMemberReportEmailResult(preview);
      if (!preview.recipient) {
        setMemberMessage({ kind: "error", text: `Save an email address before sending ${member.firstName} ${member.lastName}'s attendance report.` });
        return;
      }
      if (!preview.providerConfigured) {
        setMemberMessage({ kind: "success", text: `Preview ready for ${member.firstName} ${member.lastName}; email sending is not configured.` });
        return;
      }
      if (!window.confirm(`Send current attendance report to ${preview.recipient.email}?`)) {
        setMemberMessage({ kind: "success", text: `Preview ready for ${member.firstName} ${member.lastName}; send cancelled.` });
        return;
      }
      const result = await apiPost<MemberAttendanceReportNotificationResult>("/admin/notifications/member-attendance-report", {
        memberId: member.memberId
      }, session);
      setMemberReportEmailResult(result);
      setMemberMessage({ kind: result.errorCount > 0 ? "error" : "success", text: memberAttendanceNotificationSummary(result) });
    } catch (error) {
      setMemberMessage({ kind: "error", text: friendlyDashboardError(error) });
    } finally {
      setMemberReportEmailBusyId(undefined);
    }
  }

  async function setMemberMeetingExcuse(member: MemberRow, meeting: MemberScheduledMeeting) {
    if (meeting.present) {
      setMemberMessage({ kind: "error", text: `${member.firstName} ${member.lastName} is present for ${meeting.meetingDate} and cannot be excused.` });
      return;
    }
    setBusyMemberId(member.memberId);
    setMemberMessage(undefined);
    try {
      if (meeting.excused) {
        if (!window.confirm(`Remove ${member.firstName} ${member.lastName}'s excuse for ${meeting.meetingDate}? The audit record will be retained.`)) return;
        await apiDelete(`/admin/members/${encodeURIComponent(member.memberId)}/excuses`, session, { meetingDate: meeting.meetingDate });
        setMemberMessage({ kind: "success", text: `Removed excuse for ${member.firstName} ${member.lastName} on ${meeting.meetingDate}.` });
      } else {
        const reason = window.prompt(`Optional mentor-visible reason for excusing ${member.firstName} ${member.lastName} on ${meeting.meetingDate}:`);
        if (reason === null) return;
        await apiPost(`/admin/members/${encodeURIComponent(member.memberId)}/excuses`, { meetingDate: meeting.meetingDate, reason }, session);
        setMemberMessage({ kind: "success", text: `Excused ${member.firstName} ${member.lastName} for ${meeting.meetingDate}. Team attendance remains unchanged.` });
      }
      reloadMemberReport();
      reloadRosterSummary();
    } catch (error) {
      setMemberMessage({ kind: "error", text: friendlyDashboardError(error) });
    } finally {
      setBusyMemberId(undefined);
    }
  }

  async function setMemberActive(member: MemberRow, active: boolean) {
    const verb = active ? "reactivate" : "deactivate";
    if (!active && !window.confirm(`Deactivate ${member.firstName} ${member.lastName}? Attendance history will be preserved and the member can be reactivated later.`)) return;
    setBusyMemberId(member.memberId);
    setMemberMessage(undefined);
    try {
      await apiPost(`/admin/members/${encodeURIComponent(member.memberId)}/${verb}`, {}, session);
      setMemberMessage({
        kind: "success",
        text: active
          ? `Reactivated ${member.firstName} ${member.lastName}.`
          : `Deactivated ${member.firstName} ${member.lastName}. Attendance history was preserved.`
      });
      reload();
      reloadRosterSummary();
    } catch (error) {
      setMemberMessage({ kind: "error", text: friendlyDashboardError(error) });
    } finally {
      setBusyMemberId(undefined);
    }
  }

  async function hardDeleteMember(member: MemberRow) {
    const phrase = `DELETE ${member.memberId}`;
    const entered = window.prompt(
      `Hard delete ${member.firstName} ${member.lastName} (${member.memberId})?\n\nThis permanently removes the roster row and associated attendance, event, report-linked, and local fingerprint mapping records where this API owns them. Dashboard admin users are not removed.\n\nType ${phrase} to continue.`
    );
    if (entered !== phrase) {
      setMemberMessage({ kind: "error", text: `Hard delete cancelled. Type ${phrase} exactly to delete this member.` });
      return;
    }
    setBusyMemberId(member.memberId);
    setMemberMessage(undefined);
    try {
      await apiDelete(`/admin/members/${encodeURIComponent(member.memberId)}`, session);
      setMemberMessage({ kind: "success", text: `Hard deleted ${member.firstName} ${member.lastName} and associated member data.` });
      if (selectedDetailMemberId === member.memberId) setSelectedDetailMemberId("");
      reload();
      reloadRosterSummary();
      reloadEnrollments();
    } catch (error) {
      setMemberMessage({ kind: "error", text: friendlyDashboardError(error) });
    } finally {
      setBusyMemberId(undefined);
    }
  }

  async function submitFingerprintEnrollment(mapOnly = false) {
    if (!fingerprintEnrollmentAvailable) {
      setEnrollMessage({
        kind: "error",
        text: "Open the Pi dashboard at http://AttKiosk:5174 to enroll fingerprints. The production dashboard cannot access the local reader."
      });
      return;
    }
    if (!selectedEnrollmentMember) {
      setEnrollMessage({
        kind: "error",
        text: "Open an active member's details before enrolling a fingerprint."
      });
      return;
    }
    if (occupiedEnrollment && !confirmOverwrite) {
      setEnrollMessage({
        kind: "error",
        text: `Slot ${occupiedEnrollment.slot} is mapped to ${fingerprintEnrollmentName(occupiedEnrollment)}. Check the replace confirmation before continuing.`
      });
      return;
    }
    setEnrolling(true);
    setEnrollMessage({
      kind: "info",
      text: mapOnly
        ? "Saving the slot mapping without changing the fingerprint sensor template."
        : "Enrollment is running. Place the selected finger on the reader, remove it when the reader light changes, then place the same finger again."
    });
    try {
      const path = mapOnly ? "/admin/fingerprint/map" : "/admin/fingerprint/enroll";
      await apiPost<{ message?: string }>(path, {
        memberId: enrollMemberId,
        slot: Number(enrollSlot),
        fingerLabel: enrollFingerLabel,
        confirmOverwrite
      }, session);
      const memberName = selectedEnrollmentMember ? `${selectedEnrollmentMember.firstName} ${selectedEnrollmentMember.lastName}` : enrollMemberId;
      setEnrollMessage({
        kind: "success",
        text: mapOnly
          ? `Slot ${enrollSlot} now maps to ${memberName}. Restarting the kiosk service is not required.`
          : `Fingerprint linked to ${memberName} using slot ${enrollSlot}. Test it on the kiosk screen now.`
      });
      setConfirmOverwrite(false);
      setEnrollSlot(String(nextAvailableFingerprintSlot(enrollments, selectedSlot)));
      reloadEnrollments();
    } catch (err) {
      setEnrollMessage({ kind: "error", text: friendlyEnrollmentError(err) });
    } finally {
      setEnrolling(false);
    }
  }

  async function deleteEnrollment(slot: number) {
    if (!window.confirm(`Remove the mapping for fingerprint slot ${slot}? The template on the sensor will not be deleted.`)) return;
    setEnrolling(true);
    try {
      await apiPost("/admin/fingerprint/enrollments/delete", { slot }, session);
      setEnrollMessage({ kind: "success", text: `Removed mapping for slot ${slot}. The sensor template was left in place.` });
      reloadEnrollments();
    } catch (err) {
      setEnrollMessage({ kind: "error", text: friendlyEnrollmentError(err) });
    } finally {
      setEnrolling(false);
    }
  }

  function startRemapEnrollment(enrollment: FingerprintEnrollment, targetMemberId?: string) {
    const memberId = targetMemberId ?? enrollment.memberId;
    if (!targetMemberId) {
      const navigation = fingerprintOwnerNavigation(enrollment);
      setRosterViewTab(navigation.rosterViewTab);
      setRosterSearch(navigation.rosterSearch);
    }
    setSelectedDetailMemberId(memberId);
    setEnrollMemberId(memberId);
    setEnrollSlot(String(enrollment.slot));
    setEnrollFingerLabel(normalizeFingerLabel(enrollment.fingerLabel));
    setConfirmOverwrite(false);
    setEnrollMessage({
      kind: "info",
      text: targetMemberId && targetMemberId !== enrollment.memberId
        ? `Slot ${enrollment.slot} is loaded to remap from ${fingerprintEnrollmentName(enrollment)}. Check the replace confirmation before saving changes.`
        : `Slot ${enrollment.slot} is loaded for remapping. Check the replace confirmation before saving changes.`
    });
  }

  function openMemberDetails(member: MemberRow, focusEnrollment = false) {
    setSelectedDetailMemberId((current) => current === member.memberId && !focusEnrollment ? "" : member.memberId);
    if (member.active) {
      setEnrollMemberId(member.memberId);
      if (focusEnrollment || !enrollSlot) setEnrollSlot(String(nextOpenSlot));
      if (!fingerLabelOptions.some(([value]) => value === enrollFingerLabel)) setEnrollFingerLabel("right-index");
    }
    if (focusEnrollment) {
      setEnrollMessage(undefined);
      setConfirmOverwrite(false);
    }
  }

  return (
    <>
      <section className="roster-section">
        <div className="section-heading">
          <h2>Roster</h2>
          <span className="muted">{activeMembers.length} active, {deactivatedMembers.length} deactivated</span>
        </div>
        <div className="roster-controls">
          <div className="meeting-tabs">
            {([
              ["active", "Active Members"],
              ["deactivated", "Deactivated Members"],
              ["import", "Roster Import"]
            ] as Array<[RosterViewTab, string]>).map(([value, label]) => (
              <button key={value} type="button" className={rosterViewTab === value ? "active" : ""} onClick={() => setRosterViewTab(value)}>
                {label}
              </button>
            ))}
          </div>
          {rosterViewTab !== "import" ? (
            <label className="roster-search">
              <span>Search</span>
              <input
                value={rosterSearch}
                onChange={(event) => setRosterSearch(event.target.value)}
                placeholder="ID or name"
                aria-label="Search roster by member ID or name"
              />
            </label>
          ) : null}
        </div>
        {memberMessage ? <p className={`notice ${memberMessage.kind}`}>{memberMessage.text}</p> : null}
        {error ?? rosterSummaryError ? <p className="error">{error ?? rosterSummaryError}</p> : null}
        {rosterViewTab === "active" ? (
          <MemberManagementTable
            members={filteredActiveRosterRows}
            busyMemberId={busyMemberId}
            onReactivate={(member) => setMemberActive(member, true)}
            onToggleDetails={(member) => openMemberDetails(member)}
            onEnrollFingerprint={(member) => openMemberDetails(member, true)}
            selectedMemberId={selectedDetailMemberId}
            renderDetails={(member) => (
              <MemberDetailsPanel
                member={member}
                emailDraft={emailDrafts[member.memberId] ?? member.email ?? ""}
                onEmailDraftChange={(email) => setEmailDrafts((drafts) => ({ ...drafts, [member.memberId]: email }))}
                onSaveEmail={() => saveMemberEmail(member)}
                discordDraft={discordDrafts[member.memberId] ?? member.discordUserId ?? ""}
                onDiscordDraftChange={(discordUserId) => setDiscordDrafts((drafts) => ({ ...drafts, [member.memberId]: discordUserId }))}
                onSaveDiscordUserId={() => saveMemberDiscordUserId(member)}
                onEmailAttendanceReport={() => emailMemberAttendanceReport(member)}
                onSetMeetingExcuse={(meeting) => setMemberMeetingExcuse(member, meeting)}
                onDeactivate={() => setMemberActive(member, false)}
                onHardDelete={() => hardDeleteMember(member)}
                busy={busyMemberId === member.memberId}
                reportEmailBusy={memberReportEmailBusyId === member.memberId}
                reportEmailResult={memberReportEmailResult?.memberId === member.memberId ? memberReportEmailResult : undefined}
                memberReport={memberReport?.memberId === member.memberId ? memberReport : undefined}
                memberReportError={selectedDetailMemberId === member.memberId ? memberReportError : undefined}
                meetingSummaryRows={meetingSummaryRows}
                sessionRows={sessionRows?.sessions ?? []}
                fingerprintEnrollmentAvailable={fingerprintEnrollmentAvailable}
                enrollments={enrollments}
                enrollMemberId={enrollMemberId}
                enrollSlot={enrollSlot}
                enrollFingerLabel={enrollFingerLabel}
                occupiedEnrollment={occupiedEnrollment}
                confirmOverwrite={confirmOverwrite}
                overwriteBlocked={overwriteBlocked}
                enrolling={enrolling}
                enrollMessage={enrollMessage}
                enrollmentError={enrollmentError}
                nextOpenSlot={nextOpenSlot}
                onEnrollSlotChange={setEnrollSlot}
                onEnrollFingerLabelChange={setEnrollFingerLabel}
                onConfirmOverwriteChange={setConfirmOverwrite}
                onSubmitEnrollment={submitFingerprintEnrollment}
                onDeleteEnrollment={deleteEnrollment}
                onRemapEnrollment={startRemapEnrollment}
              />
            )}
            emptyMessage={activeEmptyMessage}
            showAttendance
          />
        ) : null}
        {rosterViewTab === "deactivated" ? (
          <MemberManagementTable
            members={filteredDeactivatedMembers}
            busyMemberId={busyMemberId}
            onReactivate={(member) => setMemberActive(member, true)}
            onToggleDetails={(member) => openMemberDetails(member)}
            onEnrollFingerprint={(member) => openMemberDetails(member, true)}
            selectedMemberId={selectedDetailMemberId}
            renderDetails={(member) => (
              <MemberDetailsPanel
                member={member}
                emailDraft={emailDrafts[member.memberId] ?? member.email ?? ""}
                onEmailDraftChange={(email) => setEmailDrafts((drafts) => ({ ...drafts, [member.memberId]: email }))}
                onSaveEmail={() => saveMemberEmail(member)}
                discordDraft={discordDrafts[member.memberId] ?? member.discordUserId ?? ""}
                onDiscordDraftChange={(discordUserId) => setDiscordDrafts((drafts) => ({ ...drafts, [member.memberId]: discordUserId }))}
                onSaveDiscordUserId={() => saveMemberDiscordUserId(member)}
                onEmailAttendanceReport={() => emailMemberAttendanceReport(member)}
                onSetMeetingExcuse={(meeting) => setMemberMeetingExcuse(member, meeting)}
                onDeactivate={() => setMemberActive(member, false)}
                onHardDelete={() => hardDeleteMember(member)}
                busy={busyMemberId === member.memberId}
                reportEmailBusy={memberReportEmailBusyId === member.memberId}
                reportEmailResult={memberReportEmailResult?.memberId === member.memberId ? memberReportEmailResult : undefined}
                memberReport={memberReport?.memberId === member.memberId ? memberReport : undefined}
                memberReportError={selectedDetailMemberId === member.memberId ? memberReportError : undefined}
                meetingSummaryRows={meetingSummaryRows}
                sessionRows={sessionRows?.sessions ?? []}
                fingerprintEnrollmentAvailable={fingerprintEnrollmentAvailable}
                enrollments={enrollments}
                enrollMemberId={enrollMemberId}
                enrollSlot={enrollSlot}
                enrollFingerLabel={enrollFingerLabel}
                occupiedEnrollment={occupiedEnrollment}
                confirmOverwrite={confirmOverwrite}
                overwriteBlocked={overwriteBlocked}
                enrolling={enrolling}
                enrollMessage={enrollMessage}
                enrollmentError={enrollmentError}
                nextOpenSlot={nextOpenSlot}
                onEnrollSlotChange={setEnrollSlot}
                onEnrollFingerLabelChange={setEnrollFingerLabel}
                onConfirmOverwriteChange={setConfirmOverwrite}
                onSubmitEnrollment={submitFingerprintEnrollment}
                onDeleteEnrollment={deleteEnrollment}
                onRemapEnrollment={startRemapEnrollment}
              />
            )}
            emptyMessage={deactivatedEmptyMessage}
          />
        ) : null}
        {rosterViewTab === "import" ? (
          <form className="stack roster-import-form" onSubmit={async (event) => {
            event.preventDefault();
            try {
              const members = parseRosterCsv(importText);
              await apiPost("/admin/roster/sync", { members }, session);
              setImportMessage(`Synced ${members.length} members. Missing members were deactivated, not deleted.`);
              reload();
              reloadRosterSummary();
            } catch (error) {
              setImportMessage(friendlyDashboardError(error));
            }
          }}>
            <textarea value={importText} onChange={(event) => setImportText(event.target.value)} rows={8} />
            <p className="notice info">Roster import updates active members and deactivates missing members. It never hard deletes data.</p>
            <div className="toolbar compact">
              <button>Sync roster</button>
              {productionRosterPullAvailable ? (
                <button type="button" disabled={pullingRoster} onClick={async () => {
                  setPullingRoster(true);
                  try {
                    const result = await apiPost<{ synced: number; rosterSyncedAt?: string | null }>("/admin/roster/pull-production", {}, session);
                    setImportMessage(`Pulled ${result.synced} production members${result.rosterSyncedAt ? ` synced ${formatDateTime(result.rosterSyncedAt)}` : ""}. Missing local members were deactivated, not deleted.`);
                    reload();
                    reloadRosterSummary();
                  } catch (error) {
                    setImportMessage(friendlyDashboardError(error));
                  } finally {
                    setPullingRoster(false);
                  }
                }}>
                  {pullingRoster ? "Pulling..." : "Pull production roster"}
                </button>
              ) : null}
              {importMessage ? <span>{importMessage}</span> : null}
            </div>
          </form>
        ) : null}
      </section>
    </>
  );
}

function MemberManagementTable({
  members,
  busyMemberId,
  onReactivate,
  onToggleDetails,
  onEnrollFingerprint,
  selectedMemberId,
  renderDetails,
  emptyMessage,
  showAttendance = false
}: {
  members: Array<MemberRow & { attendance?: string; requiredMeetings?: number | string }>;
  busyMemberId?: string;
  onReactivate: (member: MemberRow) => void;
  onToggleDetails: (member: MemberRow) => void;
  onEnrollFingerprint: (member: MemberRow) => void;
  selectedMemberId: string;
  renderDetails: (member: MemberRow) => JSX.Element;
  emptyMessage: string;
  showAttendance?: boolean;
}) {
  if (members.length === 0) return <p className="empty-state">{emptyMessage}</p>;
  const columnCount = showAttendance ? 4 : 3;
  return (
    <div className="data-table-wrap">
      <table className="data-table roster-member-table">
        <thead>
          <tr>
            <th>Member ID</th>
            <th>Name</th>
            {showAttendance ? <th>Attendance</th> : null}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <Fragment key={member.memberId}>
              <tr>
                <td>{member.memberId}</td>
                <td>{member.firstName} {member.lastName}</td>
                {showAttendance ? <td>{member.attendance ?? ""}</td> : null}
                <td>
                  <div className="mapping-actions roster-row-actions">
                    <button
                      type="button"
                      className="disclosure-button"
                      disabled={busyMemberId === member.memberId}
                      onClick={() => onToggleDetails(member)}
                      aria-expanded={selectedMemberId === member.memberId}
                      aria-label={`${selectedMemberId === member.memberId ? "Collapse" : "Expand"} details for ${member.firstName} ${member.lastName}`}
                      title={`${selectedMemberId === member.memberId ? "Collapse" : "Expand"} member details`}
                    >
                      <span aria-hidden="true">{selectedMemberId === member.memberId ? "▾" : "▸"}</span>
                    </button>
                    {member.active && fingerprintEnrollmentAvailable ? (
                      <button type="button" disabled={busyMemberId === member.memberId} onClick={() => onEnrollFingerprint(member)}>Enroll fingerprint</button>
                    ) : null}
                    {!member.active ? (
                      <button type="button" disabled={busyMemberId === member.memberId} onClick={() => onReactivate(member)}>Reactivate</button>
                    ) : null}
                  </div>
                </td>
              </tr>
              {selectedMemberId === member.memberId ? (
                <tr className="member-detail-row">
                  <td colSpan={columnCount}>{renderDetails(member)}</td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MemberDetailsPanel({
  member,
  emailDraft,
  onEmailDraftChange,
  onSaveEmail,
  discordDraft,
  onDiscordDraftChange,
  onSaveDiscordUserId,
  onEmailAttendanceReport,
  onSetMeetingExcuse,
  onDeactivate,
  onHardDelete,
  busy,
  reportEmailBusy,
  reportEmailResult,
  memberReport,
  memberReportError,
  meetingSummaryRows,
  sessionRows,
  fingerprintEnrollmentAvailable,
  enrollments,
  enrollMemberId,
  enrollSlot,
  enrollFingerLabel,
  occupiedEnrollment,
  confirmOverwrite,
  overwriteBlocked,
  enrolling,
  enrollMessage,
  enrollmentError,
  nextOpenSlot,
  onEnrollSlotChange,
  onEnrollFingerLabelChange,
  onConfirmOverwriteChange,
  onSubmitEnrollment,
  onDeleteEnrollment,
  onRemapEnrollment
}: {
  member: MemberRow;
  emailDraft: string;
  onEmailDraftChange: (email: string) => void;
  onSaveEmail: () => void;
  discordDraft: string;
  onDiscordDraftChange: (discordUserId: string) => void;
  onSaveDiscordUserId: () => void;
  onEmailAttendanceReport: () => void;
  onSetMeetingExcuse: (meeting: MemberScheduledMeeting) => void;
  onDeactivate: () => void;
  onHardDelete: () => void;
  busy: boolean;
  reportEmailBusy: boolean;
  reportEmailResult?: MemberAttendanceReportNotificationResult;
  memberReport?: MemberAttendanceReport;
  memberReportError?: string;
  meetingSummaryRows: MeetingSummaryReportRow[];
  sessionRows: Array<Record<string, unknown>>;
  fingerprintEnrollmentAvailable: boolean;
  enrollments: FingerprintEnrollment[];
  enrollMemberId: string;
  enrollSlot: string;
  enrollFingerLabel: string;
  occupiedEnrollment?: FingerprintEnrollment;
  confirmOverwrite: boolean;
  overwriteBlocked: boolean;
  enrolling: boolean;
  enrollMessage?: { kind: "info" | "success" | "error"; text: string };
  enrollmentError?: string;
  nextOpenSlot: number;
  onEnrollSlotChange: (slot: string) => void;
  onEnrollFingerLabelChange: (label: string) => void;
  onConfirmOverwriteChange: (confirm: boolean) => void;
  onSubmitEnrollment: (mapOnly?: boolean) => void | Promise<void>;
  onDeleteEnrollment: (slot: number) => void;
  onRemapEnrollment: (enrollment: FingerprintEnrollment, targetMemberId?: string) => void;
}) {
  const meetingsByDate = new Map(meetingSummaryRows.map((meeting) => [meeting.meetingDate, meeting]));
  const missedMeetings = memberReport?.absentDates.map((date) => meetingsByDate.get(date) ?? {
    meetingDate: date,
    title: null,
    required: true
  }) ?? [];
  const optionalAttendanceDates = new Set(sessionRows
    .filter((row) => String(row.member_id ?? row.memberId ?? "") === member.memberId && Number(row.required ?? 1) === 0)
    .map((row) => String(row.meeting_date ?? row.meetingDate ?? "")));
  const optionalMeetings = meetingSummaryRows.filter((meeting) => !meeting.required);
  const canEmailAttendanceReport = Boolean(member.email?.trim());

  return (
    <div className="member-detail-panel">
      <div className="member-detail-grid">
        <div>
          <h3>{member.firstName} {member.lastName}</h3>
          <p className="report-context">{member.memberId}</p>
        </div>
        <label className="field-label member-email-field">
          <span>Email</span>
          <input type="email" value={emailDraft} onChange={(event) => onEmailDraftChange(event.target.value)} placeholder="name@example.org" />
        </label>
        <button type="button" disabled={busy} onClick={onSaveEmail}>{busy ? "Saving..." : "Save email"}</button>
        <label className="field-label member-email-field">
          <span>Discord User ID</span>
          <input value={discordDraft} onChange={(event) => onDiscordDraftChange(event.target.value)} inputMode="numeric" placeholder="123456789012345678" />
        </label>
        <button type="button" disabled={busy} onClick={onSaveDiscordUserId}>{busy ? "Saving..." : "Save Discord"}</button>
      </div>
      <div className="toolbar compact">
        <button type="button" disabled={reportEmailBusy || !canEmailAttendanceReport} onClick={onEmailAttendanceReport}>
          {reportEmailBusy ? "Preparing..." : "Email attendance report"}
        </button>
        {!canEmailAttendanceReport ? <span className="muted">Save an email address before sending this report.</span> : null}
      </div>
      {reportEmailResult ? <p className={`notice ${reportEmailResult.errorCount > 0 ? "error" : "success"}`}>{memberAttendanceNotificationSummary(reportEmailResult)}</p> : null}

      <div className="member-admin-actions">
        <div>
          <h4>Roster administration</h4>
          <p className="report-context">These actions affect this member only. Attendance history is preserved by deactivation; hard delete permanently removes member-owned data.</p>
        </div>
        <div className="mapping-actions">
          {member.active ? <button type="button" disabled={busy} onClick={onDeactivate}>Deactivate</button> : null}
          <button type="button" className="danger-button" disabled={busy} onClick={onHardDelete}>Hard delete</button>
        </div>
      </div>

      {memberReportError ? <p className="error">{memberReportError}</p> : null}
      {memberReport ? (
        <>
          <div className="grid compact-grid member-metrics">
            <Metric label="Required Attendance" value={formatPercent(memberReport.attendanceRate)} />
            <Metric label="Required Present" value={memberReport.presentMeetings} />
            <Metric label="Required Missed" value={memberReport.missedMeetings} />
            <Metric label="Class/Excused Attendance" value={formatPercent(memberReport.classAttendanceRate ?? null)} />
          </div>
          <div>
            <h4>Scheduled Meeting Excuses</h4>
            <p className="report-context">Excuses affect the separate class/excused percentage only. Team attendance and missed-meeting notifications still count an excused absence.</p>
            {memberReport.scheduledMeetings.length > 0 ? <ul className="plain-list">
              {memberReport.scheduledMeetings.map((meeting) => <li key={meeting.meetingDate}>
                {meetingSummaryLabel(meeting)} — {meeting.present ? "Present" : meeting.excused ? `Excused${meeting.excuseReason ? `: ${meeting.excuseReason}` : ""}` : meeting.required ? "Absent / not yet attended" : "Optional"}
                {!meeting.present ? <button type="button" disabled={busy} onClick={() => onSetMeetingExcuse(meeting)}>{meeting.excused ? "Remove excuse" : "Excuse"}</button> : null}
              </li>)}
            </ul> : <p className="empty-state">No scheduled meetings are available.</p>}
          </div>
          <div className="member-detail-lists">
            <div>
              <h4>Missed Required Meetings</h4>
              {missedMeetings.length > 0 ? (
                <ul className="plain-list">
                  {missedMeetings.map((meeting) => <li key={meeting.meetingDate}>{meetingSummaryLabel(meeting)}</li>)}
                </ul>
              ) : <p className="empty-state">No missed required meetings in the current report range.</p>}
            </div>
            <div>
              <h4>Optional Meetings</h4>
              {optionalMeetings.length > 0 ? (
                <ul className="plain-list">
                  {optionalMeetings.map((meeting) => (
                    <li key={meeting.meetingDate}>
                      {meetingSummaryLabel(meeting)} {optionalAttendanceDates.has(meeting.meetingDate) ? "(attended, not counted)" : "(not required)"}
                    </li>
                  ))}
                </ul>
              ) : <p className="empty-state">No optional meetings are available in the current report range.</p>}
            </div>
          </div>
        </>
      ) : <p className="empty-state">Loading attendance details...</p>}

      <div className="fingerprint-detail">
        <h4>Fingerprint</h4>
        {!fingerprintEnrollmentAvailable ? (
          <p className="notice info">
            Fingerprint enrollment must run from the Raspberry Pi dashboard at http://AttKiosk:5174 because it needs direct access to the local fingerprint reader.
          </p>
        ) : null}
        {fingerprintEnrollmentAvailable ? (
          <>
            {member.active ? (
              <form className="fingerprint-enroll-form" onSubmit={async (event) => {
                event.preventDefault();
                await onSubmitEnrollment(false);
              }}>
                <label className="field-label">
                  <span>Template slot</span>
                  <input value={enrollSlot} onChange={(event) => onEnrollSlotChange(event.target.value)} type="number" min="1" max="200" placeholder="Slot" required />
                </label>
                <label className="field-label">
                  <span>Finger</span>
                  <select value={normalizeFingerLabel(enrollFingerLabel)} onChange={(event) => onEnrollFingerLabelChange(event.target.value)} required>
                    {fingerLabelOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <button type="button" onClick={() => onEnrollSlotChange(String(nextOpenSlot))} disabled={enrolling}>Use slot {nextOpenSlot}</button>
                <button disabled={enrolling || enrollMemberId !== member.memberId || overwriteBlocked}>
                  {enrolling ? "Enrolling..." : "Enroll fingerprint"}
                </button>
                <button
                  type="button"
                  disabled={enrolling || enrollMemberId !== member.memberId || !enrollSlot || overwriteBlocked}
                  onClick={() => onSubmitEnrollment(true)}
                >
                  Save mapping only
                </button>
              </form>
            ) : <p className="empty-state">Reactivate this member before enrolling a fingerprint.</p>}
            {occupiedEnrollment ? (
              <label className="inline-check notice info">
                <input type="checkbox" checked={confirmOverwrite} onChange={(event) => onConfirmOverwriteChange(event.target.checked)} />
                Replace slot {occupiedEnrollment.slot}, currently mapped to {fingerprintEnrollmentName(occupiedEnrollment)}
              </label>
            ) : null}
            {enrollMessage && enrollMemberId === member.memberId ? <p className={`notice ${enrollMessage.kind}`}>{enrollMessage.text}</p> : null}
            {enrollmentError ? <p className="error">{enrollmentError}</p> : null}
            <FingerprintEnrollmentTable
              enrollments={enrollments}
              currentMemberId={member.memberId}
              onDelete={onDeleteEnrollment}
              onRemap={onRemapEnrollment}
              busy={enrolling}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function AdminUsers({ session }: { session: DashboardSession }) {
  const { data, error, reload } = useApi<{ adminUsers: AdminUserRow[] }>("/admin/admin-users", session);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<AdminUserRow["role"]>("mentor");
  const [newActive, setNewActive] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, Pick<AdminUserRow, "role" | "active">>>({});
  const [savingEmail, setSavingEmail] = useState<string>();
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string }>();

  useEffect(() => {
    if (!data?.adminUsers) return;
    setDrafts((current) => {
      const next = { ...current };
      for (const adminUser of data.adminUsers) {
        if (!next[adminUser.email]) next[adminUser.email] = { role: adminUser.role, active: adminUser.active };
      }
      return next;
    });
  }, [data?.adminUsers]);

  async function saveAdminUser(email: string, role: AdminUserRow["role"], active: boolean) {
    const normalizedEmail = email.trim().toLowerCase();
    setSavingEmail(normalizedEmail);
    setMessage(undefined);
    try {
      await apiPut<AdminUserRow>(`/admin/admin-users/${encodeURIComponent(normalizedEmail)}`, { role, active }, session);
      setMessage({ kind: "success", text: `Saved dashboard access for ${normalizedEmail}.` });
      setNewEmail("");
      setNewRole("mentor");
      setNewActive(true);
      reload();
    } catch (error) {
      setMessage({ kind: "error", text: friendlyDashboardError(error) });
    } finally {
      setSavingEmail(undefined);
    }
  }

  return (
    <>
      <section>
        <h2>Admin Users</h2>
        <p className="notice info">
          Active emails in this table can sign in with Google OAuth. Environment allowlist and domain settings still work as bootstrap access, and inactive rows stay blocked even if an env setting would otherwise allow them.
        </p>
        {message ? <p className={`notice ${message.kind}`}>{message.text}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        <form className="admin-user-form" onSubmit={(event) => {
          event.preventDefault();
          saveAdminUser(newEmail, newRole, newActive);
        }}>
          <label className="field-label wide-field">
            <span>Email</span>
            <input value={newEmail} onChange={(event) => setNewEmail(event.target.value)} type="email" placeholder="mentor@example.org" required />
          </label>
          <label className="field-label">
            <span>Role</span>
            <select value={newRole} onChange={(event) => setNewRole(event.target.value as AdminUserRow["role"])}>
              <option value="mentor">Mentor</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label className="inline-check admin-active-toggle">
            <input type="checkbox" checked={newActive} onChange={(event) => setNewActive(event.target.checked)} />
            Active
          </label>
          <button disabled={savingEmail === newEmail.trim().toLowerCase()}>{savingEmail === newEmail.trim().toLowerCase() ? "Saving..." : "Save admin user"}</button>
        </form>
      </section>
      <section>
        <h2>Dashboard Access</h2>
        {data?.adminUsers.length === 0 ? <p className="empty-state">No database-backed admin users yet. Bootstrap access can still come from Worker env settings.</p> : null}
        <div className="data-table-wrap">
          <table className="data-table admin-user-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Active</th>
                <th>Last Login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data?.adminUsers ?? []).map((adminUser) => {
                const draft = drafts[adminUser.email] ?? { role: adminUser.role, active: adminUser.active };
                return (
                  <tr key={adminUser.email}>
                    <td>{adminUser.email}</td>
                    <td>
                      <select value={draft.role} onChange={(event) => setDrafts((current) => ({
                        ...current,
                        [adminUser.email]: { ...draft, role: event.target.value as AdminUserRow["role"] }
                      }))}>
                        <option value="mentor">Mentor</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td>
                      <label className="inline-check compact-check">
                        <input type="checkbox" checked={draft.active} onChange={(event) => setDrafts((current) => ({
                          ...current,
                          [adminUser.email]: { ...draft, active: event.target.checked }
                        }))} />
                        {draft.active ? "Active" : "Inactive"}
                      </label>
                    </td>
                    <td>{adminUser.lastLoginAt ? formatDateTime(adminUser.lastLoginAt) : ""}</td>
                    <td>
                      <button type="button" disabled={savingEmail === adminUser.email} onClick={() => saveAdminUser(adminUser.email, draft.role, draft.active)}>
                        {savingEmail === adminUser.email ? "Saving..." : "Save"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function FingerprintEnrollmentTable({
  enrollments,
  currentMemberId,
  onDelete,
  onRemap,
  busy
}: {
  enrollments: FingerprintEnrollment[];
  currentMemberId: string;
  onDelete: (slot: number) => void;
  onRemap: (enrollment: FingerprintEnrollment, targetMemberId?: string) => void;
  busy: boolean;
}) {
  if (enrollments.length === 0) {
    return (
      <div className="enrollment-list">
        <h3>Current slot mappings</h3>
        <p className="empty-state">No local fingerprint mappings yet.</p>
      </div>
    );
  }
  return (
    <div className="enrollment-list">
      <h3>Current slot mappings</h3>
      <table className="compact-table">
        <thead>
          <tr>
            {["Slot", "Member", "Finger", "Updated", "Actions"].map((column) => <th key={column}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {enrollments.map((enrollment) => (
            <tr key={enrollment.slot}>
              <td>{enrollment.slot}</td>
              <td>
                {fingerprintEnrollmentName(enrollment)}
                {enrollment.memberId === currentMemberId ? <span className="status-badge active"> current member</span> : null}
                {!enrollment.active ? <span className="muted"> inactive</span> : null}
              </td>
              <td>{enrollment.fingerLabel ?? ""}</td>
              <td>{formatDateTime(enrollment.enrolledAt)}</td>
              <td>
                <div className="mapping-actions">
                  <button type="button" disabled={busy} onClick={() => onRemap(enrollment)}>
                    {enrollment.memberId === currentMemberId ? "Edit mapping" : "Open owner"}
                  </button>
                  {enrollment.memberId !== currentMemberId ? (
                    <button type="button" disabled={busy} onClick={() => onRemap(enrollment, currentMemberId)}>Use for this member</button>
                  ) : null}
                  <button type="button" disabled={busy} onClick={() => onDelete(enrollment.slot)}>Remove mapping</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Meetings({ session, onOpenMember }: { session: DashboardSession; onOpenMember: (memberId: string) => void }) {
  const { data, error, reload } = useApi<{ meetings: ScheduledMeeting[] }>("/admin/meetings", session);
  const [showUnscheduledAttendance, setShowUnscheduledAttendance] = useState(false);
  const meetingReportQuery = showUnscheduledAttendance ? "?includeUnscheduled=1" : "";
  const { data: meetingSummary, error: meetingSummaryError, loading: meetingSummaryLoading, reload: reloadMeetingSummary } = useApi<{ meetings: MeetingSummaryReportRow[] }>(`/admin/reports/meetings${meetingReportQuery}`, session);
  const [meetingViewTab, setMeetingViewTab] = useState<MeetingViewTab>("calendar");
  const [editingMeeting, setEditingMeeting] = useState<ScheduledMeeting>();
  const [formState, setFormState] = useState<MeetingFormState>(emptyMeetingForm());
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string }>();
  const [saving, setSaving] = useState(false);
  const [selectedMeetingDate, setSelectedMeetingDate] = useState("");
  const [selectedMeetingIds, setSelectedMeetingIds] = useState<string[]>([]);
  const [bulkEditState, setBulkEditState] = useState<BulkMeetingEditState>(emptyBulkMeetingEdit());
  const [bulkEditing, setBulkEditing] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState("");
  const [notificationResult, setNotificationResult] = useState<MeetingAbsenceNotificationResult>();
  const [notificationBusyDate, setNotificationBusyDate] = useState("");
  const [discordNotificationResult, setDiscordNotificationResult] = useState<DiscordMissingMemberNotificationResult>();
  const [discordNotificationBusyDate, setDiscordNotificationBusyDate] = useState("");
  const [discordEventSyncResult, setDiscordEventSyncResult] = useState<DiscordScheduledEventSyncResult>();
  const [discordEventSyncBusy, setDiscordEventSyncBusy] = useState(false);
  const meetings = data?.meetings ?? [];
  const selectedMeetings = meetings.filter((meeting) => selectedMeetingIds.includes(meeting.id));
  const allMeetingsSelected = meetings.length > 0 && selectedMeetingIds.length === meetings.length;
  const meetingSummaryRows = meetingSummary?.meetings ?? [];
  const meetingSummaryByDate = new Map(meetingSummaryRows.map((meeting) => [meeting.meetingDate, meeting]));
  const unscheduledSummaries = meetingSummaryRows.filter((meeting) => !meeting.scheduled);
  const hasVisibleMeetingRows = meetings.length > 0 || (showUnscheduledAttendance && unscheduledSummaries.length > 0);
  const selectedMeeting = meetings.find((meeting) => meeting.meetingDate === selectedMeetingDate);
  const selectedMeetingSummary = selectedMeetingDate ? meetingSummaryByDate.get(selectedMeetingDate) : undefined;
  const { data: selectedPresence, error: selectedPresenceError, reload: reloadSelectedPresence } = useOptionalApi<PresenceReport>(
    selectedMeetingDate ? `/admin/reports/presence?date=${selectedMeetingDate}` : undefined,
    session
  );
  const { data: selectedAbsences, error: selectedAbsencesError, reload: reloadSelectedAbsences } = useOptionalApi<MeetingAbsenceReport>(
    selectedMeetingDate ? `/admin/reports/meeting-absences?date=${selectedMeetingDate}` : undefined,
    session
  );
  const {
    data: selectedContestData,
    error: selectedContestsError,
    loading: selectedContestsLoading,
    reload: reloadSelectedContests
  } = useOptionalApi<{ contests: AttendanceContestRow[] }>(
    selectedMeeting ? `/admin/attendance-contests?meetingDate=${encodeURIComponent(selectedMeeting.meetingDate)}` : undefined,
    session
  );
  const presentRows = (selectedPresence?.rows ?? []).filter((row) => row.status === "signed_out");
  const openRows = (selectedPresence?.rows ?? []).filter((row) => row.status === "signed_in");
  const existingMeetingDates = new Set(meetings.map((meeting) => meeting.meetingDate));
  const recurringPreview = formState.repeats ? previewRecurringMeetings(formState, existingMeetingDates) : undefined;

  useEffect(() => {
    if (meetings.length === 0) return;
    const today = localDateInputValue();
    const todayMonth = today.slice(0, 7);
    const selectableDates = new Set([...meetings.map((meeting) => meeting.meetingDate), ...unscheduledSummaries.map((meeting) => meeting.meetingDate)]);
    const selectedMeetingExists = selectableDates.has(selectedMeetingDate);
    const defaultMeeting =
      meetings.find((meeting) => meeting.meetingDate === today)
      ?? unscheduledSummaries.find((meeting) => meeting.meetingDate === today)
      ?? meetings.find((meeting) => meeting.meetingDate.startsWith(todayMonth))
      ?? unscheduledSummaries.find((meeting) => meeting.meetingDate.startsWith(todayMonth))
      ?? meetings[0];
    if (!calendarMonth && defaultMeeting) setCalendarMonth(defaultMeeting.meetingDate.slice(0, 7));
    if ((!selectedMeetingDate || !selectedMeetingExists) && defaultMeeting) setSelectedMeetingDate(defaultMeeting.meetingDate);
  }, [calendarMonth, meetings, selectedMeetingDate, unscheduledSummaries]);

  useEffect(() => {
    setSelectedMeetingIds((ids) => ids.filter((id) => meetings.some((meeting) => meeting.id === id)));
  }, [meetings]);

  useEffect(() => {
    setNotificationResult(undefined);
    setDiscordNotificationResult(undefined);
    setDiscordEventSyncResult(undefined);
  }, [selectedMeetingDate]);

  async function submitMeeting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(undefined);
    try {
      if (editingMeeting) {
        const payload = meetingPayload(formState);
        await apiPut<ScheduledMeeting>(`/admin/meetings/${encodeURIComponent(editingMeeting.id)}`, payload, session);
        setMessage({ kind: "success", text: `Updated ${payload.title}.` });
        setSelectedMeetingDate(payload.meetingDate);
        setCalendarMonth(payload.meetingDate.slice(0, 7));
        setMeetingViewTab("calendar");
      } else if (formState.repeats) {
        const generatedDates = recurringMeetingDates(formState);
        const conflictDates = generatedDates.filter((date) => existingMeetingDates.has(date));
        const createDates = generatedDates.filter((date) => !existingMeetingDates.has(date));
        const createdDates: string[] = [];
        const failedDates: string[] = [];

        if (createDates.length === 0) {
          throw new Error(conflictDates.length > 0
            ? `No meetings created. ${pluralize(conflictDates.length, "date")} already scheduled: ${formatDateList(conflictDates)}.`
            : "No dates matched the selected recurrence.");
        }

        for (const meetingDate of createDates) {
          try {
            await apiPost<ScheduledMeeting>("/admin/meetings", recurringMeetingPayload(formState, meetingDate), session);
            createdDates.push(meetingDate);
          } catch {
            failedDates.push(meetingDate);
          }
        }

        if (failedDates.length > 0) {
          setMessage({
            kind: "error",
            text: `Created ${pluralize(createdDates.length, "meeting")}. ${pluralize(failedDates.length, "date")} failed: ${formatDateList(failedDates)}.${conflictDates.length > 0 ? ` Skipped existing ${formatDateList(conflictDates)}.` : ""}`
          });
        } else {
          setMessage({
            kind: "success",
            text: `Created ${pluralize(createdDates.length, "meeting")}${conflictDates.length > 0 ? ` and skipped existing ${formatDateList(conflictDates)}` : ""}.`
          });
          if (createdDates[0]) {
            setSelectedMeetingDate(createdDates[0]);
            setCalendarMonth(createdDates[0].slice(0, 7));
          }
          setFormState(emptyMeetingForm());
          setMeetingViewTab("calendar");
        }
      } else {
        const payload = meetingPayload(formState);
        await apiPost<ScheduledMeeting>("/admin/meetings", payload, session);
        setMessage({ kind: "success", text: `Added ${payload.title}.` });
        setSelectedMeetingDate(payload.meetingDate);
        setCalendarMonth(payload.meetingDate.slice(0, 7));
        setFormState(emptyMeetingForm());
        setMeetingViewTab("calendar");
      }
      setEditingMeeting(undefined);
      reload();
      reloadMeetingSummary();
    } catch (err) {
      setMessage({ kind: "error", text: friendlyDashboardError(err) });
    } finally {
      setSaving(false);
    }
  }

  async function deleteMeeting(meeting: ScheduledMeeting) {
    if (!window.confirm(`Delete ${meeting.title} on ${meeting.meetingDate}? Attendance sessions already recorded for that date will stay in the system.`)) return;
    setSaving(true);
    setMessage(undefined);
    try {
      await apiDelete(`/admin/meetings/${encodeURIComponent(meeting.id)}`, session);
      if (editingMeeting?.id === meeting.id) {
        setEditingMeeting(undefined);
        setFormState(emptyMeetingForm());
      }
      setMessage({ kind: "success", text: `Deleted ${meeting.title}.` });
      if (selectedMeetingDate === meeting.meetingDate) setSelectedMeetingDate("");
      reload();
      reloadMeetingSummary();
    } catch (err) {
      setMessage({ kind: "error", text: friendlyDashboardError(err) });
    } finally {
      setSaving(false);
    }
  }

  async function bulkDeleteMeetings() {
    if (selectedMeetings.length === 0) return;
    if (!window.confirm(`Delete ${selectedMeetings.length} selected meetings? Attendance sessions already recorded for those dates will stay in the system.`)) return;
    setSaving(true);
    setMessage(undefined);
    try {
      const result = await apiPost<{ deleted: number }>("/admin/meetings/bulk-delete", { meetingIds: selectedMeetingIds }, session);
      setMessage({ kind: "success", text: `Deleted ${pluralize(result.deleted, "meeting")}.` });
      if (selectedMeetings.some((meeting) => meeting.meetingDate === selectedMeetingDate)) setSelectedMeetingDate("");
      if (editingMeeting && selectedMeetingIds.includes(editingMeeting.id)) {
        setEditingMeeting(undefined);
        setFormState(emptyMeetingForm());
      }
      setSelectedMeetingIds([]);
      reload();
      reloadMeetingSummary();
    } catch (err) {
      setMessage({ kind: "error", text: friendlyDashboardError(err) });
    } finally {
      setSaving(false);
    }
  }

  async function bulkEditMeetings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedMeetings.length === 0) return;
    if (!bulkEditState.titleEnabled && !bulkEditState.requiredEnabled && !bulkEditState.timesEnabled && !bulkEditState.notesEnabled) {
      setMessage({ kind: "error", text: "Choose at least one field to update." });
      return;
    }
    if (bulkEditState.titleEnabled && !bulkEditState.title.trim()) {
      setMessage({ kind: "error", text: "Bulk title cannot be blank." });
      return;
    }
    if (bulkEditState.timesEnabled && bulkEditState.startTime && bulkEditState.endTime && bulkEditState.endTime <= bulkEditState.startTime) {
      setMessage({ kind: "error", text: "Meeting end time must be after the start time." });
      return;
    }
    setSaving(true);
    setMessage(undefined);
    try {
      const updatedDates: string[] = [];
      for (const meeting of selectedMeetings) {
        const nextTitle = bulkEditState.titleEnabled ? bulkEditState.title : meeting.title;
        const nextRequired = bulkEditState.requiredEnabled ? bulkEditState.required : meeting.required;
        const nextStartTime = bulkEditState.timesEnabled ? bulkEditState.startTime : localTimeInputValue(meeting.startsAt);
        const nextEndTime = bulkEditState.timesEnabled ? bulkEditState.endTime : localTimeInputValue(meeting.endsAt);
        const nextNotes = bulkEditState.notesEnabled ? bulkEditState.notes : meeting.notes ?? "";
        await apiPut<ScheduledMeeting>(`/admin/meetings/${encodeURIComponent(meeting.id)}`, {
          meetingDate: meeting.meetingDate,
          title: nextTitle.trim(),
          required: nextRequired,
          startsAt: nextStartTime ? localDateAndTimeToIso(meeting.meetingDate, nextStartTime) : undefined,
          endsAt: nextEndTime ? localDateAndTimeToIso(meeting.meetingDate, nextEndTime) : undefined,
          notes: nextNotes.trim() || undefined
        }, session);
        updatedDates.push(meeting.meetingDate);
      }
      setMessage({ kind: "success", text: `Updated ${pluralize(updatedDates.length, "meeting")}.` });
      setBulkEditing(false);
      setBulkEditState(emptyBulkMeetingEdit());
      reload();
      reloadMeetingSummary();
    } catch (err) {
      setMessage({ kind: "error", text: friendlyDashboardError(err) });
    } finally {
      setSaving(false);
    }
  }

  function toggleMeetingSelection(meetingId: string, selected: boolean) {
    setSelectedMeetingIds((ids) => selected ? [...new Set([...ids, meetingId])] : ids.filter((id) => id !== meetingId));
  }

  function toggleAllMeetingSelection(selected: boolean) {
    setSelectedMeetingIds(selected ? meetings.map((meeting) => meeting.id) : []);
  }

  function startEditing(meeting: ScheduledMeeting) {
    setEditingMeeting(meeting);
    setFormState(meetingToFormState(meeting));
    setSelectedMeetingDate(meeting.meetingDate);
    setCalendarMonth(meeting.meetingDate.slice(0, 7));
    setMeetingViewTab("form");
    setMessage(undefined);
  }

  function cancelEditing() {
    setEditingMeeting(undefined);
    setFormState(emptyMeetingForm());
    setMessage(undefined);
  }

  function startCreating() {
    setEditingMeeting(undefined);
    setFormState(emptyMeetingForm());
    setMessage(undefined);
    setMeetingViewTab("form");
  }

  function startConvertingUnscheduled(summary: MeetingSummaryReportRow) {
    setEditingMeeting(undefined);
    setFormState({
      ...emptyMeetingForm(),
      meetingDate: summary.meetingDate,
      title: summary.title ?? defaultMeetingTitle,
      required: true
    });
    setSelectedMeetingDate(summary.meetingDate);
    setCalendarMonth(summary.meetingDate.slice(0, 7));
    setMessage({ kind: "success", text: `Review details, then save ${summary.meetingDate} as a scheduled meeting.` });
    setMeetingViewTab("form");
  }

  async function clearUnscheduledAttendance(summary: MeetingSummaryReportRow) {
    const confirmation = window.prompt(`This permanently deletes scan events, manual events, and attendance exclusions for ${summary.meetingDate}. Scheduled meetings, roster, kiosks, and fingerprint mappings are preserved. Type CLEAR ${summary.meetingDate} to continue.`);
    if (confirmation === null) return;
    setSaving(true);
    setMessage(undefined);
    try {
      const result = await apiPost<{ deletedScanEvents: number; deletedManualEvents: number; deletedAttendanceExclusions: number }>("/admin/attendance/clear-date", {
        meetingDate: summary.meetingDate,
        confirmation
      }, session);
      setMessage({ kind: "success", text: `Cleared ${summary.meetingDate}: deleted ${pluralize(result.deletedScanEvents, "scan event")}, ${pluralize(result.deletedManualEvents, "manual event")}, and ${pluralize(result.deletedAttendanceExclusions, "attendance exclusion")}.` });
      if (selectedMeetingDate === summary.meetingDate) setSelectedMeetingDate("");
      reloadMeetingSummary();
      reloadSelectedPresence();
      reloadSelectedAbsences();
    } catch (err) {
      setMessage({ kind: "error", text: friendlyDashboardError(err) });
    } finally {
      setSaving(false);
    }
  }

  async function removePresentMember(row: Record<string, unknown>) {
    const memberId = String(row.memberId ?? row.member_id ?? "");
    const memberName = [row.firstName, row.lastName].filter(Boolean).join(" ") || `member ${memberId}`;
    const reasonInput = window.prompt(`Why should ${memberName} be marked absent for ${selectedMeetingDate}? This reason will be saved in the correction audit.`);
    if (reasonInput === null) return;
    const reason = reasonInput.trim();
    if (!reason) {
      setMessage({ kind: "error", text: "A correction reason is required to remove a member from a meeting." });
      return;
    }
    if (!window.confirm(`Mark ${memberName} absent for ${selectedMeetingDate}? Original scan and manual event records will be preserved.`)) return;

    setSaving(true);
    setMessage(undefined);
    try {
      await apiPost("/admin/attendance/remove-member", { memberId, meetingDate: selectedMeetingDate, reason }, session);
      setMessage({ kind: "success", text: `Marked ${memberName} absent for ${selectedMeetingDate}. Original attendance events were preserved in the audit trail.` });
      setNotificationResult(undefined);
      setDiscordNotificationResult(undefined);
      reloadMeetingSummary();
      reloadSelectedPresence();
      reloadSelectedAbsences();
    } catch (err) {
      setMessage({ kind: "error", text: friendlyDashboardError(err) });
    } finally {
      setSaving(false);
    }
  }

  async function clearPresentMemberAttendanceData(row: Record<string, unknown>) {
    const memberId = String(row.memberId ?? row.member_id ?? "");
    const memberName = [row.firstName, row.lastName].filter(Boolean).join(" ") || `member ${memberId}`;
    const expectedConfirmation = clearMemberAttendanceConfirmation(memberId, selectedMeetingDate);
    const reasonInput = window.prompt(`Debugging note for permanently clearing ${memberName}'s attendance source data on ${selectedMeetingDate}. This will be saved with the request and should explain why the scan/manual data is being removed.`);
    if (reasonInput === null) return;
    const confirmationInput = window.prompt(`This permanently deletes only ${memberName}'s scan and manual attendance source rows for ${selectedMeetingDate}, then rebuilds attendance. It does not delete the member, meeting, fingerprint mappings, other members' data, notification audits, contest records, or Mark absent exclusions. Type ${expectedConfirmation} to continue.`);
    let payload: ReturnType<typeof buildClearMemberAttendanceSourceDataPayload>;
    try {
      payload = buildClearMemberAttendanceSourceDataPayload({ memberId, meetingDate: selectedMeetingDate, reasonInput, confirmationInput });
    } catch (err) {
      setMessage({ kind: "error", text: friendlyDashboardError(err) });
      return;
    }
    if (!payload) return;

    setSaving(true);
    setMessage(undefined);
    try {
      const result = await apiPost<{ deletedScanEvents: number; deletedManualEvents: number }>("/admin/attendance/clear-member-source-data", payload, session);
      setMessage({ kind: "success", text: `Cleared ${memberName}'s ${selectedMeetingDate} source data: deleted ${pluralize(result.deletedScanEvents, "scan event")} and ${pluralize(result.deletedManualEvents, "manual event")}. Attendance was rebuilt without creating a Mark absent exclusion.` });
      setNotificationResult(undefined);
      setDiscordNotificationResult(undefined);
      reloadMeetingSummary();
      reloadSelectedPresence();
      reloadSelectedAbsences();
      reloadSelectedContests();
    } catch (err) {
      setMessage({ kind: "error", text: friendlyDashboardError(err) });
    } finally {
      setSaving(false);
    }
  }

  async function emailAbsentMembers(meetingDate: string) {
    setNotificationBusyDate(meetingDate);
    setMessage(undefined);
    try {
      const preview = await apiPost<MeetingAbsenceNotificationResult>("/admin/notifications/meeting-absence", {
        meetingDate,
        preview: true
      }, session);
      setNotificationResult(preview);
      const sendableCount = preview.recipients.filter((recipient) => recipient.status === "would_send").length;
      if (!preview.providerConfigured) {
        setMessage({ kind: "success", text: `Preview ready for ${pluralize(sendableCount, "member")}; email sending is not configured.` });
        return;
      }
      if (sendableCount === 0) {
        setMessage({ kind: "success", text: "No unsent absent members with email addresses for this meeting." });
        return;
      }
      if (!window.confirm(`Send missed-meeting email to ${pluralize(sendableCount, "absent member")}?`)) return;
      const result = await apiPost<MeetingAbsenceNotificationResult>("/admin/notifications/meeting-absence", {
        meetingDate
      }, session);
      setNotificationResult(result);
      setMessage({
        kind: result.errorCount > 0 ? "error" : "success",
        text: `Sent ${pluralize(result.sentCount, "email")}${result.skippedDuplicateCount > 0 ? `; skipped ${pluralize(result.skippedDuplicateCount, "duplicate")}` : ""}.`
      });
    } catch (err) {
      setMessage({ kind: "error", text: friendlyDashboardError(err) });
    } finally {
      setNotificationBusyDate("");
    }
  }

  async function pingMissingMembersInDiscord(meetingDate: string) {
    setDiscordNotificationBusyDate(meetingDate);
    setMessage(undefined);
    try {
      const preview = await apiPost<DiscordMissingMemberNotificationResult>("/admin/notifications/discord/bot/missing-members", {
        meetingDate,
        preview: true
      }, session);
      setDiscordNotificationResult(preview);
      const sendableCount = preview.recipients.filter((recipient) => recipient.status === "would_send").length;
      if (!preview.providerConfigured) {
        setMessage({ kind: "success", text: `Preview ready for ${pluralize(sendableCount, "member")}; Discord bot delivery is not configured.` });
        return;
      }
      if (sendableCount === 0) {
        setMessage({ kind: "success", text: "No unsent absent members with Discord user IDs for this meeting." });
        return;
      }
      if (!window.confirm(`Ping ${pluralize(sendableCount, "missing member")} in Discord?`)) return;
      const result = await apiPost<DiscordMissingMemberNotificationResult>("/admin/notifications/discord/bot/missing-members", {
        meetingDate
      }, session);
      setDiscordNotificationResult(result);
      setMessage({
        kind: result.errorCount > 0 ? "error" : "success",
        text: discordNotificationSummary(result)
      });
    } catch (err) {
      setMessage({ kind: "error", text: friendlyDashboardError(err) });
    } finally {
      setDiscordNotificationBusyDate("");
    }
  }

  async function syncMeetingsToDiscord(meetingIds: string[]) {
    if (meetingIds.length === 0) return;
    const uniqueMeetingIds = [...new Set(meetingIds)];
    const label = uniqueMeetingIds.length === 1 ? "this meeting" : `${uniqueMeetingIds.length} selected meetings`;
    if (!window.confirm(`Push ${label} to the Discord server calendar? Existing mapped Discord events will be updated.`)) return;
    setDiscordEventSyncBusy(true);
    setMessage(undefined);
    try {
      const result = await apiPost<DiscordScheduledEventSyncResult>("/admin/meetings/discord/sync", {
        meetingIds: uniqueMeetingIds
      }, session);
      setDiscordEventSyncResult(result);
      setMessage({
        kind: result.errorCount > 0 ? "error" : "success",
        text: discordScheduledEventSyncSummary(result)
      });
      reload();
    } catch (err) {
      setMessage({ kind: "error", text: friendlyDashboardError(err) });
    } finally {
      setDiscordEventSyncBusy(false);
    }
  }

  const meetingForm = (
    <form className="meeting-form" onSubmit={submitMeeting}>
      <label className="field-label">
        <span>Date</span>
        <input value={formState.meetingDate} onChange={(event) => setFormState({ ...formState, meetingDate: event.target.value })} type="date" required />
      </label>
      <label className="field-label wide-field">
        <span>Title</span>
        <input value={formState.title} onChange={(event) => setFormState({ ...formState, title: event.target.value })} placeholder={defaultMeetingTitle} required />
      </label>
      <label className="inline-check required-toggle">
        <input type="checkbox" checked={formState.required} onChange={(event) => setFormState({ ...formState, required: event.target.checked })} />
        Required attendance
      </label>
      <div className="meeting-time-fields">
        <label className="field-label">
          <span>Start time</span>
          <input value={formState.startTime} onChange={(event) => setFormState({ ...formState, startTime: event.target.value })} type="time" required />
        </label>
        <label className="field-label">
          <span>End time</span>
          <input value={formState.endTime} onChange={(event) => setFormState({ ...formState, endTime: event.target.value })} type="time" required />
        </label>
      </div>
      {editingMeeting ? (
        <label className="field-label notes-field">
          <span>Notes</span>
          <textarea value={formState.notes} onChange={(event) => setFormState({ ...formState, notes: event.target.value })} rows={3} placeholder="Optional context" />
        </label>
      ) : null}
      {!editingMeeting ? (
        <label className="inline-check repeat-toggle">
          <input type="checkbox" checked={formState.repeats} onChange={(event) => setFormState({ ...formState, repeats: event.target.checked })} />
          Repeats
        </label>
      ) : null}
      {formState.repeats && !editingMeeting ? (
        <div className="recurrence-options">
          <label className="field-label">
            <span>First date</span>
            <input value={formState.startDate} onChange={(event) => setFormState({ ...formState, startDate: event.target.value })} type="date" required />
          </label>
          <label className="field-label">
            <span>Last date</span>
            <input value={formState.endDate} onChange={(event) => setFormState({ ...formState, endDate: event.target.value })} type="date" required />
          </label>
          <fieldset className="weekday-picker">
            <legend>Repeats on</legend>
            {weekdayOptions.map((weekday) => (
              <label key={weekday.value}>
                <input
                  type="checkbox"
                  checked={formState.weekdays.includes(weekday.value)}
                  onChange={() => setFormState({ ...formState, weekdays: toggleWeekday(formState.weekdays, weekday.value) })}
                />
                {weekday.label}
              </label>
            ))}
          </fieldset>
          {recurringPreview ? <p className={`recurrence-preview ${recurringPreview.kind}`}>{recurringPreview.text}</p> : null}
        </div>
      ) : null}
      <div className="toolbar compact form-actions">
        <button disabled={saving || (formState.repeats && recurringPreview?.createCount === 0)}>{saving ? "Saving..." : editingMeeting ? "Save changes" : formState.repeats ? "Create repeating meetings" : "Add meeting"}</button>
        {editingMeeting ? <button type="button" onClick={cancelEditing} disabled={saving}>Cancel</button> : null}
      </div>
    </form>
  );

  return (
    <>
      <section>
        <div className="section-heading">
          <h2>Meetings</h2>
          <button type="button" onClick={() => {
            reload();
            reloadMeetingSummary();
            reloadSelectedPresence();
            reloadSelectedAbsences();
          }}>Refresh</button>
        </div>
        <div className="meeting-tabs" role="tablist" aria-label="Meeting views">
          <button type="button" role="tab" aria-selected={meetingViewTab === "calendar"} className={meetingViewTab === "calendar" ? "active" : ""} onClick={() => setMeetingViewTab("calendar")}>Calendar</button>
          <button type="button" role="tab" aria-selected={meetingViewTab === "all"} className={meetingViewTab === "all" ? "active" : ""} onClick={() => setMeetingViewTab("all")}>All Meetings</button>
          <button type="button" role="tab" aria-selected={meetingViewTab === "form"} aria-disabled={meetingViewTab === "form"} className={meetingViewTab === "form" ? "active" : ""} onClick={meetingViewTab === "form" ? undefined : startCreating}>{editingMeeting ? "Edit Meeting" : "Add Meeting"}</button>
        </div>
        <label className="inline-check notice info">
          <input type="checkbox" checked={showUnscheduledAttendance} onChange={(event) => setShowUnscheduledAttendance(event.target.checked)} />
          Show unscheduled attendance
        </label>
        {message ? <p className={`notice ${message.kind}`}>{message.text}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        {meetingSummaryError ? <p className="error">{meetingSummaryError}</p> : null}
        {discordEventSyncResult ? <DiscordScheduledEventSyncResultPanel result={discordEventSyncResult} /> : null}

        {meetingViewTab === "calendar" ? (
          <>
            {hasVisibleMeetingRows ? (
              <MeetingCalendar
                month={calendarMonth || meetings[0]?.meetingDate.slice(0, 7) || unscheduledSummaries[0]?.meetingDate.slice(0, 7) || localDateInputValue().slice(0, 7)}
                meetings={meetings}
                unscheduledSummaries={showUnscheduledAttendance ? unscheduledSummaries : []}
                summariesByDate={meetingSummaryByDate}
                summariesLoading={meetingSummaryLoading}
                summariesUnavailable={Boolean(meetingSummaryError && !meetingSummary)}
                selectedMeetingDate={selectedMeetingDate}
                onMonthChange={setCalendarMonth}
                onSelectMeeting={setSelectedMeetingDate}
              />
            ) : <p className="empty-state">No scheduled meetings yet.</p>}
              <MeetingDetails
                session={session}
                meeting={selectedMeeting}
                summary={selectedMeetingSummary}
              presence={selectedPresence}
              absences={selectedAbsences}
              presentRows={presentRows}
              openRows={openRows}
              presenceError={selectedPresenceError}
              absencesError={selectedAbsencesError}
                saving={saving}
                notificationResult={notificationResult?.meetingDate === selectedMeetingDate ? notificationResult : undefined}
                notificationBusy={notificationBusyDate === selectedMeetingDate}
                discordNotificationResult={discordNotificationResult?.meetingDate === selectedMeetingDate ? discordNotificationResult : undefined}
                discordNotificationBusy={discordNotificationBusyDate === selectedMeetingDate}
                discordEventSyncBusy={discordEventSyncBusy}
                contests={selectedContestData?.contests ?? []}
                contestsError={selectedContestsError}
                contestsLoading={selectedContestsLoading}
                onEdit={startEditing}
                onDelete={deleteMeeting}
                onConvert={startConvertingUnscheduled}
                onClear={clearUnscheduledAttendance}
                onEmailAbsent={emailAbsentMembers}
                onDiscordPingAbsent={pingMissingMembersInDiscord}
                onDiscordEventSync={(meeting) => syncMeetingsToDiscord([meeting.id])}
                onOpenMember={onOpenMember}
                onRemoveMember={removePresentMember}
                onClearMemberAttendanceData={clearPresentMemberAttendanceData}
                onContestChanged={() => {
                  reloadSelectedContests();
                  reloadMeetingSummary();
                  reloadSelectedPresence();
                  reloadSelectedAbsences();
                }}
              />
          </>
        ) : null}

        {meetingViewTab === "all" ? (
          hasVisibleMeetingRows ? (
            <>
              <div className="bulk-actions">
                <span>{pluralize(selectedMeetingIds.length, "meeting")} selected</span>
                <button type="button" disabled={saving || selectedMeetingIds.length === 0} onClick={() => setBulkEditing((value) => !value)}>
                  {bulkEditing ? "Hide bulk edit" : "Bulk edit"}
                </button>
                <button type="button" disabled={saving || selectedMeetingIds.length === 0} onClick={bulkDeleteMeetings}>Bulk delete</button>
                <button type="button" disabled={saving || discordEventSyncBusy || selectedMeetingIds.length === 0} onClick={() => syncMeetingsToDiscord(selectedMeetingIds)}>
                  {discordEventSyncBusy ? "Syncing..." : "Sync Discord events"}
                </button>
                <button type="button" disabled={saving || selectedMeetingIds.length === 0} onClick={() => setSelectedMeetingIds([])}>Clear selection</button>
              </div>
              {bulkEditing ? (
                <form className="bulk-edit-form" onSubmit={bulkEditMeetings}>
                  <div className="bulk-edit-row">
                    <label className="inline-check bulk-edit-toggle">
                      <input type="checkbox" checked={bulkEditState.titleEnabled} onChange={(event) => setBulkEditState({ ...bulkEditState, titleEnabled: event.target.checked })} />
                      Title
                    </label>
                    <input value={bulkEditState.title} onChange={(event) => setBulkEditState({ ...bulkEditState, title: event.target.value })} disabled={!bulkEditState.titleEnabled} placeholder={defaultMeetingTitle} />
                  </div>
                  <div className="bulk-edit-row">
                    <label className="inline-check bulk-edit-toggle">
                      <input type="checkbox" checked={bulkEditState.requiredEnabled} onChange={(event) => setBulkEditState({ ...bulkEditState, requiredEnabled: event.target.checked })} />
                      Required
                    </label>
                    <select value={bulkEditState.required ? "required" : "optional"} onChange={(event) => setBulkEditState({ ...bulkEditState, required: event.target.value === "required" })} disabled={!bulkEditState.requiredEnabled}>
                      <option value="required">Required attendance</option>
                      <option value="optional">Optional attendance</option>
                    </select>
                  </div>
                  <div className="bulk-edit-row">
                    <label className="inline-check bulk-edit-toggle">
                      <input type="checkbox" checked={bulkEditState.timesEnabled} onChange={(event) => setBulkEditState({ ...bulkEditState, timesEnabled: event.target.checked })} />
                      Times
                    </label>
                    <div className="bulk-edit-time-fields">
                      <input value={bulkEditState.startTime} onChange={(event) => setBulkEditState({ ...bulkEditState, startTime: event.target.value })} disabled={!bulkEditState.timesEnabled} type="time" aria-label="Bulk start time" />
                      <input value={bulkEditState.endTime} onChange={(event) => setBulkEditState({ ...bulkEditState, endTime: event.target.value })} disabled={!bulkEditState.timesEnabled} type="time" aria-label="Bulk end time" />
                    </div>
                  </div>
                  <div className="bulk-edit-row">
                    <label className="inline-check bulk-edit-toggle">
                      <input type="checkbox" checked={bulkEditState.notesEnabled} onChange={(event) => setBulkEditState({ ...bulkEditState, notesEnabled: event.target.checked })} />
                      Notes
                    </label>
                    <input value={bulkEditState.notes} onChange={(event) => setBulkEditState({ ...bulkEditState, notes: event.target.value })} disabled={!bulkEditState.notesEnabled} placeholder="Optional context" />
                  </div>
                  <button disabled={saving || selectedMeetingIds.length === 0}>{saving ? "Saving..." : `Apply to ${selectedMeetingIds.length}`}</button>
                </form>
              ) : null}
              <div className="meeting-table-wrap">
                <table className="meeting-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Select all meetings"
                          checked={allMeetingsSelected}
                          onChange={(event) => toggleAllMeetingSelection(event.target.checked)}
                        />
                      </th>
                      {["date", "title", "attendance", "present", "absent", "time", "Discord", "notes", "actions"].map((column) => <th key={column}>{column}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ...meetings.map((meeting) => ({ kind: "scheduled" as const, meeting })),
                      ...(showUnscheduledAttendance ? unscheduledSummaries.map((summary) => ({ kind: "unscheduled" as const, summary })) : [])
                    ].sort((left, right) => {
                      const leftDate = left.kind === "scheduled" ? left.meeting.meetingDate : left.summary.meetingDate;
                      const rightDate = right.kind === "scheduled" ? right.meeting.meetingDate : right.summary.meetingDate;
                      return rightDate.localeCompare(leftDate);
                    }).map((row) => {
                      if (row.kind === "unscheduled") {
                        const summary = row.summary;
                        return (
                          <tr key={`unscheduled-${summary.meetingDate}`} className={selectedMeetingDate === summary.meetingDate ? "selected-row" : undefined}>
                            <td></td>
                            <td><button className="link-button" type="button" onClick={() => setSelectedMeetingDate(summary.meetingDate)}>{summary.meetingDate}</button></td>
                            <td>Unscheduled attendance</td>
                            <td>attendance-only</td>
                            <td>{summary.presentCount}</td>
                            <td>N/A</td>
                            <td></td>
                            <td></td>
                            <td></td>
                            <td>
                              <div className="kiosk-actions">
                                <button type="button" disabled={saving} onClick={() => startConvertingUnscheduled(summary)}>Convert</button>
                                <button type="button" className="danger-button" disabled={saving} onClick={() => clearUnscheduledAttendance(summary)}>Clear</button>
                              </div>
                            </td>
                          </tr>
                        );
                      }
                      const meeting = row.meeting;
                      const summary = meetingSummaryByDate.get(meeting.meetingDate);
                      const selectedForBulk = selectedMeetingIds.includes(meeting.id);
                      return (
                      <tr
                        key={meeting.id}
                        className={selectedMeetingDate === meeting.meetingDate ? "selected-row" : undefined}
                        tabIndex={0}
                        onClick={() => setSelectedMeetingDate(meeting.meetingDate)}
                        onKeyDown={(event) => {
                          if (event.target instanceof HTMLElement && event.target.closest("button,input,select,textarea")) return;
                          if (event.key === "Enter" || event.key === " ") setSelectedMeetingDate(meeting.meetingDate);
                        }}
                      >
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select ${meeting.title} on ${meeting.meetingDate}`}
                            checked={selectedForBulk}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => toggleMeetingSelection(meeting.id, event.target.checked)}
                          />
                        </td>
                        <td><button className="link-button" type="button" onClick={() => setSelectedMeetingDate(meeting.meetingDate)}>{meeting.meetingDate}</button></td>
                        <td>{meeting.title}</td>
                        <td><MeetingRequirementBadge required={meeting.required} /></td>
                        <td>{summary ? summary.presentCount : "..."}</td>
                        <td>{meeting.required ? summary?.absentCount ?? "..." : "N/A"}</td>
                        <td>{meetingTimeRange(meeting)}</td>
                        <td><DiscordScheduledEventBadge meeting={meeting} /></td>
                        <td>{meeting.notes ?? ""}</td>
                        <td>
                          <div className="kiosk-actions">
                            <button type="button" onClick={(event) => {
                              event.stopPropagation();
                              startEditing(meeting);
                            }} disabled={saving}>Edit</button>
                            <button type="button" onClick={(event) => {
                              event.stopPropagation();
                              deleteMeeting(meeting);
                            }} disabled={saving}>Delete</button>
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : <p className="empty-state">No scheduled meetings yet.</p>
        ) : null}

        {meetingViewTab === "form" ? (
          <>
            <h3>{editingMeeting ? "Edit Meeting" : "Add Meeting"}</h3>
            {meetingForm}
          </>
        ) : null}
      </section>
    </>
  );
}

function MeetingCalendar({
  month,
  meetings,
  unscheduledSummaries,
  summariesByDate,
  summariesLoading,
  summariesUnavailable,
  selectedMeetingDate,
  onMonthChange,
  onSelectMeeting
}: {
  month: string;
  meetings: ScheduledMeeting[];
  unscheduledSummaries: MeetingSummaryReportRow[];
  summariesByDate: Map<string, MeetingSummaryReportRow>;
  summariesLoading: boolean;
  summariesUnavailable: boolean;
  selectedMeetingDate: string;
  onMonthChange: (month: string) => void;
  onSelectMeeting: (meetingDate: string) => void;
}) {
  const days = calendarDaysForMonth(month);
  const meetingsByDate = groupMeetingsByDate(meetings);
  const unscheduledByDate = new Map(unscheduledSummaries.map((summary) => [summary.meetingDate, summary]));

  return (
    <div className="meeting-calendar">
      <div className="calendar-toolbar">
        <h3>{formatMonthLabel(month)}</h3>
        <div className="kiosk-actions">
          <button type="button" onClick={() => onMonthChange(addMonthsToMonth(month, -1))}>Previous</button>
          <button type="button" onClick={() => onMonthChange(localDateInputValue().slice(0, 7))}>Current Month</button>
          <button type="button" onClick={() => onMonthChange(addMonthsToMonth(month, 1))}>Next</button>
        </div>
      </div>
      <div className="calendar-grid">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((weekday) => <div className="calendar-weekday" key={weekday}>{weekday}</div>)}
        {days.map((day) => {
          const dayMeetings = meetingsByDate.get(day.date) ?? [];
          const unscheduled = unscheduledByDate.get(day.date);
          return (
            <div className={`calendar-day ${day.inMonth ? "" : "outside-month"} ${day.date === localDateInputValue() ? "today" : ""}`} key={day.date}>
              <span className="calendar-date">{day.dayOfMonth}</span>
              <div className="calendar-events">
                {dayMeetings.map((meeting) => {
                  const summary = summariesByDate.get(meeting.meetingDate);
                  return (
                    <button
                      className={`calendar-event ${selectedMeetingDate === meeting.meetingDate ? "selected" : ""}`}
                      key={meeting.id}
                      type="button"
                      onClick={() => onSelectMeeting(meeting.meetingDate)}
                    >
                      <span>{meeting.title}</span>
                      <small>{calendarMeetingSummaryLabel(meeting, summary, { loading: summariesLoading, unavailable: summariesUnavailable })}</small>
                    </button>
                  );
                })}
                {unscheduled ? (
                  <button
                    className={`calendar-event attendance-only ${selectedMeetingDate === unscheduled.meetingDate ? "selected" : ""}`}
                    type="button"
                    onClick={() => onSelectMeeting(unscheduled.meetingDate)}
                  >
                    <span>Unscheduled attendance</span>
                    <small>{unscheduled.presentCount} present</small>
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MeetingDetails({
  session,
  meeting,
  summary,
  presence,
  absences,
  presentRows,
  openRows,
  presenceError,
  absencesError,
  saving,
  onEdit,
  onDelete,
  onConvert,
  onClear,
  notificationResult,
  notificationBusy,
  discordNotificationResult,
  discordNotificationBusy,
  discordEventSyncBusy,
  contests,
  contestsError,
  contestsLoading,
  onEmailAbsent,
  onDiscordPingAbsent,
  onDiscordEventSync,
  onOpenMember,
  onRemoveMember,
  onClearMemberAttendanceData,
  onContestChanged
}: {
  session: DashboardSession;
  meeting?: ScheduledMeeting;
  summary?: MeetingSummaryReportRow;
  presence?: PresenceReport;
  absences?: MeetingAbsenceReport;
  presentRows: Array<Record<string, unknown>>;
  openRows: Array<Record<string, unknown>>;
  presenceError?: string;
  absencesError?: string;
  saving: boolean;
  notificationResult?: MeetingAbsenceNotificationResult;
  notificationBusy: boolean;
  discordNotificationResult?: DiscordMissingMemberNotificationResult;
  discordNotificationBusy: boolean;
  discordEventSyncBusy: boolean;
  contests: AttendanceContestRow[];
  contestsError?: string;
  contestsLoading: boolean;
  onEdit: (meeting: ScheduledMeeting) => void;
  onDelete: (meeting: ScheduledMeeting) => void;
  onConvert: (summary: MeetingSummaryReportRow) => void;
  onClear: (summary: MeetingSummaryReportRow) => void;
  onEmailAbsent: (meetingDate: string) => void;
  onDiscordPingAbsent: (meetingDate: string) => void;
  onDiscordEventSync: (meeting: ScheduledMeeting) => void;
  onOpenMember: (memberId: string) => void;
  onRemoveMember: (row: Record<string, unknown>) => void;
  onClearMemberAttendanceData: (row: Record<string, unknown>) => void;
  onContestChanged: () => void;
}) {
  if (!meeting && !summary) {
    return <p className="empty-state">Select a meeting on the calendar to see attendance details.</p>;
  }
  const attendanceOnly = !meeting && summary && !summary.scheduled;
  const detailDate = meeting?.meetingDate ?? summary?.meetingDate ?? "";
  const detailTitle = meeting?.title ?? summary?.title ?? "Unscheduled attendance";
  const required = meeting?.required ?? summary?.required ?? false;
  const meetingPresentRows = presentRows.map((row) => ({
    ...row,
    checkInAt: typeof row.checkInAt === "string" ? formatTime(row.checkInAt) : row.checkInAt,
    checkOutAt: typeof row.checkOutAt === "string" ? formatTime(row.checkOutAt) : row.checkOutAt
  }));
  const meetingOpenRows = openRows.map((row) => ({
    ...row,
    checkInAt: typeof row.checkInAt === "string" ? formatTime(row.checkInAt) : row.checkInAt
  }));
  const absentRows = absences?.rows ?? [];
  const notRequiredRows = absences?.notRequiredRows ?? [];
  const presentStateText = presence
    ? meetingPresentRows.length === 0
      ? "No members have earned attendance credit for this meeting yet."
      : `${pluralize(meetingPresentRows.length, "member")} earned attendance credit for this meeting.`
    : "Loading present members...";
  const absentStateText = attendanceOnly
    ? "Convert this attendance-only date into a scheduled meeting to track required or optional attendance."
    : required
    ? absences
      ? absentRows.length === 0
        ? notRequiredRows.length > 0
          ? `No active members are absent; ${pluralize(notRequiredRows.length, "member")} not required because their attendance start date is later.`
          : "No active members are absent for this required meeting."
        : `${pluralize(absentRows.length, "active member")} absent from this required meeting.`
      : "Loading absent members..."
    : "Optional meetings do not create missed-attendance records.";

  return (
    <div className="meeting-details">
      <div className="section-heading">
        <div>
          <h3>{detailTitle}</h3>
          <p className="report-context">{detailDate}{meeting && meetingTimeRange(meeting) ? `, ${meetingTimeRange(meeting)}` : ""}</p>
        </div>
        <div className="meeting-detail-actions">
          {attendanceOnly && summary ? (
            <>
              <span className="status-badge pending">attendance-only</span>
              <button type="button" onClick={() => onConvert(summary)} disabled={saving}>Convert</button>
              <button type="button" className="danger-button" onClick={() => onClear(summary)} disabled={saving}>Clear</button>
            </>
          ) : meeting ? (
            <>
              <MeetingRequirementBadge required={meeting.required} />
              {required ? <button type="button" onClick={() => onEmailAbsent(meeting.meetingDate)} disabled={saving || notificationBusy}>{notificationBusy ? "Checking..." : "Email absent members"}</button> : null}
              {required ? <button type="button" onClick={() => onDiscordPingAbsent(meeting.meetingDate)} disabled={saving || discordNotificationBusy}>{discordNotificationBusy ? "Checking..." : "Ping missing members with contest button"}</button> : null}
              <button type="button" onClick={() => onDiscordEventSync(meeting)} disabled={saving || discordEventSyncBusy}>{discordEventSyncBusy ? "Syncing..." : "Sync Discord event"}</button>
              <button type="button" onClick={() => onEdit(meeting)} disabled={saving}>Edit</button>
              <button type="button" onClick={() => onDelete(meeting)} disabled={saving}>Delete</button>
            </>
          ) : null}
        </div>
      </div>
      <p className="report-context">
        {attendanceOnly
          ? "Attendance exists for this date, but no scheduled meeting label has been created yet."
          : required
          ? "A completed check-in/check-out pair earns attendance credit. Open check-ins remain signed in until checkout; after the meeting ends they are absent until resolved."
          : "Optional meetings show who attended, but do not create missed-meeting counts."}
      </p>
      <div className="grid compact-grid">
        <Metric label="Present" value={summary?.presentCount ?? (presence ? presentRows.length : "...")} />
        <Metric label="Signed In" value={presence?.counts.signedIn ?? 0} />
        <Metric label="Open Check-Ins" value={summary?.openCheckIns ?? 0} />
        <Metric label="Absent" value={!attendanceOnly && required ? summary?.absentCount ?? absences?.absentCount ?? "..." : "N/A"} />
        {!attendanceOnly && required && (absences?.excusedCount ?? 0) > 0 ? <Metric label="Excused (still absent)" value={absences?.excusedCount ?? 0} /> : null}
      </div>
      {presenceError ? <p className="error">{presenceError}</p> : null}
      {absencesError ? <p className="error">{absencesError}</p> : null}
      {notificationResult ? <NotificationResultPanel result={notificationResult} onOpenMember={onOpenMember} /> : null}
      {discordNotificationResult ? <DiscordNotificationResultPanel result={discordNotificationResult} onOpenMember={onOpenMember} /> : null}
      {meeting ? (
        <div className="meeting-contests">
          <div className="meeting-detail-subheading">
            <h3>Attendance Contests</h3>
            <span>{contestsLoading ? "..." : contests.length}</span>
          </div>
          <p className="report-context">Discord contests for this meeting stay visible here after review.</p>
          {contestsError ? <p className="error">{contestsError}</p> : null}
          <AttendanceContestCards
            contests={contests}
            session={session}
            onOpenMember={onOpenMember}
            onChanged={onContestChanged}
            emptyMessage={contestsLoading ? "Loading attendance contests..." : "No Discord attendance contests for this meeting."}
          />
        </div>
      ) : null}
      <div className="meeting-detail-grid">
        <div>
          <div className="meeting-detail-subheading">
            <h3>Present Members</h3>
            <span>{presence ? meetingPresentRows.length : "..."}</span>
          </div>
          <p className="empty-state">{presentStateText}</p>
          <DataTable
            rows={meetingPresentRows}
            columns={["memberId", "firstName", "lastName", "checkInAt", "checkOutAt", "actions"]}
            density="compact"
            onOpenMember={onOpenMember}
            onRemoveFromMeeting={onRemoveMember}
            onClearMemberAttendanceData={onClearMemberAttendanceData}
            actionsDisabled={saving}
          />
          {meetingOpenRows.length > 0 ? (
            <>
              <div className="meeting-detail-subheading">
                <h3>Currently Signed In</h3>
                <span>{meetingOpenRows.length}</span>
              </div>
              <p className="empty-state">These members have checked in but have not checked out, so they do not have attendance credit yet.</p>
              <DataTable rows={meetingOpenRows} columns={["memberId", "firstName", "lastName", "checkInAt"]} density="compact" onOpenMember={onOpenMember} />
            </>
          ) : null}
        </div>
        <div>
          <div className="meeting-detail-subheading">
            <h3>{!attendanceOnly && required ? "Absent Members" : "Optional Attendance"}</h3>
            <span>{!attendanceOnly && required ? absences?.absentCount ?? "..." : "N/A"}</span>
          </div>
          <p className="empty-state">{absentStateText}</p>
          {!attendanceOnly && required ? (
            <DataTable rows={absentRows} columns={["memberId", "firstName", "lastName", "excused", "excuseReason"]} density="compact" onOpenMember={onOpenMember} />
          ) : (
            <p className="notice info">Track attendance here as present-only participation; use required meetings for absence accountability.</p>
          )}
          {!attendanceOnly && required && notRequiredRows.length > 0 ? (
            <>
              <div className="meeting-detail-subheading">
                <h3>Not Required</h3>
                <span>{notRequiredRows.length}</span>
              </div>
              <p className="empty-state">These members were added after this meeting date, so this meeting is excused for them.</p>
              <DataTable rows={notRequiredRows} columns={["memberId", "firstName", "lastName", "attendanceRequiredFromDate"]} density="compact" onOpenMember={onOpenMember} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function NotificationResultPanel({ result, onOpenMember }: { result: MeetingAbsenceNotificationResult; onOpenMember?: (memberId: string) => void }) {
  const recipientRows = result.recipients.map((recipient) => ({
    memberId: recipient.memberId,
    firstName: recipient.firstName,
    lastName: recipient.lastName,
    email: recipient.email,
    status: notificationStatusLabel(recipient.status),
    error: recipient.error ?? ""
  }));
  const missingRows = result.missingEmail.map((recipient) => ({
    memberId: recipient.memberId,
    firstName: recipient.firstName,
    lastName: recipient.lastName,
    status: "Missing email"
  }));
  const noticeKind = result.errorCount > 0 ? "error" : result.mode === "send" ? "success" : "info";

  return (
    <div className="notification-result">
      <p className={`notice ${noticeKind}`}>
        {notificationSummary(result)}
      </p>
      {result.warnings.length > 0 ? <p className="report-context">{result.warnings.join(" ")}</p> : null}
      {recipientRows.length > 0 ? <DataTable rows={recipientRows} columns={["memberId", "firstName", "lastName", "email", "status", "error"]} density="compact" onOpenMember={onOpenMember} /> : null}
      {missingRows.length > 0 ? (
        <>
          <p className="report-context">{pluralize(missingRows.length, "absent member")} missing email.</p>
          <DataTable rows={missingRows} columns={["memberId", "firstName", "lastName", "status"]} density="compact" onOpenMember={onOpenMember} />
        </>
      ) : null}
    </div>
  );
}

function DiscordNotificationResultPanel({ result, onOpenMember }: { result: DiscordMissingMemberNotificationResult; onOpenMember?: (memberId: string) => void }) {
  const recipientRows = result.recipients.map((recipient) => ({
    memberId: recipient.memberId,
    firstName: recipient.firstName,
    lastName: recipient.lastName,
    discordUserId: recipient.discordUserId,
    mention: recipient.mention,
    status: notificationStatusLabel(recipient.status),
    error: recipient.error ?? ""
  }));
  const missingRows = result.missingDiscord.map((recipient) => ({
    memberId: recipient.memberId,
    firstName: recipient.firstName,
    lastName: recipient.lastName,
    status: "Missing Discord ID"
  }));
  const noticeKind = result.errorCount > 0 ? "error" : result.mode === "send" ? "success" : "info";

  return (
    <div className="notification-result">
      <p className={`notice ${noticeKind}`}>
        {discordNotificationSummary(result)}
      </p>
      {result.eligibleAt ? <p className="report-context">Configured delay: {result.delayMinutes ?? 30} minutes; eligible {formatDateTime(result.eligibleAt)}.</p> : null}
      {result.warnings.length > 0 ? <p className="report-context">{result.warnings.join(" ")}</p> : null}
      {recipientRows.length > 0 ? <DataTable rows={recipientRows} columns={["memberId", "firstName", "lastName", "discordUserId", "mention", "status", "error"]} density="compact" onOpenMember={onOpenMember} /> : null}
      {missingRows.length > 0 ? (
        <>
          <p className="report-context">{pluralize(missingRows.length, "absent member")} missing Discord user ID.</p>
          <DataTable rows={missingRows} columns={["memberId", "firstName", "lastName", "status"]} density="compact" onOpenMember={onOpenMember} />
        </>
      ) : null}
    </div>
  );
}

function DiscordScheduledEventBadge({ meeting }: { meeting: ScheduledMeeting }) {
  const mapping = meeting.discordScheduledEvent;
  if (!mapping) return <span className="status-badge pending">not synced</span>;
  if (mapping.status === "error") return <span className="status-badge failed">sync failed</span>;
  return <span className="status-badge completed">synced</span>;
}

function DiscordScheduledEventSyncResultPanel({ result }: { result: DiscordScheduledEventSyncResult }) {
  const noticeKind = result.errorCount > 0 ? "error" : "success";
  const rows = result.meetings.map((meeting) => ({
    meetingDate: meeting.meetingDate ?? "",
    title: meeting.title ?? meeting.meetingId,
    status: meeting.status === "created" ? "Created" : meeting.status === "updated" ? "Updated" : "Failed",
    discordEventId: meeting.discordEventId ?? "",
    error: meeting.error ?? ""
  }));

  return (
    <div className="notification-result">
      <p className={`notice ${noticeKind}`}>{discordScheduledEventSyncSummary(result)}</p>
      <p className="report-context">
        Location: {result.location}. Guild: {result.guildId ?? "not configured"}.
      </p>
      {result.warnings.length > 0 ? <p className="report-context">{result.warnings.join(" ")}</p> : null}
      <DataTable rows={rows} columns={["meetingDate", "title", "status", "discordEventId", "error"]} density="compact" />
    </div>
  );
}

function DiscordTestResultPanel({ result }: { result: DiscordTestNotificationResult }) {
  const noticeKind = result.errorCount > 0 ? "error" : result.mode === "send" ? "success" : "info";
  const rows = [{
    status: notificationStatusLabel(result.status),
    providerConfigured: result.providerConfigured ? "Yes" : "No",
    mode: result.mode,
    appName: result.metadata.appName,
    service: result.metadata.service,
    timestamp: formatDateTime(result.metadata.timestamp),
    notificationKind: result.metadata.notificationKind,
    webhookKind: result.metadata.webhookKind,
    workerVersion: result.metadata.workerVersion ?? "Unavailable",
    versionMetadataId: result.metadata.workerVersionMetadataId ?? "Unavailable",
    providerMessageId: result.providerMessageId ?? "",
    error: result.error ?? ""
  }];

  return (
    <div className="notification-result">
      <p className={`notice ${noticeKind}`}>
        {discordTestSummary(result)}
      </p>
      {result.warnings.length > 0 ? <p className="report-context">{result.warnings.join(" ")}</p> : null}
      <DataTable rows={rows} columns={["status", "providerConfigured", "mode", "appName", "service", "timestamp", "notificationKind", "webhookKind", "workerVersion", "versionMetadataId", "providerMessageId", "error"]} density="compact" />
    </div>
  );
}

function Kiosks({ session }: { session: DashboardSession }) {
  const { data, error, reload } = useApi<{ kiosks: KioskRow[] }>("/admin/kiosks", session);
  const { data: commands, error: commandError, reload: reloadCommands } = useApi<{ commands: KioskCommandRow[] }>("/admin/kiosk-commands?limit=75", session);
  const [commandMessages, setCommandMessages] = useState<Record<string, { kind: "success" | "error"; text: string }>>({});
  const [runningCommand, setRunningCommand] = useState<string>();
  const commandsByKiosk = groupCommandsByKiosk(commands?.commands ?? []);

  async function sendCommand(kiosk: KioskRow, action: KioskCommandAction) {
    if (action === "reboot_system" && !window.confirm(`Reboot ${kiosk.kiosk_id}? The kiosk will go offline briefly.`)) return;

    const commandKey = `${kiosk.kiosk_id}:${action}`;
    setRunningCommand(commandKey);
    setCommandMessages((messages) => ({ ...messages, [kiosk.kiosk_id]: { kind: "success", text: `Queued ${commandLabel(action)} for ${kiosk.kiosk_id}.` } }));
    try {
      await apiPost(`/admin/kiosks/${encodeURIComponent(kiosk.kiosk_id)}/commands`, { action }, session);
      setCommandMessages((messages) => ({ ...messages, [kiosk.kiosk_id]: { kind: "success", text: `${commandLabel(action)} command queued. The kiosk should pick it up shortly.` } }));
      reload();
      reloadCommands();
    } catch (error) {
      setCommandMessages((messages) => ({ ...messages, [kiosk.kiosk_id]: { kind: "error", text: friendlyDashboardError(error) } }));
    } finally {
      setRunningCommand(undefined);
    }
  }

  return (
    <>
      <form className="toolbar" onSubmit={async (event) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        await apiPost("/admin/kiosks", Object.fromEntries(form.entries()), session);
        formElement.reset();
        reload();
      }}>
        <input name="kioskId" placeholder="kiosk-a" required />
        <input name="name" placeholder="Shop entrance" required />
        <input name="location" placeholder="Location" />
        <input name="token" placeholder="Provisioning token" required />
        <button>Register kiosk</button>
      </form>
      <section>
        <h2>Kiosks</h2>
        {error ? <p className="error">{error}</p> : null}
        {commandError ? <p className="error">{commandError}</p> : null}
        <table>
          <thead>
            <tr>
              {["kiosk_id", "name", "location", "provisioned", "sync_health", "last_seen_at", "commands"].map((column) => <th key={column}>{column}</th>)}
            </tr>
          </thead>
          <tbody>
            {(data?.kiosks ?? []).map((kiosk) => {
              const recentCommands = commandsByKiosk[kiosk.kiosk_id] ?? [];
              return (
                <tr key={kiosk.kiosk_id}>
                  <td>{kiosk.kiosk_id}</td>
                  <td>{kiosk.name}</td>
                  <td>{kiosk.location ?? ""}</td>
                  <td><StatusBadge status={kiosk.active ? "active" : "inactive"} /></td>
                  <td><KioskHealthSummary kiosk={kiosk} /></td>
                  <td>{formatDateTime(kiosk.last_seen_at)}</td>
                  <td>
                    <div className="kiosk-actions">
                      {(["restart_display", "restart_services", "reboot_system"] as KioskCommandAction[]).map((action) => {
                        const commandKey = `${kiosk.kiosk_id}:${action}`;
                        return (
                          <button key={action} disabled={runningCommand === commandKey || !kiosk.active} onClick={() => sendCommand(kiosk, action)}>
                            {runningCommand === commandKey ? "Queuing..." : commandLabel(action)}
                          </button>
                        );
                      })}
                    </div>
                    {(() => {
                      const commandMessage = commandMessages[kiosk.kiosk_id];
                      return commandMessage ? <p className={`notice ${commandMessage.kind}`}>{commandMessage.text}</p> : null;
                    })()}
                    <CommandTimeline commands={recentCommands.slice(0, 4)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}

function KioskHealthSummary({ kiosk }: { kiosk: KioskRow }) {
  const status = kioskHealthStatus(kiosk);
  const details = [
    kiosk.reader_online === null || kiosk.reader_online === undefined ? "reader unknown" : kiosk.reader_online ? "reader online" : "reader offline",
    `${kiosk.pending_scan_count ?? 0} queued`,
    kiosk.last_sync_error ? "sync failing" : kiosk.last_sync_at ? `synced ${formatDateTime(kiosk.last_sync_at)}` : undefined
  ].filter(Boolean);

  return (
    <div className="health-summary">
      <StatusBadge status={status} />
      <span>{details.join(" | ")}</span>
      {kiosk.last_sync_error ? <p>{kiosk.last_sync_error}</p> : null}
    </div>
  );
}

function CommandTimeline({ commands }: { commands: KioskCommandRow[] }) {
  if (commands.length === 0) return <p className="empty-state">No recent commands.</p>;
  return (
    <div className="command-list">
      {commands.map((command) => (
        <article key={command.id} className="command-row">
          <div>
            <strong>{commandLabel(command.action)}</strong>
            <span>{commandTimestamp(command)}</span>
          </div>
          <StatusBadge status={command.status} />
          {command.message ? <p>{command.message}</p> : null}
        </article>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: KioskCommandStatus | KioskHealthStatus | "active" | "inactive" }) {
  return <span className={`status-badge ${status}`}>{statusLabel(status)}</span>;
}

function Events({ session, onOpenMember }: { session: DashboardSession; onOpenMember: (memberId: string) => void }) {
  const { data, error } = useApi<{ events: Array<Record<string, unknown>> }>("/admin/events", session);
  return <Table title="Recent scan events" error={error} rows={data?.events ?? []} columns={["memberId", "kioskId", "occurredAt", "status", "rejectionReason"]} onOpenMember={onOpenMember} />;
}

function Reports({ session, onOpenMember }: { session: DashboardSession; onOpenMember: (memberId: string) => void }) {
  const { data: members } = useApi<{ members: MemberRow[] }>("/admin/members", session);
  const { data: meetingData } = useApi<{ meetings: ScheduledMeeting[] }>("/admin/meetings", session);
  const [reportStartDate, setReportStartDate] = useState("");
  const [reportEndDate, setReportEndDate] = useState("");
  const [presenceDate, setPresenceDate] = useState(localDateInputValue());
  const [selectedMeetingDate, setSelectedMeetingDate] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [showUnscheduledAttendance, setShowUnscheduledAttendance] = useState(false);
  const [attendanceActionMessage, setAttendanceActionMessage] = useState<{ kind: "success" | "error"; text: string }>();
  const [attendanceActionBusyDate, setAttendanceActionBusyDate] = useState("");
  const [absenceNotificationResult, setAbsenceNotificationResult] = useState<MeetingAbsenceNotificationResult>();
  const [absenceNotificationBusyDate, setAbsenceNotificationBusyDate] = useState("");
  const reportQuery = reportRangeQuery(reportStartDate, reportEndDate, showUnscheduledAttendance);
  const { data: meetingSummary, error: meetingSummaryError, reload: reloadMeetingSummary } = useApi<{ meetings: MeetingSummaryReportRow[] }>(`/admin/reports/meetings${reportQuery}`, session);
  const { data: rosterSummary, error: rosterSummaryError, reload: reloadRosterSummary } = useApi<{ members: RosterAttendanceSummaryRow[] }>(`/admin/reports/roster-attendance${reportQuery}`, session);
  const { data: sessionRows, error: sessionError, reload: reloadSessions } = useApi<{ sessions: Array<Record<string, unknown>> }>(`/admin/reports/sessions${reportQuery}`, session);
  const { data: presence, error: presenceError, reload: reloadPresence } = useApi<PresenceReport>(`/admin/reports/presence?date=${presenceDate}`, session);
  const { data: memberReport, error: memberError, reload: reloadMember } = useOptionalApi<MemberAttendanceReport>(
    selectedMemberId ? `/admin/reports/member?memberId=${encodeURIComponent(selectedMemberId)}${reportQuery.replace("?", "&")}` : undefined,
    session
  );
  const activeMembers = members?.members.filter((member) => member.active) ?? [];
  const meetingRows = meetingSummary?.meetings ?? [];
  const absenceDate = meetingRows.some((meeting) => meeting.meetingDate === selectedMeetingDate) ? selectedMeetingDate : meetingRows[0]?.meetingDate ?? "";
  const { data: absences, error: absencesError, reload: reloadAbsences } = useOptionalApi<MeetingAbsenceReport>(
    absenceDate ? `/admin/reports/meeting-absences?date=${absenceDate}` : undefined,
    session
  );
  const selectedMeeting = meetingData?.meetings.find((meeting) => meeting.meetingDate === presenceDate);

  async function convertAttendanceDate(meeting: MeetingSummaryReportRow) {
    const title = window.prompt(`Name the scheduled meeting for ${meeting.meetingDate}.`, defaultMeetingTitle);
    if (title === null) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setAttendanceActionMessage({ kind: "error", text: "Meeting title cannot be blank." });
      return;
    }
    const required = window.confirm("Should this converted meeting count as required attendance?");
    setAttendanceActionBusyDate(meeting.meetingDate);
    setAttendanceActionMessage(undefined);
    try {
      await apiPost<ScheduledMeeting>("/admin/meetings/convert-unscheduled", {
        meetingDate: meeting.meetingDate,
        title: trimmedTitle,
        required
      }, session);
      setAttendanceActionMessage({ kind: "success", text: `Converted ${meeting.meetingDate} to ${trimmedTitle}.` });
      reloadMeetingSummary();
      reloadRosterSummary();
      reloadSessions();
      reloadAbsences();
    } catch (err) {
      setAttendanceActionMessage({ kind: "error", text: friendlyDashboardError(err) });
    } finally {
      setAttendanceActionBusyDate("");
    }
  }

  async function clearAttendanceDate(meeting: MeetingSummaryReportRow) {
    const confirmation = window.prompt(`This permanently deletes scan events, manual events, and attendance exclusions for ${meeting.meetingDate}. Scheduled meetings, roster, kiosks, and fingerprint mappings are preserved. Type CLEAR ${meeting.meetingDate} to continue.`);
    if (confirmation === null) return;
    setAttendanceActionBusyDate(meeting.meetingDate);
    setAttendanceActionMessage(undefined);
    try {
      const result = await apiPost<{ deletedScanEvents: number; deletedManualEvents: number; deletedAttendanceExclusions: number }>("/admin/attendance/clear-date", {
        meetingDate: meeting.meetingDate,
        confirmation
      }, session);
      setAttendanceActionMessage({ kind: "success", text: `Cleared ${meeting.meetingDate}: deleted ${pluralize(result.deletedScanEvents, "scan event")}, ${pluralize(result.deletedManualEvents, "manual event")}, and ${pluralize(result.deletedAttendanceExclusions, "attendance exclusion")}.` });
      if (selectedMeetingDate === meeting.meetingDate) setSelectedMeetingDate("");
      reloadMeetingSummary();
      reloadRosterSummary();
      reloadSessions();
      reloadPresence();
      reloadAbsences();
    } catch (err) {
      setAttendanceActionMessage({ kind: "error", text: friendlyDashboardError(err) });
    } finally {
      setAttendanceActionBusyDate("");
    }
  }

  async function emailAbsentMembersFromReport(meetingDate: string) {
    setAbsenceNotificationBusyDate(meetingDate);
    setAttendanceActionMessage(undefined);
    try {
      const preview = await apiPost<MeetingAbsenceNotificationResult>("/admin/notifications/meeting-absence", {
        meetingDate,
        preview: true
      }, session);
      setAbsenceNotificationResult(preview);
      const sendableCount = preview.recipients.filter((recipient) => recipient.status === "would_send").length;
      if (!preview.providerConfigured) {
        setAttendanceActionMessage({ kind: "success", text: `Preview ready for ${pluralize(sendableCount, "member")}; email sending is not configured.` });
        return;
      }
      if (sendableCount === 0) {
        setAttendanceActionMessage({ kind: "success", text: "No unsent absent members with email addresses for this meeting." });
        return;
      }
      if (!window.confirm(`Send missed-meeting email to ${pluralize(sendableCount, "absent member")}?`)) return;
      const result = await apiPost<MeetingAbsenceNotificationResult>("/admin/notifications/meeting-absence", {
        meetingDate
      }, session);
      setAbsenceNotificationResult(result);
      setAttendanceActionMessage({
        kind: result.errorCount > 0 ? "error" : "success",
        text: `Sent ${pluralize(result.sentCount, "email")}${result.skippedDuplicateCount > 0 ? `; skipped ${pluralize(result.skippedDuplicateCount, "duplicate")}` : ""}.`
      });
    } catch (err) {
      setAttendanceActionMessage({ kind: "error", text: friendlyDashboardError(err) });
    } finally {
      setAbsenceNotificationBusyDate("");
    }
  }

  return (
    <>
      <section>
        <h2>Meeting Attendance</h2>
        <div className="toolbar wrap">
          <label>
            From
            <input value={reportStartDate} onChange={(event) => setReportStartDate(event.target.value)} type="date" />
          </label>
          <label>
            To
            <input value={reportEndDate} onChange={(event) => setReportEndDate(event.target.value)} type="date" />
          </label>
          <button onClick={() => {
            reloadMeetingSummary();
            reloadRosterSummary();
            reloadSessions();
            reloadMember();
            reloadAbsences();
          }}>Refresh Range</button>
          <label className="inline-check">
            <input type="checkbox" checked={showUnscheduledAttendance} onChange={(event) => setShowUnscheduledAttendance(event.target.checked)} />
            Show unscheduled attendance
          </label>
        </div>
        <p className="report-context">Required meetings count missed active members after each member's attendance start date. Optional meetings show attendance without missed counts. Scheduled rows marked zero scans had no check-ins or manual corrections.</p>
        {attendanceActionMessage ? <p className={`notice ${attendanceActionMessage.kind}`}>{attendanceActionMessage.text}</p> : null}
        <div className="grid compact-grid">
          <Metric label="Required Meetings" value={meetingRows.filter((meeting) => meeting.required).length} />
          <Metric label="Zero-Scan Required" value={meetingRows.filter((meeting) => meeting.required && meeting.zeroScan).length} />
          <Metric label="Open Check-Ins" value={meetingRows.reduce((sum, meeting) => sum + meeting.openCheckIns, 0)} />
        </div>
        <MeetingAttendanceTable
          meetings={meetingRows}
          busyDate={attendanceActionBusyDate}
          onConvert={convertAttendanceDate}
          onClear={clearAttendanceDate}
        />
        {meetingSummaryError ? <p className="error">{meetingSummaryError}</p> : null}
      </section>

      <section>
        <h2>Meeting Absences</h2>
        <div className="toolbar wrap">
          <select value={absenceDate} onChange={(event) => setSelectedMeetingDate(event.target.value)}>
            <option value="">Select meeting</option>
            {meetingRows.map((meeting) => (
              <option key={meeting.meetingDate} value={meeting.meetingDate}>
                {meeting.meetingDate} - {meeting.title ?? "Unscheduled attendance"}
              </option>
            ))}
          </select>
          <button disabled={!absenceDate} onClick={reloadAbsences}>Refresh Absences</button>
          <button disabled={!absenceDate || absenceNotificationBusyDate === absenceDate} onClick={() => emailAbsentMembersFromReport(absenceDate)}>
            {absenceNotificationBusyDate === absenceDate ? "Checking..." : "Email absent members"}
          </button>
        </div>
        <p className="report-context">
          {absences
            ? absences.required
              ? `${absences.absentCount} active ${absences.absentCount === 1 ? "member missed" : "members missed"} ${absences.title ?? absences.meetingDate}; ${absences.notRequiredCount ?? 0} not required.`
              : "Optional meetings do not create missed-meeting rows."
            : "Pick a meeting to see the active members who missed it."}
        </p>
        {absencesError ? <p className="error">{absencesError}</p> : null}
        {absenceNotificationResult?.meetingDate === absenceDate ? <NotificationResultPanel result={absenceNotificationResult} onOpenMember={onOpenMember} /> : null}
        <DataTable rows={absences?.rows ?? []} columns={["memberId", "firstName", "lastName"]} onOpenMember={onOpenMember} />
        {(absences?.notRequiredRows?.length ?? 0) > 0 ? (
          <>
            <h3>Not Required</h3>
            <p className="report-context">Members added after this meeting date are excused from this required meeting.</p>
            <DataTable rows={absences?.notRequiredRows ?? []} columns={["memberId", "firstName", "lastName", "attendanceRequiredFromDate"]} onOpenMember={onOpenMember} />
          </>
        ) : null}
      </section>

      <section>
        <h2>Daily Presence</h2>
        <div className="toolbar wrap">
          <input value={presenceDate} onChange={(event) => setPresenceDate(event.target.value)} type="date" />
          <button onClick={reloadPresence}>Refresh</button>
        </div>
        <p className="report-context">
          {selectedMeeting
            ? `${selectedMeeting.title} is ${selectedMeeting.required ? "a required meeting" : "an optional meeting"}${meetingTimeRange(selectedMeeting) ? `, ${meetingTimeRange(selectedMeeting)}` : ""}.`
            : "No scheduled meeting is set for this date. Presence still shows scans and manual corrections recorded that day."}
        </p>
        {presenceError ? <p className="error">{presenceError}</p> : null}
        <div className="grid compact-grid">
          <Metric label="Signed In" value={presence?.counts.signedIn ?? 0} />
          <Metric label="Signed Out" value={presence?.counts.signedOut ?? 0} />
          <Metric label="Not Seen" value={presence?.counts.notSeen ?? 0} />
        </div>
        <DataTable
          rows={presence?.rows ?? []}
          columns={["memberId", "firstName", "lastName", "status", "checkInAt", "checkOutAt"]}
          onOpenMember={onOpenMember}
        />
      </section>

      <section>
        <h2>Member Attendance</h2>
        <div className="toolbar wrap">
          <select value={selectedMemberId} onChange={(event) => setSelectedMemberId(event.target.value)}>
            <option value="">Select member</option>
            {activeMembers.map((member) => (
              <option key={member.memberId} value={member.memberId}>
                {member.memberId} - {member.firstName} {member.lastName}
              </option>
            ))}
          </select>
          <button disabled={!selectedMemberId} onClick={reloadMember}>Refresh</button>
        </div>
        {memberError ? <p className="error">{memberError}</p> : null}
        {memberReport ? (
          <>
            <div className="grid compact-grid">
              <Metric label="Required Attendance" value={formatPercent(memberReport.attendanceRate)} />
              <Metric label="Class/Excused Attendance" value={formatPercent(memberReport.classAttendanceRate ?? null)} />
              <Metric label="Required Present" value={memberReport.presentMeetings} />
              <Metric label="Required Missed" value={memberReport.missedMeetings} />
            </div>
            <h3><button type="button" className="link-button member-name-link" onClick={() => onOpenMember(memberReport.memberId)}>{memberReport.firstName} {memberReport.lastName}</button></h3>
            <p className="report-context">Optional meetings and required meetings before this member's attendance start date are excluded from this attendance rate and missed-meeting count. The range filter above applies here too.</p>
            <DataTable
              rows={[{
                requiredMeetings: memberReport.totalMeetings,
                attendanceRequiredFromDate: memberReport.attendanceRequiredFromDate ?? "",
                lastSeenAt: memberReport.lastSeenAt ?? "",
                presentDates: memberReport.presentDates.join(", "),
                absentDates: memberReport.absentDates.join(", "),
                openSessionDates: memberReport.openSessionDates.join(", ")
              }]}
              columns={["requiredMeetings", "attendanceRequiredFromDate", "lastSeenAt", "presentDates", "absentDates", "openSessionDates"]}
            />
          </>
        ) : null}
      </section>

      <section>
        <h2>Roster Attendance</h2>
        <p className="report-context">Every active member is listed for the selected range. Open check-ins flag sessions that still need a checkout or mentor review.</p>
        {rosterSummaryError ? <p className="error">{rosterSummaryError}</p> : null}
        <DataTable
          rows={(rosterSummary?.members ?? []).map((member) => ({
            memberId: member.memberId,
            firstName: member.firstName,
            lastName: member.lastName,
            requiredMeetings: member.requiredMeetings,
            present: member.presentMeetings,
            missed: member.missedMeetings,
            attendance: formatPercent(member.attendanceRate),
            attendanceRequiredFromDate: member.attendanceRequiredFromDate ?? "",
            lastSeenAt: member.lastSeenAt ?? "",
            openCheckIns: member.openSessionWarning ? member.openSessionDates.join(", ") : ""
          }))}
          columns={["memberId", "firstName", "lastName", "requiredMeetings", "present", "missed", "attendance", "attendanceRequiredFromDate", "lastSeenAt", "openCheckIns"]}
          onOpenMember={onOpenMember}
        />
      </section>

      <form className="toolbar" onSubmit={async (event) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = Object.fromEntries(new FormData(formElement).entries()) as Record<string, string>;
        if (!form.occurredAt) return;
        await apiPost("/admin/manual-events", {
          ...form,
          occurredAt: new Date(form.occurredAt).toISOString()
        }, session);
        formElement.reset();
        reloadSessions();
        reloadMeetingSummary();
        reloadRosterSummary();
        reloadAbsences();
      }}>
        <input name="memberId" placeholder="Member ID" required />
        <input name="occurredAt" type="datetime-local" required />
        <select name="action" defaultValue="check_in">
          <option value="check_in">Check in</option>
          <option value="check_out">Check out</option>
        </select>
        <input name="reason" placeholder="Correction reason" required />
        <button>Add manual event</button>
      </form>
      <Table title="Attendance session audit" error={sessionError} rows={sessionRows?.sessions ?? []} columns={["meeting_date", "meeting_title", "required", "has_attendance", "member_id", "check_in_at", "check_out_at", "status"]} onOpenMember={onOpenMember} />
    </>
  );
}

function MeetingAttendanceTable({
  meetings,
  busyDate,
  onConvert,
  onClear
}: {
  meetings: MeetingSummaryReportRow[];
  busyDate: string;
  onConvert: (meeting: MeetingSummaryReportRow) => void;
  onClear: (meeting: MeetingSummaryReportRow) => void;
}) {
  if (meetings.length === 0) return <p className="empty-state">No meeting attendance rows match this range.</p>;

  return (
    <div className="meeting-table-wrap">
      <table>
        <thead>
          <tr>
            {["date", "title", "attendance", "time", "scheduled", "present", "absent", "openCheckIns", "note", "actions"].map((column) => <th key={column}>{columnLabel(column)}</th>)}
          </tr>
        </thead>
        <tbody>
          {meetings.map((meeting) => {
            const attendanceOnly = !meeting.scheduled;
            return (
              <tr key={meeting.meetingDate}>
                <td>{meeting.meetingDate}</td>
                <td>{meeting.title ?? "Unscheduled attendance"}</td>
                <td>{attendanceOnly ? "attendance-only" : meeting.required ? "required" : "optional"}</td>
                <td>{meetingTimeRange({ startsAt: meeting.startsAt, endsAt: meeting.endsAt })}</td>
                <td>{meeting.scheduled ? "yes" : "attendance-only"}</td>
                <td>{meeting.presentCount}</td>
                <td>{meeting.required && !attendanceOnly ? meeting.absentCount : ""}</td>
                <td>{meeting.openCheckIns}</td>
                <td>{meeting.zeroScan ? "zero scans" : ""}</td>
                <td>
                  {attendanceOnly ? (
                    <div className="kiosk-actions">
                      <button type="button" disabled={busyDate === meeting.meetingDate} onClick={() => onConvert(meeting)}>Convert</button>
                      <button type="button" className="danger-button" disabled={busyDate === meeting.meetingDate} onClick={() => onClear(meeting)}>Clear</button>
                    </div>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LegacyExport({ session }: { session: DashboardSession }) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const { data, error, reload } = useApi<Record<string, unknown>>(`/admin/export/legacy-sheets${reportRangeQuery(startDate, endDate)}`, session);
  return (
    <section>
      <h2>Google Sheets Export</h2>
      <div className="toolbar wrap">
        <label>
          From
          <input value={startDate} onChange={(event) => setStartDate(event.target.value)} type="date" />
        </label>
        <label>
          To
          <input value={endDate} onChange={(event) => setEndDate(event.target.value)} type="date" />
        </label>
        <button onClick={reload}>Refresh Export</button>
      </div>
      <p className="report-context">Mentor ranges include MeetingSummary, MeetingAbsences, and RosterAttendance. Legacy login, logout, scheduled meeting, and member summary ranges remain in the same payload.</p>
      {error ? <p className="error">{error}</p> : <pre>{JSON.stringify(data, null, 2)}</pre>}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <article className="metric"><span>{label}</span><strong>{value}</strong></article>;
}

function Table({ title, rows, columns, error, note, onOpenMember }: { title: string; rows: Array<Record<string, unknown>>; columns: string[]; error?: string; note?: string; onOpenMember?: (memberId: string) => void }) {
  return (
    <section>
      <h2>{title}</h2>
      {note ? <p className="report-context">{note}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <DataTable rows={rows} columns={columns} onOpenMember={onOpenMember} />
    </section>
  );
}

function DataTable({
  rows,
  columns,
  density = "regular",
  onOpenMember,
  onRemoveFromMeeting,
  onClearMemberAttendanceData,
  actionsDisabled = false
}: {
  rows: Array<Record<string, unknown>>;
  columns: string[];
  density?: "regular" | "compact";
  onOpenMember?: (memberId: string) => void;
  onRemoveFromMeeting?: (row: Record<string, unknown>) => void;
  onClearMemberAttendanceData?: (row: Record<string, unknown>) => void;
  actionsDisabled?: boolean;
}) {
  return (
    <div className="data-table-wrap">
      <table className={`data-table ${density === "compact" ? "compact-data-table" : ""}`}>
        <thead><tr>{columns.map((column) => <th key={column}>{columnLabel(column)}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, index) => {
            const memberId = tableRowMemberId(row);
            const memberName = [row.firstName ?? row.first_name, row.lastName ?? row.last_name].filter(Boolean).join(" ");
            return (
              <tr key={index}>{columns.map((column) => {
                if (column === "actions" && (onRemoveFromMeeting || onClearMemberAttendanceData)) {
                  return (
                    <td key={column}>
                      <div className="table-actions">
                        {onRemoveFromMeeting ? <button type="button" className="danger-button" disabled={actionsDisabled} onClick={() => onRemoveFromMeeting(row)}>Mark absent</button> : null}
                        {onClearMemberAttendanceData ? <button type="button" className="danger-button" disabled={actionsDisabled} onClick={() => onClearMemberAttendanceData(row)}>Clear attendance data</button> : null}
                      </div>
                    </td>
                  );
                }
                const value = row[column];
                if (onOpenMember && memberId && value !== undefined && value !== null && isMemberReferenceColumn(column)) {
                  return (
                    <td key={column}>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => onOpenMember(memberId)}
                        title="Open roster details"
                        aria-label={`Open roster details for ${memberName || `member ${memberId}`}`}
                      >
                        {formatTableCell(column, value)}
                      </button>
                    </td>
                  );
                }
                return <td key={column}>{formatTableCell(column, value)}</td>;
              })}</tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function tableRowMemberId(row: Record<string, unknown>): string {
  return String(row.memberId ?? row.member_id ?? row.studentId ?? row.student_id ?? "");
}

function isMemberReferenceColumn(column: string): boolean {
  return ["memberId", "member_id", "studentId", "student_id", "firstName", "first_name", "lastName", "last_name"].includes(column);
}

function useApi<T>(path: string, session: DashboardSession) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let active = true;
    setError(undefined);
    setLoading(true);
    apiGet<T>(path, session).then(
      (result) => {
        if (!active) return;
        setData(result);
      },
      (err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    ).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [path, session, nonce]);
  return { data, error, loading, reload: () => setNonce((value) => value + 1) };
}

function useOptionalApi<T>(path: string | undefined, session: DashboardSession) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!path) {
      setData(undefined);
      setError(undefined);
      setLoading(false);
      return;
    }
    let active = true;
    setError(undefined);
    setLoading(true);
    apiGet<T>(path, session).then(
      (result) => {
        if (!active) return;
        setData(result);
      },
      (err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    ).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [path, session, nonce]);
  return { data, error, loading, reload: () => setNonce((value) => value + 1) };
}

function parseRosterCsv(text: string) {
  const rows = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(parseCsvLine);
  if (rows.length === 0) throw new Error("Roster import is empty");

  const firstRow = rows[0];
  if (!firstRow) throw new Error("Roster import is empty");

  const header = firstRow.map((cell) => cell.trim().toLowerCase());
  const hasHeader = ["memberid", "member id", "studentid", "student id", "id"].some((name) => header.includes(name));
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const idIndex = hasHeader ? findHeaderIndex(header, ["memberid", "member id", "studentid", "student id", "id"]) : 0;
  const firstIndex = hasHeader ? findHeaderIndex(header, ["firstname", "first name", "first"]) : 1;
  const lastIndex = hasHeader ? findHeaderIndex(header, ["lastname", "last name", "last"]) : 2;
  const emailIndex = hasHeader ? header.findIndex((cell) => ["email", "user email", "google email"].includes(cell)) : -1;
  const discordIndex = hasHeader ? header.findIndex((cell) => ["discorduserid", "discord user id", "discord_user_id", "discordid", "discord id", "discord"].includes(cell)) : -1;

  return dataRows.map((row, index) => {
    const memberId = row[idIndex]?.trim();
    const firstName = row[firstIndex]?.trim();
    const lastName = row[lastIndex]?.trim();
    const email = emailIndex >= 0 ? row[emailIndex]?.trim() : undefined;
    const discordUserId = discordIndex >= 0 ? row[discordIndex]?.trim() : undefined;
    if (!memberId || !firstName || !lastName) throw new Error(`Roster row ${index + 1} must include member ID, first name, and last name`);
    return {
      memberId,
      firstName,
      lastName,
      ...(email ? { email } : {}),
      ...(discordUserId ? { discordUserId } : {})
    };
  });
}

function memberMatchesRosterSearch(member: MemberRow, query: string) {
  const normalizedQuery = query.toLowerCase();
  if (!normalizedQuery) return true;
  const firstName = member.firstName.toLowerCase();
  const lastName = member.lastName.toLowerCase();
  return [
    member.memberId.toLowerCase(),
    firstName,
    lastName,
    `${firstName} ${lastName}`,
    `${lastName} ${firstName}`
  ].some((value) => value.includes(normalizedQuery));
}

function localDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatPercent(value: number | null) {
  return value === null ? "N/A" : `${Math.round(value * 100)}%`;
}

function emptyMeetingForm(): MeetingFormState {
  const today = localDateInputValue();
  return {
    meetingDate: today,
    title: defaultMeetingTitle,
    required: true,
    startTime: defaultMeetingStartTime,
    endTime: defaultMeetingEndTime,
    notes: "",
    repeats: false,
    startDate: today,
    endDate: today,
    weekdays: [weekdayForIsoDate(today)]
  };
}

function emptyBulkMeetingEdit(): BulkMeetingEditState {
  return {
    titleEnabled: false,
    title: defaultMeetingTitle,
    requiredEnabled: false,
    required: true,
    timesEnabled: false,
    startTime: defaultMeetingStartTime,
    endTime: defaultMeetingEndTime,
    notesEnabled: false,
    notes: ""
  };
}

function meetingToFormState(meeting: ScheduledMeeting): MeetingFormState {
  return {
    meetingDate: meeting.meetingDate,
    title: meeting.title,
    required: meeting.required,
    startTime: localTimeInputValue(meeting.startsAt),
    endTime: localTimeInputValue(meeting.endsAt),
    notes: meeting.notes ?? "",
    repeats: false,
    startDate: meeting.meetingDate,
    endDate: meeting.meetingDate,
    weekdays: [weekdayForIsoDate(meeting.meetingDate)]
  };
}

function meetingPayload(formState: MeetingFormState) {
  if (formState.startTime && formState.endTime && formState.endTime <= formState.startTime) {
    throw new Error("Meeting end time must be after the start time.");
  }
  return {
    meetingDate: formState.meetingDate,
    title: formState.title.trim(),
    required: formState.required,
    startsAt: formState.startTime ? localDateAndTimeToIso(formState.meetingDate, formState.startTime) : undefined,
    endsAt: formState.endTime ? localDateAndTimeToIso(formState.meetingDate, formState.endTime) : undefined,
    notes: formState.notes.trim() || undefined
  };
}

function recurringMeetingPayload(formState: MeetingFormState, meetingDate: string) {
  if (formState.startTime && formState.endTime && formState.endTime <= formState.startTime) {
    throw new Error("Meeting end time must be after the start time.");
  }
  return {
    meetingDate,
    title: formState.title.trim(),
    required: formState.required,
    startsAt: formState.startTime ? localDateAndTimeToIso(meetingDate, formState.startTime) : undefined,
    endsAt: formState.endTime ? localDateAndTimeToIso(meetingDate, formState.endTime) : undefined
  };
}

function recurringMeetingDates(formState: MeetingFormState) {
  if (!formState.title.trim()) throw new Error("Meeting title is required.");
  if (!formState.startDate || !formState.endDate) throw new Error("Start and end dates are required.");
  if (formState.startDate > formState.endDate) throw new Error("End date must be on or after the start date.");
  if (formState.weekdays.length === 0) throw new Error("Choose at least one weekday.");
  if (formState.startTime && formState.endTime && formState.endTime <= formState.startTime) {
    throw new Error("Meeting end time must be after the start time.");
  }

  const selectedWeekdays = new Set(formState.weekdays);
  const dates: string[] = [];
  for (let date = formState.startDate; date <= formState.endDate; date = addDays(date, 1)) {
    if (selectedWeekdays.has(weekdayForIsoDate(date))) dates.push(date);
    if (dates.length > 260) throw new Error("Recurring creation is limited to 260 meetings at a time.");
  }
  if (dates.length === 0) throw new Error("No dates matched the selected recurrence.");
  return dates;
}

function previewRecurringMeetings(formState: MeetingFormState, existingMeetingDates: Set<string>) {
  try {
    const dates = recurringMeetingDates(formState);
    const createCount = dates.filter((date) => !existingMeetingDates.has(date)).length;
    const conflictDates = dates.filter((date) => existingMeetingDates.has(date));
    return {
      kind: createCount > 0 ? "success" : "error",
      createCount,
      text: `${pluralize(createCount, "meeting")} will be created${conflictDates.length > 0 ? `; ${pluralize(conflictDates.length, "existing date")} will be skipped: ${formatDateList(conflictDates)}.` : "."}`
    };
  } catch (error) {
    return { kind: "error", createCount: 0, text: friendlyDashboardError(error) };
  }
}

function toggleWeekday(weekdays: number[], weekday: number) {
  if (weekdays.includes(weekday)) return weekdays.filter((value) => value !== weekday);
  return [...weekdays, weekday].sort((left, right) => left - right);
}

function weekdayForIsoDate(value: string) {
  const { year, month, day } = parseIsoDate(value);
  return new Date(year, month - 1, day).getDay();
}

function addDays(value: string, days: number) {
  const { year, month, day } = parseIsoDate(value);
  const date = new Date(year, month - 1, day + days);
  const nextYear = date.getFullYear();
  const nextMonth = String(date.getMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function parseIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Dates must use YYYY-MM-DD format.");
  const [, year, month, day] = match;
  return { year: Number(year), month: Number(month), day: Number(day) };
}

function localDateAndTimeToIso(meetingDate: string, time: string) {
  return new Date(`${meetingDate}T${time}`).toISOString();
}

function pluralize(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function formatDateList(dates: string[]) {
  if (dates.length <= 4) return dates.join(", ");
  return `${dates.slice(0, 4).join(", ")} and ${dates.length - 4} more`;
}

function groupMeetingsByDate(meetings: ScheduledMeeting[]) {
  return meetings.reduce<Map<string, ScheduledMeeting[]>>((groups, meeting) => {
    groups.set(meeting.meetingDate, [...(groups.get(meeting.meetingDate) ?? []), meeting]);
    return groups;
  }, new Map());
}

function calendarDaysForMonth(month: string) {
  const { year, monthIndex } = parseMonthValue(month);
  const firstDay = new Date(year, monthIndex, 1);
  const startDate = new Date(year, monthIndex, 1 - firstDay.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + index);
    const isoDate = localDateInputValue(date);
    return {
      date: isoDate,
      dayOfMonth: date.getDate(),
      inMonth: date.getMonth() === monthIndex
    };
  });
}

function addMonthsToMonth(month: string, offset: number) {
  const { year, monthIndex } = parseMonthValue(month);
  const date = new Date(year, monthIndex + offset, 1);
  return localDateInputValue(date).slice(0, 7);
}

function formatMonthLabel(month: string) {
  const { year, monthIndex } = parseMonthValue(month);
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(year, monthIndex, 1));
}

function parseMonthValue(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) {
    const today = new Date();
    return { year: today.getFullYear(), monthIndex: today.getMonth() };
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11) {
    const today = new Date();
    return { year: today.getFullYear(), monthIndex: today.getMonth() };
  }
  return { year, monthIndex };
}

function MeetingRequirementBadge({ required }: { required: boolean }) {
  return <span className={`status-badge ${required ? "active" : "optional"}`}>{required ? "Required" : "Optional"}</span>;
}

function meetingTimeRange(meeting: Pick<ScheduledMeeting, "startsAt" | "endsAt">) {
  if (!meeting.startsAt && !meeting.endsAt) return "";
  if (meeting.startsAt && meeting.endsAt) return `${formatTime(meeting.startsAt)} - ${formatTime(meeting.endsAt)}`;
  if (meeting.startsAt) return `Starts ${formatTime(meeting.startsAt)}`;
  return `Ends ${formatTime(meeting.endsAt)}`;
}

function calendarMeetingSummaryLabel(
  meeting: ScheduledMeeting,
  summary: MeetingSummaryReportRow | undefined,
  reportState: { loading: boolean; unavailable: boolean }
) {
  if (summary) {
    if (summary.required) return `${summary.presentCount} present, ${summary.absentCount} absent`;
    return `${summary.presentCount} present`;
  }
  if (reportState.loading) return "Loading...";
  if (reportState.unavailable) return "Report unavailable";
  if (!isScheduledMeetingComplete(meeting)) return "Upcoming";
  return meeting.required ? "No attendance yet" : "0 present";
}

function isScheduledMeetingComplete(meeting: Pick<ScheduledMeeting, "meetingDate" | "endsAt">) {
  if (meeting.endsAt) return new Date(meeting.endsAt).getTime() <= Date.now();
  return meeting.meetingDate <= localDateInputValue();
}

function notificationSummary(result: MeetingAbsenceNotificationResult) {
  const deliverableCount = result.recipients.filter((recipient) => recipient.status === "would_send").length;
  if (result.mode === "preview") {
    return result.providerConfigured
      ? `${pluralize(deliverableCount, "absent member")} ready to email; ${pluralize(result.missingEmail.length, "missing email")}.`
      : `${pluralize(deliverableCount, "absent member")} would receive email; provider not configured. ${pluralize(result.missingEmail.length, "missing email")}.`;
  }
  return `Sent ${pluralize(result.sentCount, "email")}; skipped ${pluralize(result.skippedDuplicateCount, "duplicate")}; ${pluralize(result.errorCount, "error")}.`;
}

function discordNotificationSummary(result: DiscordMissingMemberNotificationResult) {
  const deliverableCount = result.recipients.filter((recipient) => recipient.status === "would_send").length;
  const providerLabel = result.notificationKind === "discord_bot_missing_members" ? "Discord bot" : "Discord webhook";
  if (result.mode === "preview") {
    return result.providerConfigured
      ? `${pluralize(deliverableCount, "absent member")} ready to ping; ${pluralize(result.missingDiscord.length, "missing Discord ID")}.`
      : `${pluralize(deliverableCount, "absent member")} would be pinged; ${providerLabel} not configured. ${pluralize(result.missingDiscord.length, "missing Discord ID")}.`;
  }
  return `Pinged ${pluralize(result.sentCount, "member")}; skipped ${pluralize(result.skippedDuplicateCount, "duplicate")}; ${pluralize(result.errorCount, "error")}.`;
}

function discordScheduledEventSyncSummary(result: DiscordScheduledEventSyncResult) {
  if (!result.providerConfigured) {
    return `Discord server calendar sync is not configured; ${pluralize(result.errorCount, "meeting")} could not sync.`;
  }
  return `Synced ${pluralize(result.syncedCount, "meeting")} to Discord; created ${result.createdCount}, updated ${result.updatedCount}, ${pluralize(result.errorCount, "error")}.`;
}

function discordTestSummary(result: DiscordTestNotificationResult) {
  if (result.mode === "preview") {
    return result.providerConfigured
      ? "Discord webhook test is ready to send."
      : "Discord webhook test preview only; webhook not configured.";
  }
  if (result.errorCount > 0) return `Discord webhook test failed: ${result.error ?? "Unknown provider error"}`;
  return "Discord webhook test sent.";
}

function notificationStatusLabel(status: MeetingAbsenceNotificationResult["recipients"][number]["status"]) {
  if (status === "would_send") return "Would send";
  if (status === "skipped_duplicate") return "Already sent";
  if (status === "sent") return "Sent";
  return "Error";
}

function memberAttendanceNotificationSummary(result: MemberAttendanceReportNotificationResult) {
  if (!result.recipient) return `No attendance report sent; ${result.firstName} ${result.lastName} does not have a saved email address.`;
  if (result.mode === "preview") {
    return result.providerConfigured
      ? `Preview ready for ${result.recipient.email}: ${formatPercent(result.report.attendanceRate)} attendance across ${pluralize(result.report.totalMeetings, "completed required meeting")}.`
      : `Preview ready for ${result.recipient.email}; email sending is not configured.`;
  }
  if (result.recipient.status === "skipped_duplicate") return `Attendance report was already sent to ${result.recipient.email} today.`;
  if (result.recipient.status === "error") return `Attendance report failed for ${result.recipient.email}: ${result.recipient.error ?? "Unknown error"}`;
  return `Sent attendance report to ${result.recipient.email}.`;
}

function findHeaderIndex(header: string[], names: string[]) {
  const index = header.findIndex((cell) => names.includes(cell));
  if (index === -1) throw new Error(`Missing roster column: ${names[0]}`);
  return index;
}

interface PresenceReport {
  date: string;
  counts: {
    signedIn: number;
    signedOut: number;
    notSeen: number;
  };
  rows: Array<Record<string, unknown>>;
}

interface MeetingSummaryReportRow {
  meetingDate: string;
  title: string | null;
  required: boolean;
  startsAt?: string;
  endsAt?: string;
  scheduled: boolean;
  hasAttendance: boolean;
  zeroScan: boolean;
  presentCount: number;
  activePresentCount: number;
  absentCount: number;
  openCheckIns: number;
}

interface MeetingAbsenceReport {
  meetingDate: string;
  title: string | null;
  required: boolean;
  startsAt?: string;
  endsAt?: string;
  absentCount: number;
  notRequiredCount: number;
  excusedCount?: number;
  rows: Array<Record<string, unknown>>;
  notRequiredRows: Array<Record<string, unknown>>;
}

interface MemberAttendanceReport {
  memberId: string;
  firstName: string;
  lastName: string;
  startDate?: string;
  endDate?: string;
  totalMeetings: number;
  presentMeetings: number;
  missedMeetings: number;
  attendanceRate: number | null;
  excusedMeetings?: number;
  classRequiredMeetings?: number;
  classAttendanceRate?: number | null;
  lastSeenAt?: string;
  presentDates: string[];
  absentDates: string[];
  openSessionDates: string[];
  attendanceRequiredFromDate: string | null;
  scheduledMeetings: MemberScheduledMeeting[];
}

interface MemberScheduledMeeting {
  meetingDate: string;
  title: string;
  required: boolean;
  startsAt?: string;
  endsAt?: string;
  complete: boolean;
  present: boolean;
  excused: boolean;
  excuseReason?: string;
  excusedBy?: string;
  excusedAt?: string;
}

interface RosterAttendanceSummaryRow {
  memberId: string;
  firstName: string;
  lastName: string;
  requiredMeetings: number;
  presentMeetings: number;
  missedMeetings: number;
  attendanceRate: number | null;
  excusedMeetings?: number;
  classRequiredMeetings?: number;
  classAttendanceRate?: number | null;
  lastSeenAt?: string;
  openSessionDates: string[];
  openSessionWarning: boolean;
  attendanceRequiredFromDate: string | null;
}

function reportRangeQuery(startDate: string, endDate: string, includeUnscheduled = false) {
  const params = new URLSearchParams();
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  if (includeUnscheduled) params.set("includeUnscheduled", "1");
  const query = params.toString();
  return query ? `?${query}` : "";
}

function friendlyEnrollmentError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Fingerprint scans did not match")) return "The two scans did not match. Try again with the same finger, held flat both times.";
  if (message.includes("Fingerprint sensor not found")) return "The fingerprint reader did not respond. Check the reader connection and try again.";
  if (message.includes("timed out")) return "Enrollment timed out. Try again, placing the finger on the reader soon after clicking the button.";
  if (message.includes("member is not active in roster")) return "That member is not active in the roster. Sync the roster first, then try again.";
  if (message.includes("already in progress")) return "Another enrollment is already running. Wait for it to finish, then try again.";
  if (message.includes("confirm overwrite")) return "That slot already has a member mapping. Check the replace confirmation, then try again.";
  if (message.includes("Not found")) return "Fingerprint enrollment is only available from the Pi dashboard at http://AttKiosk:5174.";
  return message.replace(/^.*"error":"?/, "").replace(/"}$/, "");
}

function friendlyDashboardError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^.*"error":"?/, "").replace(/"}$/, "");
}

function commandLabel(action: KioskCommandAction) {
  if (action === "restart_display") return "Restart display";
  if (action === "restart_services") return "Restart services";
  return "Reboot system";
}

function groupCommandsByKiosk(commands: KioskCommandRow[]) {
  return commands.reduce<Record<string, KioskCommandRow[]>>((groups, command) => {
    groups[command.kioskId] = [...(groups[command.kioskId] ?? []), command];
    return groups;
  }, {});
}

function meetingSummaryLabel(meeting: Pick<MeetingSummaryReportRow, "meetingDate" | "title" | "startsAt" | "endsAt">) {
  const title = meeting.title ?? "Unscheduled attendance";
  const time = meetingTimeRange({ startsAt: meeting.startsAt, endsAt: meeting.endsAt });
  return `${meeting.meetingDate} - ${title}${time ? `, ${time}` : ""}`;
}

function commandTimestamp(command: KioskCommandRow) {
  if (command.completedAt) return `Completed ${formatDateTime(command.completedAt)}`;
  if (command.claimedAt) return `Started ${formatDateTime(command.claimedAt)}`;
  return `Queued ${formatDateTime(command.requestedAt)}`;
}

function formatTableCell(column: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value !== "string") return String(value);
  if (column === "checkInAt" || column === "checkOutAt" || column === "check_in_at" || column === "check_out_at") {
    return formatTime(value);
  }
  if (column === "lastSeenAt" || column === "occurredAt" || column === "occurred_at") return formatDateTime(value);
  return value;
}

function kioskHealthStatus(kiosk: KioskRow): KioskHealthStatus {
  if (!kiosk.active) return "offline";
  if (!kiosk.last_heartbeat_at) return "unknown";
  const heartbeatAgeMs = Date.now() - new Date(kiosk.last_heartbeat_at).getTime();
  if (heartbeatAgeMs > 60_000) return "offline";
  if (kiosk.reader_online === 0 || (kiosk.pending_scan_count ?? 0) > 0 || kiosk.last_sync_error) return "degraded";
  return "online";
}

function statusLabel(status: KioskCommandStatus | KioskHealthStatus | "active" | "inactive") {
  if (status === "active") return "Active";
  if (status === "inactive") return "Inactive";
  if (status === "online") return "Online";
  if (status === "degraded") return "Needs attention";
  if (status === "offline") return "Offline";
  if (status === "unknown") return "Unknown";
  if (status === "pending") return "Queued";
  if (status === "running") return "Running";
  if (status === "completed") return "Completed";
  return "Failed";
}

function columnLabel(column: string) {
  const labels: Record<string, string> = {
    active: "Active",
    absent: "Absent",
    absentDates: "Absent Dates",
    attendance: "Attendance",
    attendanceRate: "Attendance",
    attendanceRequiredFromDate: "Required From",
    checkInAt: "Time In",
    checkOutAt: "Time Out",
    check_in_at: "Time In",
    check_out_at: "Time Out",
    date: "Date",
    email: "Email",
    discordUserId: "Discord User ID",
    discord_user_id: "Discord User ID",
    firstName: "First Name",
    first_name: "First Name",
    has_attendance: "Has Attendance",
    lastName: "Last Name",
    lastSeenAt: "Last Seen",
    last_name: "Last Name",
    meeting_date: "Meeting Date",
    meeting_title: "Meeting",
    memberId: "Member ID",
    member_id: "Member ID",
    note: "Note",
    occurred_at: "Occurred At",
    occurredAt: "Occurred At",
    openCheckIns: "Open Check-Ins",
    openSessionDates: "Open Check-Ins",
    present: "Present",
    presentDates: "Present Dates",
    rejection_reason: "Rejection Reason",
    rejectionReason: "Rejection Reason",
    required: "Required",
    requiredMeetings: "Required Meetings",
    scheduled: "Scheduled",
    status: "Status",
    studentId: "Member ID",
    studentID: "Member ID",
    student_id: "Member ID",
    time: "Time",
    title: "Title"
  };
  return labels[column] ?? column.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === "\"" && next === "\"") {
      cell += "\"";
      i += 1;
    } else if (char === "\"") {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }

  cells.push(cell);
  return cells;
}

function readStoredSession(): DashboardSession {
  const idToken = sessionStorage.getItem("googleIdToken") ?? undefined;
  if (googleAuthEnabled && !idToken) {
    localStorage.removeItem("adminEmail");
    return { email: "" };
  }
  return {
    email: localStorage.getItem("adminEmail") ?? "",
    idToken
  };
}

function readStoredThemeMode(): ThemeMode {
  const stored = localStorage.getItem("dashboardThemeMode");
  return stored === "light" || stored === "dark" || stored === "themed" ? stored : "themed";
}

function decodeGooglePayload(encodedPayload: string): { email: string } {
  const payload = JSON.parse(atob(encodedPayload.replace(/-/g, "+").replace(/_/g, "/"))) as { email?: string };
  if (!payload.email) throw new Error("Google token did not include an email");
  return { email: payload.email };
}

createRoot(document.getElementById("root")!).render(<App />);
