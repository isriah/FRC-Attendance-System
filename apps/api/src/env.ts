export interface Env {
  DB: D1Database;
  TIME_ZONE: string;
  GOOGLE_ALLOWED_EMAILS: string;
  GOOGLE_ALLOWED_DOMAIN: string;
  GOOGLE_CLIENT_ID: string;
  DUPLICATE_WINDOW_SECONDS: string;
  KIOSK_SHOW_ATTENDANCE_SUMMARY?: string;
  RESEND_API_KEY?: string;
  EMAIL_PROVIDER_URL?: string;
  EMAIL_PROVIDER_API_KEY?: string;
  EMAIL_FROM_ADDRESS?: string;
  EMAIL_FROM_NAME?: string;
  DISCORD_MISSING_MEMBERS_WEBHOOK_URL?: string;
  DISCORD_WEBHOOK_URL?: string;
  WORKER_VERSION?: string;
  CF_VERSION_METADATA?: { id?: string };
}
