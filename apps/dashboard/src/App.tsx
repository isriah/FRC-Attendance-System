import { FormEvent, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { apiBaseUrl, apiDelete, apiGet, apiPost, apiPut, type DashboardSession } from "./api";
import "./styles.css";

type Tab = "overview" | "roster" | "admins" | "meetings" | "kiosks" | "events" | "reports" | "export";
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

interface FingerprintEnrollment {
  memberId: string;
  firstName?: string;
  lastName?: string;
  active: number;
  slot: number;
  fingerLabel?: string;
  enrolledAt: string;
}

interface ScheduledMeeting {
  id: string;
  meetingDate: string;
  title: string;
  required: boolean;
  startsAt?: string;
  endsAt?: string;
  notes?: string;
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

const defaultMeetingTitle = "Regular Meeting";
const defaultMeetingStartTime = "15:00";
const defaultMeetingEndTime = "17:30";
const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const googleAuthEnabled = Boolean(googleClientId);
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
        {(["overview", "roster", "admins", "meetings", "kiosks", "events", "reports", "export"] as Tab[]).map((item) => (
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
        {tab === "roster" && <Roster session={session} />}
        {tab === "admins" && <AdminUsers session={session} />}
        {tab === "meetings" && <Meetings session={session} />}
        {tab === "kiosks" && <Kiosks session={session} />}
        {tab === "events" && <Events session={session} />}
        {tab === "reports" && <Reports session={session} />}
        {tab === "export" && <LegacyExport session={session} />}
      </section>
    </main>
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

  return (
    <>
      <div className="grid">
        <Metric label="Kiosks" value={kiosks?.kiosks.length ?? 0} />
        <Metric label="Recent Events" value={events?.events.length ?? 0} />
        <Metric label="System" value="Online" />
      </div>
    </>
  );
}

function Roster({ session }: { session: DashboardSession }) {
  const { data, error, reload } = useApi<{ members: MemberRow[] }>("/admin/members", session);
  const { data: enrollmentData, error: enrollmentError, reload: reloadEnrollments } = useOptionalApi<{ enrollments: FingerprintEnrollment[] }>(
    fingerprintEnrollmentAvailable ? "/admin/fingerprint/enrollments" : undefined,
    session
  );
  const [importText, setImportText] = useState("memberId,firstName,lastName,email\n100001,Bench,Member,bench@example.org");
  const [importMessage, setImportMessage] = useState<string>();
  const [emailDrafts, setEmailDrafts] = useState<Record<string, string>>({});
  const [emailMessage, setEmailMessage] = useState<{ kind: "success" | "error"; text: string }>();
  const [savingEmailFor, setSavingEmailFor] = useState<string>();
  const [pullingRoster, setPullingRoster] = useState(false);
  const [enrollMemberId, setEnrollMemberId] = useState("");
  const [enrollSlot, setEnrollSlot] = useState("");
  const [enrollFingerLabel, setEnrollFingerLabel] = useState("right-index");
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [enrollMessage, setEnrollMessage] = useState<{ kind: "info" | "success" | "error"; text: string }>();
  const [enrolling, setEnrolling] = useState(false);
  const activeMembers = data?.members.filter((member) => member.active) ?? [];
  const enrollments = enrollmentData?.enrollments ?? [];
  const nextOpenSlot = nextAvailableFingerprintSlot(enrollments);
  const selectedSlot = Number(enrollSlot);
  const occupiedEnrollment = enrollments.find((enrollment) => enrollment.slot === selectedSlot);
  const selectedEnrollmentMember = activeMembers.find((member) => member.memberId === enrollMemberId);
  const overwriteBlocked = Boolean(occupiedEnrollment && !confirmOverwrite);

  useEffect(() => {
    if (!fingerprintEnrollmentAvailable || enrollSlot) return;
    setEnrollSlot(String(nextAvailableFingerprintSlot(enrollments)));
  }, [enrollSlot, enrollments]);

  useEffect(() => {
    setConfirmOverwrite(false);
  }, [enrollSlot, enrollMemberId]);

  useEffect(() => {
    if (!data?.members) return;
    setEmailDrafts((drafts) => {
      const next = { ...drafts };
      for (const member of data.members) {
        if (next[member.memberId] === undefined) next[member.memberId] = member.email ?? "";
      }
      return next;
    });
  }, [data?.members]);

  async function saveMemberEmail(member: MemberRow) {
    const email = emailDrafts[member.memberId]?.trim() ?? "";
    setSavingEmailFor(member.memberId);
    setEmailMessage(undefined);
    try {
      await apiPut(`/admin/members/${encodeURIComponent(member.memberId)}/email`, { email: email || null }, session);
      setEmailMessage({ kind: "success", text: `Saved email for ${member.firstName} ${member.lastName}.` });
      reload();
    } catch (error) {
      setEmailMessage({ kind: "error", text: friendlyDashboardError(error) });
    } finally {
      setSavingEmailFor(undefined);
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

  function startRemapEnrollment(enrollment: FingerprintEnrollment) {
    setEnrollMemberId(enrollment.memberId);
    setEnrollSlot(String(enrollment.slot));
    setEnrollFingerLabel(enrollment.fingerLabel ?? "");
    setConfirmOverwrite(false);
    setEnrollMessage({
      kind: "info",
      text: `Slot ${enrollment.slot} is loaded for remapping. Check the replace confirmation before saving changes.`
    });
  }

  return (
    <>
      <section>
        <h2>Roster Import</h2>
        <form className="stack" onSubmit={async (event) => {
          event.preventDefault();
          const members = parseRosterCsv(importText);
          await apiPost("/admin/roster/sync", { members }, session);
          setImportMessage(`Synced ${members.length} members`);
          reload();
        }}>
          <textarea value={importText} onChange={(event) => setImportText(event.target.value)} rows={8} />
          <div className="toolbar compact">
            <button>Sync roster</button>
            {productionRosterPullAvailable ? (
              <button type="button" disabled={pullingRoster} onClick={async () => {
                setPullingRoster(true);
                try {
                  const result = await apiPost<{ synced: number; rosterSyncedAt?: string | null }>("/admin/roster/pull-production", {}, session);
                  setImportMessage(`Pulled ${result.synced} production members${result.rosterSyncedAt ? ` synced ${formatDateTime(result.rosterSyncedAt)}` : ""}`);
                  reload();
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
      </section>
      <section>
        <h2>Member Emails</h2>
        <p className="notice info">
          Member emails are stored on roster records for association. Dashboard login access is managed on the Admins tab.
        </p>
        {emailMessage ? <p className={`notice ${emailMessage.kind}`}>{emailMessage.text}</p> : null}
        <RosterEmailTable
          members={data?.members ?? []}
          drafts={emailDrafts}
          savingFor={savingEmailFor}
          onDraftChange={(memberId, email) => setEmailDrafts((drafts) => ({ ...drafts, [memberId]: email }))}
          onSave={saveMemberEmail}
        />
      </section>
      <section>
        <h2>Fingerprint Enrollment</h2>
        {!fingerprintEnrollmentAvailable ? (
          <p className="notice info">
            Fingerprint enrollment must run from the Raspberry Pi dashboard at http://AttKiosk:5174 because it needs direct access to the local fingerprint reader.
          </p>
        ) : null}
        <form className="toolbar wrap" onSubmit={async (event) => {
          event.preventDefault();
          await submitFingerprintEnrollment(false);
        }}>
          <select value={enrollMemberId} onChange={(event) => setEnrollMemberId(event.target.value)} required>
            <option value="">Select member</option>
            {activeMembers.map((member) => (
              <option key={member.memberId} value={member.memberId}>
                {member.memberId} - {member.firstName} {member.lastName}
              </option>
            ))}
          </select>
          <label className="field-label">
            <span>Template slot</span>
            <input value={enrollSlot} onChange={(event) => setEnrollSlot(event.target.value)} type="number" min="1" max="200" placeholder="Slot" required />
          </label>
          <input value={enrollFingerLabel} onChange={(event) => setEnrollFingerLabel(event.target.value)} placeholder="Finger label" />
          <button type="button" onClick={() => setEnrollSlot(String(nextOpenSlot))} disabled={!fingerprintEnrollmentAvailable || enrolling}>Use slot {nextOpenSlot}</button>
          <button disabled={enrolling || !fingerprintEnrollmentAvailable || overwriteBlocked}>{enrolling ? "Enrolling..." : "Enroll fingerprint"}</button>
          <button type="button" disabled={enrolling || !fingerprintEnrollmentAvailable || !enrollMemberId || !enrollSlot || overwriteBlocked} onClick={() => submitFingerprintEnrollment(true)}>
            Save mapping only
          </button>
        </form>
        {fingerprintEnrollmentAvailable ? (
          <p className="slot-suggestion">
            Suggested next open slot: <button type="button" onClick={() => setEnrollSlot(String(nextOpenSlot))} disabled={enrolling}>{nextOpenSlot}</button>
          </p>
        ) : null}
        {occupiedEnrollment ? (
          <label className="inline-check notice info">
            <input type="checkbox" checked={confirmOverwrite} onChange={(event) => setConfirmOverwrite(event.target.checked)} />
            Replace slot {occupiedEnrollment.slot}, currently mapped to {fingerprintEnrollmentName(occupiedEnrollment)}
          </label>
        ) : null}
        {enrollMessage ? <p className={`notice ${enrollMessage.kind}`}>{enrollMessage.text}</p> : null}
        {enrollmentError ? <p className="error">{enrollmentError}</p> : null}
        {fingerprintEnrollmentAvailable ? (
          <FingerprintEnrollmentTable enrollments={enrollments} onDelete={deleteEnrollment} onRemap={startRemapEnrollment} busy={enrolling} />
        ) : null}
      </section>
      <Table title="Roster" error={error} rows={data?.members ?? []} columns={["memberId", "firstName", "lastName", "email", "active"]} />
    </>
  );
}

function RosterEmailTable({
  members,
  drafts,
  savingFor,
  onDraftChange,
  onSave
}: {
  members: MemberRow[];
  drafts: Record<string, string>;
  savingFor?: string;
  onDraftChange: (memberId: string, email: string) => void;
  onSave: (member: MemberRow) => void;
}) {
  if (members.length === 0) return <p className="empty-state">No roster members yet.</p>;
  return (
    <div className="data-table-wrap">
      <table className="data-table roster-email-table">
        <thead>
          <tr>
            <th>Member ID</th>
            <th>First Name</th>
            <th>Last Name</th>
            <th>Email</th>
            <th>Active</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.memberId}>
              <td>{member.memberId}</td>
              <td>{member.firstName}</td>
              <td>{member.lastName}</td>
              <td>
                <input
                  type="email"
                  value={drafts[member.memberId] ?? member.email ?? ""}
                  onChange={(event) => onDraftChange(member.memberId, event.target.value)}
                  placeholder="name@example.org"
                />
              </td>
              <td>{member.active ? "Yes" : "No"}</td>
              <td>
                <button type="button" disabled={savingFor === member.memberId} onClick={() => onSave(member)}>
                  {savingFor === member.memberId ? "Saving..." : "Save"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
  onDelete,
  onRemap,
  busy
}: {
  enrollments: FingerprintEnrollment[];
  onDelete: (slot: number) => void;
  onRemap: (enrollment: FingerprintEnrollment) => void;
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
                {!enrollment.active ? <span className="muted"> inactive</span> : null}
              </td>
              <td>{enrollment.fingerLabel ?? ""}</td>
              <td>{formatDateTime(enrollment.enrolledAt)}</td>
              <td>
                <div className="mapping-actions">
                  <button type="button" disabled={busy} onClick={() => onRemap(enrollment)}>Remap</button>
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

function Meetings({ session }: { session: DashboardSession }) {
  const { data, error, reload } = useApi<{ meetings: ScheduledMeeting[] }>("/admin/meetings", session);
  const { data: meetingSummary, error: meetingSummaryError, reload: reloadMeetingSummary } = useApi<{ meetings: MeetingSummaryReportRow[] }>("/admin/reports/meetings", session);
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
  const meetings = data?.meetings ?? [];
  const selectedMeetings = meetings.filter((meeting) => selectedMeetingIds.includes(meeting.id));
  const allMeetingsSelected = meetings.length > 0 && selectedMeetingIds.length === meetings.length;
  const meetingSummaryRows = meetingSummary?.meetings ?? [];
  const meetingSummaryByDate = new Map(meetingSummaryRows.map((meeting) => [meeting.meetingDate, meeting]));
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
  const presentRows = (selectedPresence?.rows ?? []).filter((row) => row.status === "signed_in" || row.status === "signed_out");
  const existingMeetingDates = new Set(meetings.map((meeting) => meeting.meetingDate));
  const recurringPreview = formState.repeats ? previewRecurringMeetings(formState, existingMeetingDates) : undefined;

  useEffect(() => {
    if (meetings.length === 0) return;
    const today = localDateInputValue();
    const todayMonth = today.slice(0, 7);
    const selectedMeetingExists = meetings.some((meeting) => meeting.meetingDate === selectedMeetingDate);
    const defaultMeeting =
      meetings.find((meeting) => meeting.meetingDate === today)
      ?? meetings.find((meeting) => meeting.meetingDate.startsWith(todayMonth))
      ?? meetings[0];
    if (!calendarMonth && defaultMeeting) setCalendarMonth(defaultMeeting.meetingDate.slice(0, 7));
    if ((!selectedMeetingDate || !selectedMeetingExists) && defaultMeeting) setSelectedMeetingDate(defaultMeeting.meetingDate);
  }, [calendarMonth, meetings, selectedMeetingDate]);

  useEffect(() => {
    setSelectedMeetingIds((ids) => ids.filter((id) => meetings.some((meeting) => meeting.id === id)));
  }, [meetings]);

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
        {message ? <p className={`notice ${message.kind}`}>{message.text}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        {meetingSummaryError ? <p className="error">{meetingSummaryError}</p> : null}

        {meetingViewTab === "calendar" ? (
          <>
            {meetings.length > 0 ? (
              <MeetingCalendar
                month={calendarMonth || meetings[0]?.meetingDate.slice(0, 7) || localDateInputValue().slice(0, 7)}
                meetings={meetings}
                summariesByDate={meetingSummaryByDate}
                selectedMeetingDate={selectedMeetingDate}
                onMonthChange={setCalendarMonth}
                onSelectMeeting={setSelectedMeetingDate}
              />
            ) : <p className="empty-state">No scheduled meetings yet.</p>}
            <MeetingDetails
              meeting={selectedMeeting}
              summary={selectedMeetingSummary}
              presence={selectedPresence}
              absences={selectedAbsences}
              presentRows={presentRows}
              presenceError={selectedPresenceError}
              absencesError={selectedAbsencesError}
              saving={saving}
              onEdit={startEditing}
              onDelete={deleteMeeting}
            />
          </>
        ) : null}

        {meetingViewTab === "all" ? (
          meetings.length > 0 ? (
            <>
              <div className="bulk-actions">
                <span>{pluralize(selectedMeetingIds.length, "meeting")} selected</span>
                <button type="button" disabled={saving || selectedMeetingIds.length === 0} onClick={() => setBulkEditing((value) => !value)}>
                  {bulkEditing ? "Hide bulk edit" : "Bulk edit"}
                </button>
                <button type="button" disabled={saving || selectedMeetingIds.length === 0} onClick={bulkDeleteMeetings}>Bulk delete</button>
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
                      {["date", "title", "attendance", "present", "absent", "time", "notes", "actions"].map((column) => <th key={column}>{column}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {meetings.map((meeting) => {
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
  summariesByDate,
  selectedMeetingDate,
  onMonthChange,
  onSelectMeeting
}: {
  month: string;
  meetings: ScheduledMeeting[];
  summariesByDate: Map<string, MeetingSummaryReportRow>;
  selectedMeetingDate: string;
  onMonthChange: (month: string) => void;
  onSelectMeeting: (meetingDate: string) => void;
}) {
  const days = calendarDaysForMonth(month);
  const meetingsByDate = groupMeetingsByDate(meetings);

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
                      <small>{summary ? `${summary.presentCount} present` : "loading"}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MeetingDetails({
  meeting,
  summary,
  presence,
  absences,
  presentRows,
  presenceError,
  absencesError,
  saving,
  onEdit,
  onDelete
}: {
  meeting?: ScheduledMeeting;
  summary?: MeetingSummaryReportRow;
  presence?: PresenceReport;
  absences?: MeetingAbsenceReport;
  presentRows: Array<Record<string, unknown>>;
  presenceError?: string;
  absencesError?: string;
  saving: boolean;
  onEdit: (meeting: ScheduledMeeting) => void;
  onDelete: (meeting: ScheduledMeeting) => void;
}) {
  if (!meeting) {
    return <p className="empty-state">Select a meeting on the calendar to see attendance details.</p>;
  }
  const meetingPresentRows = presentRows.map((row) => ({
    ...row,
    checkInAt: typeof row.checkInAt === "string" ? formatTime(row.checkInAt) : row.checkInAt,
    checkOutAt: typeof row.checkOutAt === "string" ? formatTime(row.checkOutAt) : row.checkOutAt
  }));
  const absentRows = absences?.rows ?? [];
  const presentStateText = presence
    ? meetingPresentRows.length === 0
      ? "No members have checked in for this meeting yet."
      : `${pluralize(meetingPresentRows.length, "member")} checked in for this meeting.`
    : "Loading present members...";
  const absentStateText = meeting.required
    ? absences
      ? absentRows.length === 0
        ? "No active members are absent for this required meeting."
        : `${pluralize(absentRows.length, "active member")} absent from this required meeting.`
      : "Loading absent members..."
    : "Optional meetings do not create missed-attendance records.";

  return (
    <div className="meeting-details">
      <div className="section-heading">
        <div>
          <h3>{meeting.title}</h3>
          <p className="report-context">{meeting.meetingDate}{meetingTimeRange(meeting) ? `, ${meetingTimeRange(meeting)}` : ""}</p>
        </div>
        <div className="meeting-detail-actions">
          <MeetingRequirementBadge required={meeting.required} />
          <button type="button" onClick={() => onEdit(meeting)} disabled={saving}>Edit</button>
          <button type="button" onClick={() => onDelete(meeting)} disabled={saving}>Delete</button>
        </div>
      </div>
      <p className="report-context">
        {meeting.required
          ? "Required meetings count active members who were not present as absent."
          : "Optional meetings show who attended, but do not create missed-meeting counts."}
      </p>
      <div className="grid compact-grid">
        <Metric label="Present" value={summary?.presentCount ?? (presence ? presentRows.length : "...")} />
        <Metric label="Signed In" value={presence?.counts.signedIn ?? 0} />
        <Metric label="Open Check-Ins" value={summary?.openCheckIns ?? 0} />
        <Metric label="Absent" value={meeting.required ? summary?.absentCount ?? absences?.absentCount ?? "..." : "N/A"} />
      </div>
      {presenceError ? <p className="error">{presenceError}</p> : null}
      {absencesError ? <p className="error">{absencesError}</p> : null}
      <div className="meeting-detail-grid">
        <div>
          <div className="meeting-detail-subheading">
            <h3>Present Members</h3>
            <span>{presence ? meetingPresentRows.length : "..."}</span>
          </div>
          <p className="empty-state">{presentStateText}</p>
          <DataTable rows={meetingPresentRows} columns={["memberId", "firstName", "lastName", "checkInAt", "checkOutAt"]} density="compact" />
        </div>
        <div>
          <div className="meeting-detail-subheading">
            <h3>{meeting.required ? "Absent Members" : "Optional Attendance"}</h3>
            <span>{meeting.required ? absences?.absentCount ?? "..." : "N/A"}</span>
          </div>
          <p className="empty-state">{absentStateText}</p>
          {meeting.required ? (
            <DataTable rows={absentRows} columns={["memberId", "firstName", "lastName"]} density="compact" />
          ) : (
            <p className="notice info">Track attendance here as present-only participation; use required meetings for absence accountability.</p>
          )}
        </div>
      </div>
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

function Events({ session }: { session: DashboardSession }) {
  const { data, error } = useApi<{ events: Array<Record<string, unknown>> }>("/admin/events", session);
  return <Table title="Recent scan events" error={error} rows={data?.events ?? []} columns={["memberId", "kioskId", "occurredAt", "status", "rejectionReason"]} />;
}

function Reports({ session }: { session: DashboardSession }) {
  const { data: members } = useApi<{ members: MemberRow[] }>("/admin/members", session);
  const { data: meetingData } = useApi<{ meetings: ScheduledMeeting[] }>("/admin/meetings", session);
  const [reportStartDate, setReportStartDate] = useState("");
  const [reportEndDate, setReportEndDate] = useState("");
  const [presenceDate, setPresenceDate] = useState(localDateInputValue());
  const [selectedMeetingDate, setSelectedMeetingDate] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const reportQuery = reportRangeQuery(reportStartDate, reportEndDate);
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
        </div>
        <p className="report-context">Required meetings count missed active members. Optional meetings show attendance without missed counts. Scheduled rows marked zero scans had no check-ins or manual corrections.</p>
        <div className="grid compact-grid">
          <Metric label="Required Meetings" value={meetingRows.filter((meeting) => meeting.required).length} />
          <Metric label="Zero-Scan Required" value={meetingRows.filter((meeting) => meeting.required && meeting.zeroScan).length} />
          <Metric label="Open Check-Ins" value={meetingRows.reduce((sum, meeting) => sum + meeting.openCheckIns, 0)} />
        </div>
        <DataTable
          rows={meetingRows.map((meeting) => ({
            date: meeting.meetingDate,
            title: meeting.title ?? "Unscheduled attendance",
            attendance: meeting.required ? "required" : "optional",
            time: meetingTimeRange({ startsAt: meeting.startsAt, endsAt: meeting.endsAt }),
            scheduled: meeting.scheduled ? "yes" : "attendance-only",
            present: meeting.presentCount,
            absent: meeting.required ? meeting.absentCount : "",
            openCheckIns: meeting.openCheckIns,
            note: meeting.zeroScan ? "zero scans" : ""
          }))}
          columns={["date", "title", "attendance", "time", "scheduled", "present", "absent", "openCheckIns", "note"]}
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
        </div>
        <p className="report-context">
          {absences
            ? absences.required
              ? `${absences.absentCount} active ${absences.absentCount === 1 ? "member missed" : "members missed"} ${absences.title ?? absences.meetingDate}.`
              : "Optional meetings do not create missed-meeting rows."
            : "Pick a meeting to see the active members who missed it."}
        </p>
        {absencesError ? <p className="error">{absencesError}</p> : null}
        <DataTable rows={absences?.rows ?? []} columns={["memberId", "firstName", "lastName"]} />
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
              <Metric label="Required Present" value={memberReport.presentMeetings} />
              <Metric label="Required Missed" value={memberReport.missedMeetings} />
            </div>
            <h3>{memberReport.firstName} {memberReport.lastName}</h3>
            <p className="report-context">Optional meetings are excluded from this attendance rate and missed-meeting count. The range filter above applies here too.</p>
            <DataTable
              rows={[{
                requiredMeetings: memberReport.totalMeetings,
                lastSeenAt: memberReport.lastSeenAt ?? "",
                presentDates: memberReport.presentDates.join(", "),
                absentDates: memberReport.absentDates.join(", "),
                openSessionDates: memberReport.openSessionDates.join(", ")
              }]}
              columns={["requiredMeetings", "lastSeenAt", "presentDates", "absentDates", "openSessionDates"]}
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
            lastSeenAt: member.lastSeenAt ?? "",
            openCheckIns: member.openSessionWarning ? member.openSessionDates.join(", ") : ""
          }))}
          columns={["memberId", "firstName", "lastName", "requiredMeetings", "present", "missed", "attendance", "lastSeenAt", "openCheckIns"]}
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
      <Table title="Attendance session audit" error={sessionError} rows={sessionRows?.sessions ?? []} columns={["meeting_date", "meeting_title", "required", "has_attendance", "member_id", "check_in_at", "check_out_at", "status"]} />
    </>
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

function Table({ title, rows, columns, error }: { title: string; rows: Array<Record<string, unknown>>; columns: string[]; error?: string }) {
  return (
    <section>
      <h2>{title}</h2>
      {error ? <p className="error">{error}</p> : null}
      <DataTable rows={rows} columns={columns} />
    </section>
  );
}

function DataTable({ rows, columns, density = "regular" }: { rows: Array<Record<string, unknown>>; columns: string[]; density?: "regular" | "compact" }) {
  return (
    <div className="data-table-wrap">
      <table className={`data-table ${density === "compact" ? "compact-data-table" : ""}`}>
        <thead><tr>{columns.map((column) => <th key={column}>{columnLabel(column)}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>{columns.map((column) => <td key={column}>{String(row[column] ?? "")}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function useApi<T>(path: string, session: DashboardSession) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    setError(undefined);
    apiGet<T>(path, session).then(setData, (err) => setError(err instanceof Error ? err.message : String(err)));
  }, [path, session, nonce]);
  return { data, error, reload: () => setNonce((value) => value + 1) };
}

function useOptionalApi<T>(path: string | undefined, session: DashboardSession) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!path) {
      setData(undefined);
      setError(undefined);
      return;
    }
    setError(undefined);
    apiGet<T>(path, session).then(setData, (err) => setError(err instanceof Error ? err.message : String(err)));
  }, [path, session, nonce]);
  return { data, error, reload: () => setNonce((value) => value + 1) };
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

  return dataRows.map((row, index) => {
    const memberId = row[idIndex]?.trim();
    const firstName = row[firstIndex]?.trim();
    const lastName = row[lastIndex]?.trim();
    const email = emailIndex >= 0 ? row[emailIndex]?.trim() : undefined;
    if (!memberId || !firstName || !lastName) throw new Error(`Roster row ${index + 1} must include member ID, first name, and last name`);
    return email ? { memberId, firstName, lastName, email } : { memberId, firstName, lastName };
  });
}

function localDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localTimeInputValue(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
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
  rows: Array<Record<string, unknown>>;
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
  lastSeenAt?: string;
  presentDates: string[];
  absentDates: string[];
  openSessionDates: string[];
}

interface RosterAttendanceSummaryRow {
  memberId: string;
  firstName: string;
  lastName: string;
  requiredMeetings: number;
  presentMeetings: number;
  missedMeetings: number;
  attendanceRate: number | null;
  lastSeenAt?: string;
  openSessionDates: string[];
  openSessionWarning: boolean;
}

function reportRangeQuery(startDate: string, endDate: string) {
  const params = new URLSearchParams();
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
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

function nextAvailableFingerprintSlot(enrollments: FingerprintEnrollment[], pendingOccupiedSlot?: number) {
  const occupiedSlots = new Set(enrollments.map((enrollment) => enrollment.slot));
  if (pendingOccupiedSlot) occupiedSlots.add(pendingOccupiedSlot);
  for (let slot = 1; slot <= 200; slot += 1) {
    if (!occupiedSlots.has(slot)) return slot;
  }
  return 200;
}

function fingerprintEnrollmentName(enrollment: FingerprintEnrollment) {
  const name = [enrollment.firstName, enrollment.lastName].filter(Boolean).join(" ");
  return name ? `${enrollment.memberId} - ${name}` : enrollment.memberId;
}

function commandTimestamp(command: KioskCommandRow) {
  if (command.completedAt) return `Completed ${formatDateTime(command.completedAt)}`;
  if (command.claimedAt) return `Started ${formatDateTime(command.claimedAt)}`;
  return `Queued ${formatDateTime(command.requestedAt)}`;
}

function formatDateTime(value?: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatTime(value?: string) {
  if (!value) return "";
  const normalizedValue = /^\d{4}-\d{2}-\d{2}\+/.test(value) ? value.replace("+", "T") : value;
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(normalizedValue));
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
    checkInAt: "Time In",
    checkOutAt: "Time Out",
    check_in_at: "Time In",
    check_out_at: "Time Out",
    date: "Date",
    email: "Email",
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
