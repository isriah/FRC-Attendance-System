export interface FingerprintEnrollment {
  memberId: string;
  firstName?: string;
  lastName?: string;
  active: number;
  slot: number;
  fingerLabel?: string;
  enrolledAt: string;
}

export const fingerLabelOptions = [
  ["right-thumb", "Right thumb"],
  ["right-index", "Right index"],
  ["right-middle", "Right middle"],
  ["right-ring", "Right ring"],
  ["right-pinky", "Right pinky"],
  ["left-thumb", "Left thumb"],
  ["left-index", "Left index"],
  ["left-middle", "Left middle"],
  ["left-ring", "Left ring"],
  ["left-pinky", "Left pinky"]
] as const;

export function nextAvailableFingerprintSlot(enrollments: FingerprintEnrollment[], pendingOccupiedSlot?: number) {
  const occupiedSlots = new Set(enrollments.map((enrollment) => enrollment.slot));
  if (pendingOccupiedSlot) occupiedSlots.add(pendingOccupiedSlot);
  for (let slot = 1; slot <= 200; slot += 1) {
    if (!occupiedSlots.has(slot)) return slot;
  }
  return 200;
}

export function normalizeFingerLabel(value?: string) {
  return value && fingerLabelOptions.some(([option]) => option === value) ? value : "right-index";
}

export function fingerprintEnrollmentName(enrollment: Pick<FingerprintEnrollment, "memberId" | "firstName" | "lastName">) {
  const name = [enrollment.firstName, enrollment.lastName].filter(Boolean).join(" ");
  return name ? `${enrollment.memberId} - ${name}` : enrollment.memberId;
}
