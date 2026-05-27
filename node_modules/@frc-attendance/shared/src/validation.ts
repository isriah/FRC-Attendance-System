export function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

export function requireIsoTimestamp(value: unknown, fieldName: string): string {
  const timestamp = requireNonEmptyString(value, fieldName);
  if (Number.isNaN(new Date(timestamp).getTime())) {
    throw new Error(`${fieldName} must be an ISO timestamp`);
  }
  return timestamp;
}
