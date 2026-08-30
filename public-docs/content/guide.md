# FRC Attendance System Operations Guide

Use this guide for day-to-day attendance work. It is a public guide, so it deliberately leaves out account credentials, member records, and infrastructure configuration.

## Quickstart

1. Sign in to the Attendance Admin dashboard with your authorized team account.
2. Confirm the roster is current before a meeting.
3. Create or review the scheduled meeting, including whether attendance is required.
4. Check that the kiosk is ready before members arrive.
5. After the meeting, review attendance and handle any corrections before sending notifications.

For help with the codebase or this public guide, use the [project on GitHub](https://github.com/isriah/FRC-Attendance-System).

## Roster and member management

The Roster page is the starting point for active members. Search by name or member ID to open a member’s details.

- Use the roster import flow for a current, properly headed CSV. Review the preview before confirming it.
- Deactivate a member who is no longer active. This keeps their history intact.
- Reactivate a returning member from the Deactivated Members view.
- Use hard delete only for a record that truly must be removed. It requires an explicit confirmation because member-owned attendance history is affected.
- Keep contact information and the optional Discord user ID accurate in member details so notifications can reach the intended person.

## Meetings and attendance

Create meetings before they begin whenever possible. Set the date, title, time window, and whether the meeting is required. Required meetings drive attendance percentages; optional meetings record participation without counting as misses.

After a meeting, open its details to review present members, absent members, open check-ins, and attendance context. A member added after an older meeting date is not counted as missing that meeting.

### Corrections and excuses

Use the attendance tools only after confirming the situation with the member or mentor team.

- An excuse documents why an absence should not count against the member’s required attendance. It does not create a check-in.
- If an attendance record is wrong, use the dashboard’s correction flow and provide the requested reason. Corrections are auditable.
- A Discord absence contest can be reviewed from the Contests area or the related meeting. Approving a valid contest marks the member present through the normal correction path.
- Keep scan and correction history intact whenever possible. Clear a date’s source data only when you intend to remove its attendance records and have confirmed the date carefully.

## Reports

Reports are built around completed scheduled meetings. Use the date range controls to focus on a season, event, or other period.

- Meeting Attendance summarizes required meetings, including zero-scan meetings and open check-ins that need follow-up.
- Daily Presence helps review activity for one date, including attendance that has not yet been turned into a scheduled meeting.
- Roster Attendance shows each active member’s attendance rate across completed required meetings after their start date.
- Mentor Export provides a spreadsheet-oriented view for further review.

Optional meetings and required meetings before a member’s attendance start date do not lower their required attendance rate.

## Kiosk use and Wi-Fi recovery

Before doors open, wake the kiosk and confirm that it shows the ready state. Members scan their enrolled finger and should wait for the on-screen acknowledgement before walking away.

If Wi-Fi drops, the kiosk keeps scans locally and will sync them after it reconnects. Avoid repeatedly rescanning the same finger; the kiosk suppresses immediate repeats to prevent duplicates.

For basic recovery:

- Check that the kiosk has power and that its display is responsive.
- Confirm it is connected to the approved team network.
- Wait briefly after reconnection for queued scans to sync.
- If the reader shows unavailable or the kiosk remains offline, notify the designated technical mentor with the kiosk name and visible message.

Do not share network passwords, kiosk tokens, or member data in a public support request.

## Email and Discord

Notifications are meant to support mentor review, not replace it. Preview a notification before sending when the dashboard offers that option.

- Missed-meeting email is available for completed required meetings and only reaches members with a saved email address.
- Member attendance reports can be previewed or sent from the member details flow when contact information is present.
- Discord missing-member messages use saved Discord user IDs. Review the meeting’s absences first, because notifications may mention members.
- Discord calendar sync can publish scheduled meetings to the team server calendar. Re-sync after changing a meeting that has already been published.

## Troubleshooting

### I cannot sign in

Use the authorized team Google account. If access is still denied, contact a dashboard administrator; do not create or share an alternate login.

### A scan did not appear immediately

Check the kiosk’s acknowledgement and connection state. Offline scans remain queued locally and should appear after the kiosk reconnects. If the problem persists, record the member name, kiosk name, and approximate scan time for a mentor to review.

### A member’s percentage looks unexpected

Check whether the meeting was required and completed, whether the member’s attendance start date applies, and whether an excuse or correction is present. Then review the member’s report detail.

### The dashboard or kiosk needs technical help

Capture the exact visible error, the affected page or kiosk name, and the approximate time. Share that information privately with the team’s designated technical mentor.
