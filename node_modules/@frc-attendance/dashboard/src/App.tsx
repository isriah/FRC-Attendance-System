import { FormEvent, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { apiGet, apiPost, type DashboardSession } from "./api";
import "./styles.css";

type Tab = "overview" | "roster" | "kiosks" | "events" | "reports" | "export";

function App() {
  const [session, setSession] = useState<DashboardSession>(() => ({
    email: localStorage.getItem("adminEmail") ?? "",
    idToken: sessionStorage.getItem("googleIdToken") ?? undefined
  }));
  const [tab, setTab] = useState<Tab>("overview");

  if (!session.email) {
    return <Login onLogin={(email) => {
      localStorage.setItem("adminEmail", email);
      setSession({ email });
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

function Login({ onLogin }: { onLogin: (email: string) => void }) {
  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) return;
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
        client_id: clientId,
        callback: (response) => {
          const encodedPayload = response.credential.split(".")[1];
          if (!encodedPayload) return;
          const payload = JSON.parse(atob(encodedPayload.replace(/-/g, "+").replace(/_/g, "/")));
          localStorage.setItem("adminEmail", payload.email);
          sessionStorage.setItem("googleIdToken", response.credential);
          window.location.reload();
        }
      });
      google.accounts.id.renderButton(target, { theme: "outline", size: "large", width: 320 });
    };
    document.head.appendChild(script);
    return () => script.remove();
  }, []);

  return (
    <main className="login">
      <form onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onLogin(String(form.get("email")));
      }}>
        <h1>Attendance Admin</h1>
        <p>Use Google sign-in in production. Local development can use an allowlisted mentor email when no Google client ID is configured.</p>
        <div id="google-sign-in" />
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
    <div className="grid">
      <Metric label="Kiosks" value={kiosks?.kiosks.length ?? 0} />
      <Metric label="Recent Events" value={events?.events.length ?? 0} />
      <Metric label="System" value="Online" />
    </div>
  );
}

function Roster({ session }: { session: DashboardSession }) {
  const { data, error } = useApi<{ students: Array<{ student_id: string; first_name: string; last_name: string; active: number }> }>("/admin/students", session);
  return <Table title="Roster" error={error} rows={data?.students ?? []} columns={["student_id", "first_name", "last_name", "active"]} />;
}

function Kiosks({ session }: { session: DashboardSession }) {
  const { data, error, reload } = useApi<{ kiosks: Array<Record<string, unknown>> }>("/admin/kiosks", session);
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
      <Table title="Kiosks" error={error} rows={data?.kiosks ?? []} columns={["kiosk_id", "name", "location", "active", "last_seen_at"]} />
    </>
  );
}

function Events({ session }: { session: DashboardSession }) {
  const { data, error } = useApi<{ events: Array<Record<string, unknown>> }>("/admin/events", session);
  return <Table title="Recent scan events" error={error} rows={data?.events ?? []} columns={["student_id", "kiosk_id", "occurred_at", "status", "rejection_reason"]} />;
}

function Reports({ session }: { session: DashboardSession }) {
  const { data, error, reload } = useApi<{ sessions: Array<Record<string, unknown>> }>("/admin/reports/sessions", session);
  return (
    <>
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
      <table>
        <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>{columns.map((column) => <td key={column}>{String(row[column] ?? "")}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function useApi<T>(path: string, session: DashboardSession) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    apiGet<T>(path, session).then(setData, (err) => setError(err instanceof Error ? err.message : String(err)));
  }, [path, session, nonce]);
  return { data, error, reload: () => setNonce((value) => value + 1) };
}

createRoot(document.getElementById("root")!).render(<App />);
