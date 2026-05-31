import { FormEvent, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { apiBaseUrl, apiGet, apiPost, type DashboardSession } from "./api";
import "./styles.css";

type Tab = "overview" | "roster" | "kiosks" | "events" | "reports" | "export";
type KioskCommandAction = "restart_display" | "restart_services" | "reboot_system";
type KioskCommandStatus = "pending" | "running" | "completed" | "failed";
type KioskHealthStatus = "online" | "degraded" | "offline" | "unknown";

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

interface FingerprintEnrollment {
  memberId: string;
  firstName?: string;
  lastName?: string;
  active: number;
  slot: number;
  fingerLabel?: string;
  enrolledAt: string;
}

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const googleAuthEnabled = Boolean(googleClientId);
const fingerprintEnrollmentAvailable = !apiBaseUrl.includes("workers.dev");

function App() {
  const [session, setSession] = useState<DashboardSession>(readStoredSession);
  const [tab, setTab] = useState<Tab>("overview");

  if (!session.email || (googleAuthEnabled && !session.idToken)) {
    return <Login onLocalLogin={(email) => {
      localStorage.setItem("adminEmail", email);
      setSession({ email });
    }} onGoogleLogin={(googleSession) => {
      setSession(googleSession);
    }} />;
  }

  return (
    <main className="dashboard">
      <aside>
        <h1>Attendance Admin</h1>
        {(["overview", "roster", "kiosks", "events", "reports", "export"] as Tab[]).map((item) => (
          <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
            {item}
          </button>
        ))}
      </aside>
      <section className="content">
        <header>
          <span>{session.email}</span>
          <button onClick={() => {
            localStorage.removeItem("adminEmail");
            sessionStorage.removeItem("googleIdToken");
            setSession({ email: "" });
          }}>Sign out</button>
        </header>
        {tab === "overview" && <Overview session={session} />}
        {tab === "roster" && <Roster session={session} />}
        {tab === "kiosks" && <Kiosks session={session} />}
        {tab === "events" && <Events session={session} />}
        {tab === "reports" && <Reports session={session} />}
        {tab === "export" && <LegacyExport session={session} />}
      </section>
    </main>
  );
}

function Login({ onLocalLogin, onGoogleLogin }: { onLocalLogin: (email: string) => void; onGoogleLogin: (session: DashboardSession) => void }) {
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
  const { data, error, reload } = useApi<{ students: Array<{ student_id: string; first_name: string; last_name: string; active: number }> }>("/admin/students", session);
  const { data: enrollmentData, error: enrollmentError, reload: reloadEnrollments } = useOptionalApi<{ enrollments: FingerprintEnrollment[] }>(
    fingerprintEnrollmentAvailable ? "/admin/fingerprint/enrollments" : undefined,
    session
  );
  const [importText, setImportText] = useState("memberId,firstName,lastName\n100001,Bench,Student");
  const [importMessage, setImportMessage] = useState<string>();
  const [enrollMemberId, setEnrollMemberId] = useState("");
  const [enrollSlot, setEnrollSlot] = useState("");
  const [enrollFingerLabel, setEnrollFingerLabel] = useState("right-index");
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [enrollMessage, setEnrollMessage] = useState<{ kind: "info" | "success" | "error"; text: string }>();
  const [enrolling, setEnrolling] = useState(false);
  const activeStudents = data?.students.filter((student) => student.active) ?? [];
  const enrollments = enrollmentData?.enrollments ?? [];
  const nextOpenSlot = nextAvailableFingerprintSlot(enrollments);
  const selectedSlot = Number(enrollSlot);
  const occupiedEnrollment = enrollments.find((enrollment) => enrollment.slot === selectedSlot);
  const selectedEnrollmentMember = activeStudents.find((student) => student.student_id === enrollMemberId);
  const overwriteBlocked = Boolean(occupiedEnrollment && !confirmOverwrite);

  useEffect(() => {
    if (!fingerprintEnrollmentAvailable || enrollSlot) return;
    setEnrollSlot(String(nextAvailableFingerprintSlot(enrollments)));
  }, [enrollSlot, enrollments]);

  useEffect(() => {
    setConfirmOverwrite(false);
  }, [enrollSlot, enrollMemberId]);

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
      const memberName = selectedEnrollmentMember ? `${selectedEnrollmentMember.first_name} ${selectedEnrollmentMember.last_name}` : enrollMemberId;
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
            {importMessage ? <span>{importMessage}</span> : null}
          </div>
        </form>
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
            {activeStudents.map((student) => (
              <option key={student.student_id} value={student.student_id}>
                {student.student_id} - {student.first_name} {student.last_name}
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
          <FingerprintEnrollmentTable enrollments={enrollments} onDelete={deleteEnrollment} deleting={enrolling} />
        ) : null}
      </section>
      <Table title="Roster" error={error} rows={data?.students ?? []} columns={["student_id", "first_name", "last_name", "active"]} />
    </>
  );
}

function FingerprintEnrollmentTable({ enrollments, onDelete, deleting }: { enrollments: FingerprintEnrollment[]; onDelete: (slot: number) => void; deleting: boolean }) {
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
            {["slot", "member", "finger", "enrolled", "actions"].map((column) => <th key={column}>{column}</th>)}
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
              <td><button type="button" disabled={deleting} onClick={() => onDelete(enrollment.slot)}>Remove mapping</button></td>
            </tr>
          ))}
        </tbody>
      </table>
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
  return <Table title="Recent scan events" error={error} rows={data?.events ?? []} columns={["student_id", "kiosk_id", "occurred_at", "status", "rejection_reason"]} />;
}

