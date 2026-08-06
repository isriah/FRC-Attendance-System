export type AttendanceSource = "fingerprint" | "manual";

export type ScanEventStatus = "accepted" | "duplicate" | "rejected";

export type SessionStatus = "open" | "closed";

export interface Member {
  memberId: string;
  firstName: string;
  lastName: string;
  email?: string;
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
  lastHeartbeatAt?: string;
  readerOnline?: boolean | null;
  pendingScanCount?: number;
  lastSyncAt?: string;
  lastSyncError?: string;
}

export interface FingerprintEnrollment {
  memberId: string;
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
  memberId: string;
  occurredAt: string;
  syncedAt?: string;
  source: AttendanceSource;
  status: ScanEventStatus;
}

export interface KioskScanAcknowledgement {
  localEventId: string;
  memberId: string;
  status: ScanEventStatus;
  displayName?: string;
  action?: "check_in" | "check_out";
  attendanceRate?: number | null;
  attendanceSummary?: string;
  kioskMessage?: string;
  kioskDetail?: string;
  message: string;
}

export interface ManualEvent {
  id: string;
  memberId: string;
  occurredAt: string;
  action: "check_in" | "check_out";
  reason: string;
  adminEmail: string;
}

export interface AttendanceSession {
  id: string;
  memberId: string;
  meetingDate: string;
  checkInAt: string;
  checkOutAt?: string;
  status: SessionStatus;
  sourceEventIds: string[];
}

export interface ScheduledMeeting {
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

export interface KioskSyncEventInput {
  localEventId: string;
  memberId?: string;
  studentId?: string;
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

export interface KioskHealthReport {
  kioskId: string;
  readerOnline?: boolean | null;
  pendingScanCount: number;
  lastSyncAt?: string;
  lastSyncError?: string;
}

export type KioskCommandAction = "restart_display" | "restart_services" | "reboot_system";

export type KioskCommandStatus = "pending" | "running" | "completed" | "failed";

export interface KioskCommand {
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
