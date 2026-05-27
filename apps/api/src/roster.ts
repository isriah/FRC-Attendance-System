import type { Env } from "./env";

export interface RosterMemberInput {
  memberId: string;
  firstName: string;
  lastName: string;
}

export async function syncRoster(env: Env, members: RosterMemberInput[]) {
  const startedAt = new Date().toISOString();
  const syncId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO sync_log (id, kind, status, started_at) VALUES (?, 'roster', 'running', ?)").bind(syncId, startedAt).run();

  const seen = new Set<string>();
  const statements: D1PreparedStatement[] = [];
  const syncedAt = new Date().toISOString();

  for (const member of members) {
    seen.add(member.memberId);
    const rosterHash = await hashRosterRow(member);
    statements.push(
      env.DB.prepare(
        "INSERT INTO students (student_id, first_name, last_name, active, roster_hash, roster_synced_at) VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT(student_id) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name, active = 1, roster_hash = excluded.roster_hash, roster_synced_at = excluded.roster_synced_at"
      ).bind(member.memberId, member.firstName, member.lastName, rosterHash, syncedAt)
    );
  }

  if (statements.length > 0) await env.DB.batch(statements);
  if (seen.size > 0) {
    const placeholders = [...seen].map(() => "?").join(",");
    await env.DB.prepare(`UPDATE students SET active = 0, roster_synced_at = ? WHERE student_id NOT IN (${placeholders})`).bind(syncedAt, ...seen).run();
  }

  await env.DB.prepare("UPDATE sync_log SET status = 'success', message = ?, finished_at = ? WHERE id = ?")
    .bind(`Synced ${members.length} roster members`, new Date().toISOString(), syncId)
    .run();

  return { synced: members.length, deactivatedMissingStudents: seen.size > 0 };
}

async function hashRosterRow(member: RosterMemberInput): Promise<string> {
  const bytes = new TextEncoder().encode(`${member.memberId}|${member.firstName}|${member.lastName}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