function Reports({ session }: { session: DashboardSession }) {
  const { data, error, reload } = useApi<{ sessions: Array<Record<string, unknown>> }>("/admin/reports/sessions", session);
  const { data: students } = useApi<{ students: Array<{ student_id: string; first_name: string; last_name: string; active: number }> }>("/admin/students", session);
  const [presenceDate, setPresenceDate] = useState(localDateInputValue());
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const { data: presence, error: presenceError, reload: reloadPresence } = useApi<PresenceReport>(`/admin/reports/presence?date=${presenceDate}`, session);
  const { data: memberReport, error: memberError, reload: reloadMember } = useOptionalApi<MemberAttendanceReport>(
    selectedMemberId ? `/admin/reports/member?studentId=${encodeURIComponent(selectedMemberId)}` : undefined,
    session
  );
  const activeStudents = students?.students.filter((student) => student.active) ?? [];

  return (
    <>
      <section>
        <h2>Daily Presence</h2>
        <div className="toolbar wrap">
          <input value={presenceDate} onChange={(event) => setPresenceDate(event.target.value)} type="date" />
          <button onClick={reloadPresence}>Refresh</button>
        </div>
        {presenceError ? <p className="error">{presenceError}</p> : null}
        <div className="grid compact-grid">
          <Metric label="Signed In" value={presence?.counts.signedIn ?? 0} />
          <Metric label="Signed Out" value={presence?.counts.signedOut ?? 0} />
          <Metric label="Not Seen" value={presence?.counts.notSeen ?? 0} />
        </div>
        <DataTable
          rows={presence?.rows ?? []}
          columns={["studentId", "firstName", "lastName", "status", "checkInAt", "checkOutAt"]}
        />
      </section>

      <section>
        <h2>Member Attendance</h2>
        <div className="toolbar wrap">
          <select value={selectedMemberId} onChange={(event) => setSelectedMemberId(event.target.value)}>
            <option value="">Select member</option>
            {activeStudents.map((student) => (
              <option key={student.student_id} value={student.student_id}>
                {student.student_id} - {student.first_name} {student.last_name}
              </option>
            ))}
          </select>
          <button disabled={!selectedMemberId} onClick={reloadMember}>Refresh</button>
        </div>
        {memberError ? <p className="error">{memberError}</p> : null}
        {memberReport ? (
          <>
            <div className="grid compact-grid">
              <Metric label="Attendance" value={formatPercent(memberReport.attendanceRate)} />
              <Metric label="Present" value={memberReport.presentMeetings} />
              <Metric label="Missed" value={memberReport.missedMeetings} />
            </div>
            <h3>{memberReport.firstName} {memberReport.lastName}</h3>
            <DataTable
              rows={[{
                totalMeetings: memberReport.totalMeetings,
                presentDates: memberReport.presentDates.join(", "),
                absentDates: memberReport.absentDates.join(", "),
                openSessionDates: memberReport.openSessionDates.join(", ")
              }]}
              columns={["totalMeetings", "presentDates", "absentDates", "openSessionDates"]}
            />
          </>
        ) : null}
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
        reload();
      }}>
        <input name="studentId" placeholder="Student ID" required />
        <input name="occurredAt" type="datetime-local" required />
        <select name="action" defaultValue="check_in">
          <option value="check_in">Check in</option>
          <option value="check_out">Check out</option>
        </select>
        <input name="reason" placeholder="Correction reason" required />
        <button>Add manual event</button>
      </form>
      <Table title="Attendance sessions" error={error} rows={data?.sessions ?? []} columns={["student_id", "meeting_date", "check_in_at", "check_out_at", "status"]} />
    </>
  );
}

function LegacyExport({ session }: { session: DashboardSession }) {
  const { data, error } = useApi<Record<string, unknown>>("/admin/export/legacy-sheets", session);
  return (
    <section>
      <h2>Legacy Google Sheets Export</h2>
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

function DataTable({ rows, columns }: { rows: Array<Record<string, unknown>>; columns: string[] }) {
  return (
    <table>
      <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index}>{columns.map((column) => <td key={column}>{String(row[column] ?? "")}</td>)}</tr>
        ))}
      </tbody>
    </table>
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

  return dataRows.map((row, index) => {
    const memberId = row[idIndex]?.trim();
    const firstName = row[firstIndex]?.trim();
    const lastName = row[lastIndex]?.trim();
    if (!memberId || !firstName || !lastName) throw new Error(`Roster row ${index + 1} must include member ID, first name, and last name`);
    return { memberId, firstName, lastName };
  });
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

interface MemberAttendanceReport {
  studentId: string;
  firstName: string;
  lastName: string;
  totalMeetings: number;
  presentMeetings: number;
  missedMeetings: number;
  attendanceRate: number | null;
  presentDates: string[];
  absentDates: string[];
  openSessionDates: string[];
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

function decodeGooglePayload(encodedPayload: string): { email: string } {
  const payload = JSON.parse(atob(encodedPayload.replace(/-/g, "+").replace(/_/g, "/"))) as { email?: string };
  if (!payload.email) throw new Error("Google token did not include an email");
  return { email: payload.email };
}

createRoot(document.getElementById("root")!).render(<App />);
