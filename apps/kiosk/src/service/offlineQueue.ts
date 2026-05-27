import Database from "better-sqlite3";
import type { KioskSyncEventInput } from "@frc-attendance/shared";

export interface LocalScanEvent extends KioskSyncEventInput {
  syncedAt?: string;
  syncError?: string;
}

export class OfflineQueue {
  private readonly db: Database.Database;

  constructor(databasePath: string) {
    this.db = new Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS local_scan_events (
        local_event_id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        source TEXT NOT NULL,
        synced_at TEXT,
        sync_error TEXT
      );

      CREATE TABLE IF NOT EXISTS local_enrollments (
        student_id TEXT NOT NULL,
        template_slot INTEGER NOT NULL,
        finger_label TEXT,
        enrolled_at TEXT NOT NULL,
        deleted_at TEXT,
        PRIMARY KEY (student_id, template_slot)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS local_enrollments_active_slot_idx
      ON local_enrollments(template_slot)
      WHERE deleted_at IS NULL;
    `);
  }

  addFingerprintScan(studentId: string, occurredAt = new Date().toISOString()): LocalScanEvent {
    const event: LocalScanEvent = {
      localEventId: crypto.randomUUID(),
      studentId,
      occurredAt,
      source: "fingerprint"
    };
    this.db.prepare(
      "INSERT INTO local_scan_events (local_event_id, student_id, occurred_at, source) VALUES (?, ?, ?, ?)"
    ).run(event.localEventId, event.studentId, event.occurredAt, event.source);
    return event;
  }

  pending(limit = 100): LocalScanEvent[] {
    return this.db.prepare(
      "SELECT local_event_id, student_id, occurred_at, source, synced_at, sync_error FROM local_scan_events WHERE synced_at IS NULL ORDER BY occurred_at ASC LIMIT ?"
    ).all(limit).map((row) => rowToEvent(row as Parameters<typeof rowToEvent>[0]));
  }

  markSynced(localEventIds: string[], syncedAt = new Date().toISOString()) {
    if (localEventIds.length === 0) return;
    const statement = this.db.prepare("UPDATE local_scan_events SET synced_at = ?, sync_error = NULL WHERE local_event_id = ?");
    const transaction = this.db.transaction((ids: string[]) => {
      for (const id of ids) statement.run(syncedAt, id);
    });
    transaction(localEventIds);
  }

  markErrored(localEventIds: string[], error: string) {
    if (localEventIds.length === 0) return;
    const statement = this.db.prepare("UPDATE local_scan_events SET sync_error = ? WHERE local_event_id = ?");
    const transaction = this.db.transaction((ids: string[]) => {
      for (const id of ids) statement.run(error, id);
    });
    transaction(localEventIds);
  }
}

function rowToEvent(row: {
  local_event_id: string;
  student_id: string;
  occurred_at: string;
  source: "fingerprint";
  synced_at?: string;
  sync_error?: string;
}): LocalScanEvent {
  return {
    localEventId: row.local_event_id,
    studentId: row.student_id,
    occurredAt: row.occurred_at,
    source: row.source,
    syncedAt: row.synced_at,
    syncError: row.sync_error
  };
}
