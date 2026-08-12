export interface Env {
  DB: D1Database;
  TIME_ZONE: string;
  GOOGLE_ALLOWED_EMAILS: string;
  GOOGLE_ALLOWED_DOMAIN: string;
  GOOGLE_CLIENT_ID: string;
  DUPLICATE_WINDOW_SECONDS: string;
  KIOSK_SHOW_ATTENDANCE_SUMMARY?: string;
  EMAIL_PROVIDER_URL?: string;
  EMAIL_PROVIDER_API_KEY?: string;
  EMAIL_FROM_ADDRESS?: string;
  EMAIL_FROM_NAME?: string;
}
