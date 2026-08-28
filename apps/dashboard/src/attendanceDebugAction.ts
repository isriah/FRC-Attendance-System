export interface ClearMemberAttendanceSourceDataPayload {
  memberId: string;
  meetingDate: string;
  reason: string;
  confirmation: string;
}

export function clearMemberAttendanceConfirmation(memberId: string, meetingDate: string): string {
  return `CLEAR ${memberId} ${meetingDate}`;
}

export function buildClearMemberAttendanceSourceDataPayload(input: {
  memberId: string;
  meetingDate: string;
  reasonInput: string | null;
  confirmationInput: string | null;
}): ClearMemberAttendanceSourceDataPayload | null {
  if (input.reasonInput === null || input.confirmationInput === null) return null;
  const reason = input.reasonInput.trim();
  if (reason.length < 10) throw new Error("A debugging note of at least 10 characters is required to clear attendance data.");
  return {
    memberId: input.memberId,
    meetingDate: input.meetingDate,
    reason,
    confirmation: input.confirmationInput
  };
}
