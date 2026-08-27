export function localTimeInputValue(value?: string) {
  const date = dateForTimeDisplay(value);
  if (!date) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function formatDateTime(value?: string) {
  if (!value) return "";
  const date = dateForDateTimeDisplay(value);
  if (!date) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function formatTime(value?: string) {
  if (!value) return "";
  const date = dateForTimeDisplay(value);
  if (!date) return value;
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function dateForDateTimeDisplay(value?: string) {
  if (!value) return undefined;
  return validDate(normalizeLegacyDateTime(value));
}

function dateForTimeDisplay(value?: string) {
  if (!value) return undefined;
  const timeOnlyMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (timeOnlyMatch) {
    const hours = timeOnlyMatch[1] ?? "0";
    const minutes = timeOnlyMatch[2] ?? "00";
    const seconds = timeOnlyMatch[3] ?? "00";
    return validDate(`1970-01-01T${hours.padStart(2, "0")}:${minutes}:${seconds}`);
  }
  return validDate(normalizeLegacyDateTime(value));
}

function normalizeLegacyDateTime(value: string) {
  return /^\d{4}-\d{2}-\d{2}\+/.test(value) ? value.replace("+", "T") : value;
}

function validDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
