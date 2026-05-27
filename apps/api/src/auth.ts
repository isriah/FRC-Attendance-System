import type { Env } from "./env";

export interface AdminPrincipal {
  email: string;
  role: "mentor" | "admin";
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function requireKiosk(request: Request, env: Env): Promise<string> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("Missing kiosk bearer token"), { status: 401 });
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    "SELECT kiosk_id FROM kiosks WHERE token_hash = ? AND active = 1"
  ).bind(tokenHash).first<{ kiosk_id: string }>();
  if (!row) throw Object.assign(new Error("Invalid kiosk token"), { status: 401 });
  await env.DB.prepare("UPDATE kiosks SET last_seen_at = ? WHERE kiosk_id = ?").bind(new Date().toISOString(), row.kiosk_id).run();
  return row.kiosk_id;
}

export async function requireAdmin(request: Request, env: Env): Promise<AdminPrincipal> {
  const email = await resolveAdminEmail(request, env);
  if (!email) throw Object.assign(new Error("Missing admin identity"), { status: 401 });

  const allowedEmails = env.GOOGLE_ALLOWED_EMAILS.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  const allowedDomain = env.GOOGLE_ALLOWED_DOMAIN.trim().toLowerCase();
  const emailAllowed = allowedEmails.includes(email) || (allowedDomain.length > 0 && email.endsWith(`@${allowedDomain}`));
  if (!emailAllowed) throw Object.assign(new Error("Admin email is not allowlisted"), { status: 403 });

  const existing = await env.DB.prepare("SELECT role, active FROM admin_users WHERE email = ?").bind(email).first<{ role: "mentor" | "admin"; active: number }>();
  if (existing && !existing.active) throw Object.assign(new Error("Admin user is disabled"), { status: 403 });

  const role = existing?.role ?? "mentor";
  await env.DB.prepare(
    "INSERT INTO admin_users (email, role, active, last_login_at) VALUES (?, ?, 1, ?) ON CONFLICT(email) DO UPDATE SET last_login_at = excluded.last_login_at"
  ).bind(email, role, new Date().toISOString()).run();
  return { email, role };
}

async function resolveAdminEmail(request: Request, env: Env): Promise<string | undefined> {
  const clientId = env.GOOGLE_CLIENT_ID.trim();
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (clientId && bearer) return verifyGoogleIdToken(bearer, clientId);

  if (!clientId) return request.headers.get("x-admin-email")?.trim().toLowerCase();
  return undefined;
}

async function verifyGoogleIdToken(token: string, clientId: string): Promise<string> {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw Object.assign(new Error("Invalid Google ID token"), { status: 401 });
  }

  const header = JSON.parse(base64UrlDecodeToString(encodedHeader)) as { kid?: string; alg?: string };
  const payload = JSON.parse(base64UrlDecodeToString(encodedPayload)) as {
    aud?: string;
    iss?: string;
    exp?: number;
    email?: string;
    email_verified?: boolean;
  };

  if (header.alg !== "RS256" || !header.kid) throw Object.assign(new Error("Unsupported Google token header"), { status: 401 });
  if (payload.aud !== clientId) throw Object.assign(new Error("Google token audience mismatch"), { status: 401 });
  if (payload.iss !== "https://accounts.google.com" && payload.iss !== "accounts.google.com") {
    throw Object.assign(new Error("Google token issuer mismatch"), { status: 401 });
  }
  if (!payload.exp || payload.exp * 1000 <= Date.now()) throw Object.assign(new Error("Google token expired"), { status: 401 });
  if (!payload.email || payload.email_verified !== true) throw Object.assign(new Error("Google email is not verified"), { status: 401 });

  const jwks = await fetch("https://www.googleapis.com/oauth2/v3/certs").then((response) => response.json()) as {
    keys: Array<JsonWebKey & { kid: string; alg: string }>;
  };
  const jwk = jwks.keys.find((key) => key.kid === header.kid);
  if (!jwk) throw Object.assign(new Error("Google signing key not found"), { status: 401 });

  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlDecode(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
  );
  if (!valid) throw Object.assign(new Error("Google token signature is invalid"), { status: 401 });
  return payload.email.toLowerCase();
}

function base64UrlDecodeToString(value: string): string {
  return new TextDecoder().decode(base64UrlDecode(value));
}

function base64UrlDecode(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
