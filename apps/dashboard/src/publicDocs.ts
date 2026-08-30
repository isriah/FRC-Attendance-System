export const defaultPublicDocsUrl = "https://isriah.github.io/FRC-Attendance-System/";

export function publicDocsUrl(configuredUrl?: string) {
  return configuredUrl?.trim() || defaultPublicDocsUrl;
}
