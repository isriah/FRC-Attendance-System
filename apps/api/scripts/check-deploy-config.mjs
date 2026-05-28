import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(scriptDir, "..");
const wranglerPath = resolve(apiDir, "wrangler.toml");
const config = readFileSync(wranglerPath, "utf8");

const errors = [];
const warnings = [];

const databaseId = readTomlString(config, "database_id");
if (!databaseId || databaseId === "replace-with-cloudflare-d1-database-id") {
  errors.push("Set the D1 database_id in apps/api/wrangler.toml before deploying or applying remote migrations.");
}

const vars = readVars(config);
if (!vars.GOOGLE_CLIENT_ID) {
  errors.push("Set GOOGLE_CLIENT_ID for production so admin requests require Google ID tokens.");
}

if (!vars.GOOGLE_ALLOWED_EMAILS && !vars.GOOGLE_ALLOWED_DOMAIN) {
  errors.push("Set GOOGLE_ALLOWED_EMAILS or GOOGLE_ALLOWED_DOMAIN so admin access is allowlisted.");
}

if (!vars.TIME_ZONE) {
  warnings.push("TIME_ZONE is empty; attendance session dates may not match the team's local timezone.");
}

if (!vars.DUPLICATE_WINDOW_SECONDS) {
  warnings.push("DUPLICATE_WINDOW_SECONDS is empty; the API will fall back to the shared default.");
}

for (const warning of warnings) {
  console.warn(`Deploy config warning: ${warning}`);
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`Deploy config error: ${error}`);
  }
  process.exit(1);
}

console.log("API deploy config looks ready.");

function readTomlString(source, key) {
  const match = source.match(new RegExp(`^${escapeRegExp(key)}\\s*=\\s*"([^"]*)"`, "m"));
  return match?.[1]?.trim() ?? "";
}

function readVars(source) {
  const varsStart = source.search(/^\[vars\]\s*$/m);
  if (varsStart === -1) return {};

  const afterVars = source.slice(varsStart).split(/\r?\n/).slice(1);
  const vars = {};
  for (const line of afterVars) {
    if (/^\[/.test(line)) break;
    const match = line.match(/^([A-Z0-9_]+)\s*=\s*"([^"]*)"/);
    if (match) vars[match[1]] = match[2].trim();
  }
  return vars;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
