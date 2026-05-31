export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? defaultApiBaseUrl();
const googleAuthEnabled = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

export interface DashboardSession {
  email: string;
  idToken?: string;
}

export async function apiGet<T>(path: string, session: DashboardSession): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: adminHeaders(session)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown, session: DashboardSession): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...adminHeaders(session)
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await response.text());
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function adminHeaders(session: DashboardSession): Record<string, string> {
  if (session.idToken) return { authorization: `Bearer ${session.idToken}` };
  if (googleAuthEnabled) return {};
  return { "x-admin-email": session.email };
}

function defaultApiBaseUrl() {
  if (typeof window === "undefined") return "http://localhost:8787";
  return `${window.location.protocol}//${window.location.hostname}:8787`;
}
