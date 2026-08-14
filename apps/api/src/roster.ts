import type { Env } from "./env";

export interface RosterMemberInput {
  memberId?: string;
  studentId?: string;
  firstName: string;
  lastName: string;
  email?: string;
  discordUserId?: string;
  discord_user_id?: string;
}

interface NormalizedRosterMemberInput {
  memberId: string;
  firstName: string;
  lastName: string;
  email?: string;
  discordUserId?: string;
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
    if (member.discordUserId) await requireUniqueStudentDiscordUserId(env, member.discordUserId, member.memberId);
    const rosterHash = await hashRosterRow(member);
    statements.push(
      env.DB.prepare(
        "INSERT INTO students (student_id, first_name, last_name, email, discord_user_id, active, roster_hash, roster_synced_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT(student_id) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name, email = COALESCE(excluded.email, students.email), discord_user_id = COALESCE(excluded.discord_user_id, students.discord_user_id), active = 1, roster_hash = excluded.roster_hash, roster_synced_at = excluded.roster_synced_at"
      ).bind(member.memberId, member.firstName, member.lastName, member.email ?? null, member.discordUserId ?? null, rosterHash, syncedAt)
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

  const deactivatedMissingMembers = seen.size > 0;
  return { synced: normalizedMembers.length, deactivatedMissingMembers, deactivatedMissingStudents: deactivatedMissingMembers };
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

export async function listRosterMembers(env: Env, active?: boolean) {
  const where = active === undefined ? "" : "WHERE active = ?";
  const statement = env.DB.prepare(`
    SELECT student_id, first_name, last_name, email, discord_user_id, active, roster_synced_at
    FROM students
    ${where}
    ORDER BY last_name, first_name
  `);
  const rows = active === undefined
    ? await statement.all<StudentRow>()
    : await statement.bind(active ? 1 : 0).all<StudentRow>();
  return rows.results.map(rowToMember);
}

export async function updateStudentEmail(env: Env, memberId: string, email: string | null) {
  const normalizedMemberId = requireRosterString(memberId, "memberId");
  const normalizedEmail = normalizeOptionalRosterEmail(email ?? undefined);
  if (normalizedEmail) await requireUniqueStudentEmail(env, normalizedEmail, normalizedMemberId);
  const result = await env.DB.prepare(
    "UPDATE students SET email = ? WHERE student_id = ?"
  ).bind(normalizedEmail ?? null, normalizedMemberId).run();
  const changes = (result as D1Result & { changes?: number }).meta?.changes ?? (result as D1Result & { changes?: number }).changes;
  if (changes === 0) throw Object.assign(new Error("Member not found"), { status: 404 });
  return { memberId: normalizedMemberId, email: normalizedEmail ?? null };
}

export async function updateStudentDiscordUserId(env: Env, memberId: string, discordUserId: string | null) {
  const normalizedMemberId = requireRosterString(memberId, "memberId");
  const normalizedDiscordUserId = normalizeOptionalDiscordUserId(discordUserId ?? undefined);
  if (normalizedDiscordUserId) await requireUniqueStudentDiscordUserId(env, normalizedDiscordUserId, normalizedMemberId);
  const result = await env.DB.prepare(
    "UPDATE students SET discord_user_id = ? WHERE student_id = ?"
  ).bind(normalizedDiscordUserId ?? null, normalizedMemberId).run();
  const changes = (result as D1Result & { changes?: number }).meta?.changes ?? (result as D1Result & { changes?: number }).changes;
  if (changes === 0) throw Object.assign(new Error("Member not found"), { status: 404 });
  return { memberId: normalizedMemberId, discordUserId: normalizedDiscordUserId ?? null };
}

export async function deactivateMember(env: Env, memberId: string) {
  return setMemberActive(env, memberId, false);
}

export async function reactivateMember(env: Env, memberId: string) {
  return setMemberActive(env, memberId, true);
}

export async function hardDeleteMember(env: Env, memberId: string) {
  const normalizedMemberId = requireRosterString(memberId, "memberId");
  const member = await requireExistingMember(env, normalizedMemberId);
  const statements = [
    env.DB.prepare("DELETE FROM fingerprint_enrollments WHERE student_id = ?").bind(normalizedMemberId),
    env.DB.prepare("DELETE FROM manual_events WHERE student_id = ?").bind(normalizedMemberId),
    env.DB.prepare("DELETE FROM attendance_sessions WHERE student_id = ?").bind(normalizedMemberId),
    env.DB.prepare("DELETE FROM scan_events WHERE student_id = ?").bind(normalizedMemberId),
    env.DB.prepare("DELETE FROM notification_deliveries WHERE student_id = ?").bind(normalizedMemberId),
    env.DB.prepare("DELETE FROM students WHERE student_id = ?").bind(normalizedMemberId)
  ];
  await env.DB.batch(statements);
  return {
    memberId: normalizedMemberId,
    firstName: member.first_name,
    lastName: member.last_name,
    hardDeleted: true
  };
}

export function normalizeRosterMembers(members: RosterMemberInput[] | undefined): NormalizedRosterMemberInput[] {
  if (!Array.isArray(members)) throw Object.assign(new Error("members must be an array"), { status: 400 });
  if (members.length === 0) throw Object.assign(new Error("Roster sync requires at least one member"), { status: 400 });

  const seen = new Set<string>();
  const seenEmails = new Set<string>();
  const seenDiscordUserIds = new Set<string>();
  return members.map((member, index) => {
    const memberId = requireRosterString(member?.memberId ?? member?.studentId, `members[${index}].memberId`);
    const firstName = requireRosterString(member?.firstName, `members[${index}].firstName`);
    const lastName = requireRosterString(member?.lastName, `members[${index}].lastName`);
    const email = normalizeOptionalRosterEmail(member?.email);
    const discordUserId = normalizeOptionalDiscordUserId(member?.discordUserId ?? member?.discord_user_id);
    if (seen.has(memberId)) throw Object.assign(new Error(`Duplicate roster memberId: ${memberId}`), { status: 400 });
    if (email && seenEmails.has(email)) throw Object.assign(new Error(`Duplicate roster email: ${email}`), { status: 409 });
    if (discordUserId && seenDiscordUserIds.has(discordUserId)) {
      throw Object.assign(new Error(`Duplicate roster Discord user ID: ${discordUserId}`), { status: 409 });
    }
    seen.add(memberId);
    if (email) seenEmails.add(email);
    if (discordUserId) seenDiscordUserIds.add(discordUserId);
    return {
      memberId,
      firstName,
      lastName,
      ...(email ? { email } : {}),
      ...(discordUserId ? { discordUserId } : {})
    };
  });
}

async function setMemberActive(env: Env, memberId: string, active: boolean) {
  const normalizedMemberId = requireRosterString(memberId, "memberId");
  await requireExistingMember(env, normalizedMemberId);
  await env.DB.prepare(
    "UPDATE students SET active = ? WHERE student_id = ?"
  ).bind(active ? 1 : 0, normalizedMemberId).run();
  const member = await requireExistingMember(env, normalizedMemberId);
  return rowToMember(member);
}

async function requireExistingMember(env: Env, memberId: string) {
  const member = await env.DB.prepare(
    "SELECT student_id, first_name, last_name, email, discord_user_id, active, roster_synced_at FROM students WHERE student_id = ?"
  ).bind(memberId).first<StudentRow>();
  if (!member) throw Object.assign(new Error("Member not found"), { status: 404 });
  return member;
}

function rowToMember(row: StudentRow) {
  return {
    memberId: row.student_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email ?? null,
    discordUserId: row.discord_user_id ?? null,
    active: Boolean(row.active),
    rosterSyncedAt: row.roster_synced_at ?? null
  };
}

async function hashRosterRow(member: NormalizedRosterMemberInput): Promise<string> {
  const bytes = new TextEncoder().encode(`${member.memberId}|${member.firstName}|${member.lastName}|${member.email ?? ""}|${member.discordUserId ?? ""}`);
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

function normalizeOptionalDiscordUserId(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!/^\d{5,25}$/.test(trimmed)) {
    throw Object.assign(new Error("discordUserId must be a numeric Discord user ID"), { status: 400 });
  }
  return trimmed;
}

async function requireUniqueStudentEmail(env: Env, email: string, memberId: string) {
  const existing = await env.DB.prepare(
    "SELECT student_id FROM students WHERE email = ? AND student_id <> ?"
  ).bind(email, memberId).first<{ student_id: string }>();
  if (existing) throw Object.assign(new Error(`Email is already assigned to member ${existing.student_id}`), { status: 409 });
}

async function requireUniqueStudentDiscordUserId(env: Env, discordUserId: string, memberId: string) {
  const existing = await env.DB.prepare(
    "SELECT student_id FROM students WHERE discord_user_id = ? AND student_id <> ?"
  ).bind(discordUserId, memberId).first<{ student_id: string }>();
  if (existing) throw Object.assign(new Error(`Discord user ID is already assigned to member ${existing.student_id}`), { status: 409 });
}

interface StudentRow {
  student_id: string;
  first_name: string;
  last_name: string;
  email?: string | null;
  discord_user_id?: string | null;
  active: number;
  roster_synced_at?: string | null;
}
