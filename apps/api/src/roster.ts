import type { Env } from "./env";

export interface RosterMemberInput {
  memberId: string;
  firstName: string;
  lastName: string;
  email?: string;
}

export async function syncRoster(env: Env, members: RosterMemberInput[]) {
  const normalizedMembers = normalizeRosterMembers(members);
  const startedAt = new Date().toISOString();
  const syncId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO sync_log (id, kind, status, started_at) VALUES (?, 'roster', 'running', ?)").bind(syncId, startedAt).run();

  const seen = new Set<string>();
  const statements: D1PreparedStatement[] = [];
  const syncedAt = new Date().toISOString();

  for (const member of normalizedMembers) {
    seen.add(member.memberId);
    if (member.email) await requireUniqueStudentEmail(env, member.email, member.memberId);
    const rosterHash = await hashRosterRow(member);
    statements.push(
      env.DB.prepare(
        "INSERT INTO students (student_id, first_name, last_name, email, active, roster_hash, roster_synced_at) VALUES (?, ?, ?, ?, 1, ?, ?) ON CONFLICT(student_id) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name, email = COALESCE(excluded.email, students.email), active = 1, roster_hash = excluded.roster_hash, roster_synced_at = excluded.roster_synced_at"
      ).bind(member.memberId, member.firstName, member.lastName, member.email ?? null, rosterHash, syncedAt)
    );
  }

  if (statements.length > 0) await env.DB.batch(statements);
  if (seen.size > 0) {
    const placeholders = [...seen].map(() => "?").join(",");
    await env.DB.prepare(`UPDATE students SET active = 0, roster_synced_at = ? WHERE student_id NOT IN (${placeholders})`).bind(syncedAt, ...seen).run();
  }

  await env.DB.prepare("UPDATE sync_log SET status = 'success', message = ?, finished_at = ? WHERE id = ?")
    .bind(`Synced ${normalizedMembers.length} roster members`, new Date().toISOString(), syncId)
    .run();

  return { synced: normalizedMembers.length, deactivatedMissingStudents: seen.size > 0 };
}

export async function listActiveRoster(env: Env) {
  const rows = await env.DB.prepare(
    "SELECT student_id, first_name, last_name, roster_synced_at FROM students WHERE active = 1 ORDER BY last_name, first_name"
  ).all<{ student_id: string; first_name: string; last_name: string; roster_synced_at: string | null }>();

  return {
    members: rows.results.map((row) => ({
      memberId: row.student_id,
      firstName: row.first_name,
      lastName: row.last_name
    })),
    rosterSyncedAt: rows.results.reduce<string | null>((latest, row) => {
      if (!row.roster_synced_at) return latest;
      return !latest || row.roster_synced_at > latest ? row.roster_synced_at : latest;
    }, null)
  };
}

export async function updateStudentEmail(env: Env, memberId: string, email: string | null) {
  const normalizedMemberId = requireRosterString(memberId, "memberId");
  const normalizedEmail = normalizeOptionalRosterEmail(email ?? undefined);
  if (normalizedEmail) await requireUniqueStudentEmail(env, normalizedEmail, normalizedMemberId);
  const result = await env.DB.prepare(
    "UPDATE students SET email = ? WHERE student_id = ?"
  ).bind(normalizedEmail ?? null, normalizedMemberId).run();
  const changes = (result as D1Result & { changes?: number }).meta?.changes ?? (result as D1Result & { changes?: number }).changes;
  if (changes === 0) throw Object.assign(new Error("Student not found"), { status: 404 });
  return { memberId: normalizedMemberId, email: normalizedEmail ?? null };
}

export function normalizeRosterMembers(members: RosterMemberInput[] | undefined): RosterMemberInput[] {
  if (!Array.isArray(members)) throw Object.assign(new Error("members must be an array"), { status: 400 });
  if (members.length === 0) throw Object.assign(new Error("Roster sync requires at least one member"), { status: 400 });

  const seen = new Set<string>();
  const seenEmails = new Set<string>();
  return members.map((member, index) => {
    const memberId = requireRosterString(member?.memberId, `members[${index}].memberId`);
    const firstName = requireRosterString(member?.firstName, `members[${index}].firstName`);
    const lastName = requireRosterString(member?.lastName, `members[${index}].lastName`);
    const email = normalizeOptionalRosterEmail(member?.email);
    if (seen.has(memberId)) throw Object.assign(new Error(`Duplicate roster memberId: ${memberId}`), { status: 400 });
    if (email && seenEmails.has(email)) throw Object.assign(new Error(`Duplicate roster email: ${email}`), { status: 409 });
    seen.add(memberId);
    if (email) seenEmails.add(email);
    return email ? { memberId, firstName, lastName, email } : { memberId, firstName, lastName };
  });
}

async function hashRosterRow(member: RosterMemberInput): Promise<string> {
  const bytes = new TextEncoder().encode(`${member.memberId}|${member.firstName}|${member.lastName}|${member.email ?? ""}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requireRosterString(value: string | undefined, name: string) {
  const trimmed = value?.trim();
  if (!trimmed) throw Object.assign(new Error(`${name} is required`), { status: 400 });
  return trimmed;
}

function normalizeOptionalRosterEmail(value: string | undefined) {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw Object.assign(new Error("email must be a valid email address"), { status: 400 });
  }
  return trimmed;
}

async function requireUniqueStudentEmail(env: Env, email: string, memberId: string) {
  const existing = await env.DB.prepare(
    "SELECT student_id FROM students WHERE email = ? AND student_id <> ?"
  ).bind(email, memberId).first<{ student_id: string }>();
  if (existing) throw Object.assign(new Error(`Email is already assigned to member ${existing.student_id}`), { status: 409 });
}
