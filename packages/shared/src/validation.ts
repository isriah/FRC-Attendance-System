export function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw Object.assign(new Error(`${fieldName} must be a non-empty string`), { status: 400 });
  }
  return value.trim();
}

export function requireIsoTimestamp(value: unknown, fieldName: string): string {
  const timestamp = requireNonEmptyString(value, fieldName);
  if (Number.isNaN(new Date(timestamp).getTime())) {
    throw Object.assign(new Error(`${fieldName} must be an ISO timestamp`), { status: 400 });
  }
  return timestamp;
}

export function requireIsoDate(value: unknown, fieldName: string): string {
  const date = requireNonEmptyString(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw Object.assign(new Error(`${fieldName} must be an ISO date`), { status: 400 });
  }

  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw Object.assign(new Error(`${fieldName} must be an ISO date`), { status: 400 });
  }
  return date;
}
