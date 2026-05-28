export type AttendanceSource = "fingerprint" | "manual";

export type ScanEventStatus = "accepted" | "duplicate" | "rejected";

export type SessionStatus = "open" | "closed";

export interface Student {
  studentId: string;
  firstName: string;
  lastName: string;
  active: boolean;
  rosterSyncedAt: string;
  rosterHash?: string;
}

export interface Kiosk {
  kioskId: string;
  name: string;
  location?: string;
  active: boolean;
  lastSeenAt?: string;
}

export interface FingerprintEnrollment {
  studentId: string;
  kioskId: string;
  templateSlot: number;
  fingerLabel?: string;
  enrolledAt: string;
  deletedAt?: string;
}

export interface ScanEvent {
  id: string;
  kioskId: string;
  localEventId: string;
  studentId: string;
  occurredAt: string;
  syncedAt?: string;
  source: AttendanceSource;
  status: ScanEventStatus;
}

export interface KioskScanAcknowledgement {
  localEventId: string;
  studentId: string;
  status: ScanEventStatus;
  displayName?: string;
  action?: "check_in" | "check_out";
  attendanceRate?: number | null;
  attendanceSummary?: string;
  message: string;
}

export interface ManualEvent {
  id: string;
  studentId: string;
  occurredAt: string;
  action: "check_in" | "check_out";
  reason: string;
  adminEmail: string;
}

export interface AttendanceSession {
  id: string;
  studentId: string;
  meetingDate: string;
  checkInAt: string;
  checkOutAt?: string;
  status: SessionStatus;
  sourceEventIds: string[];
}

export interface KioskSyncEventInput {
  localEventId: string;
  studentId: string;
  occurredAt: string;
  source: "fingerprint";
}

export interface KioskSyncRequest {
  kioskId: string;
  events: KioskSyncEventInput[];
}

export interface KioskSyncResult {
  accepted: ScanEvent[];
  duplicates: ScanEvent[];
  rejected: Array<KioskSyncEventInput & { reason: string }>;
  acknowledgements?: KioskScanAcknowledgement[];
}
