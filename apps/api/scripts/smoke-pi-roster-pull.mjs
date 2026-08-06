import { spawn } from "node:child_process";

const sshTarget = process.env.PI_ROSTER_PULL_SSH_TARGET ?? "attkiosk@AttKiosk";

const remoteScript = String.raw`
import { execFileSync } from "node:child_process";

const benchApiBaseUrl = (process.env.BENCH_API_BASE_URL ?? "http://localhost:8787").replace(/\/$/, "");
const serviceName = process.env.BENCH_API_SERVICE ?? "frc-bench-api";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(url + " returned non-JSON response: " + text.slice(0, 300));
    }
    if (!response.ok) {
      throw new Error(url + " returned HTTP " + response.status + ": " + text.slice(0, 300));
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function serviceEnvironment() {
  const raw = execFileSync("systemctl", ["--user", "show", serviceName, "--property=Environment", "--value"], {
    encoding: "utf8"
  });
  const env = {};
  for (const match of raw.matchAll(/(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)=([^\s]+)/g)) {
    env[match[1]] = match[2];
  }
  return env;
}

function rosterKey(member) {
  return member.memberId + "\u0000" + member.firstName + "\u0000" + member.lastName;
}

const health = await requestJson(benchApiBaseUrl + "/health");
assert(health?.ok === true && health?.service === "bench-api", "Unexpected bench API health: " + JSON.stringify(health));

const env = serviceEnvironment();
const remoteApiBaseUrl = (env.REMOTE_API_BASE_URL ?? "").replace(/\/$/, "");
const remoteKioskId = env.REMOTE_KIOSK_ID ?? env.KIOSK_ID;
const remoteKioskToken = env.REMOTE_KIOSK_TOKEN ?? env.KIOSK_TOKEN;

assert(remoteApiBaseUrl, serviceName + " is missing REMOTE_API_BASE_URL");
assert(remoteKioskId, serviceName + " is missing REMOTE_KIOSK_ID or KIOSK_ID");
assert(remoteKioskToken, serviceName + " is missing REMOTE_KIOSK_TOKEN or KIOSK_TOKEN");

const productionRoster = await requestJson(remoteApiBaseUrl + "/kiosk/roster?kioskId=" + encodeURIComponent(remoteKioskId), {
  headers: { authorization: "Bearer " + remoteKioskToken }
});
assert(Array.isArray(productionRoster?.members), "Production roster response did not include members");
assert(productionRoster.members.length > 0, "Production roster was empty");

const pullResult = await requestJson(benchApiBaseUrl + "/admin/roster/pull-production", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}"
});
assert(pullResult?.synced === productionRoster.members.length, "Pull synced " + pullResult?.synced + ", expected " + productionRoster.members.length);
assert(pullResult?.source === remoteApiBaseUrl, "Pull source " + pullResult?.source + " did not match " + remoteApiBaseUrl);

const localMembers = await requestJson(benchApiBaseUrl + "/admin/members");
assert(Array.isArray(localMembers?.members), "Local members response did not include members");

const expected = productionRoster.members
  .map((member) => ({
    memberId: String(member.memberId),
    firstName: String(member.firstName),
    lastName: String(member.lastName)
  }))
  .sort((a, b) => rosterKey(a).localeCompare(rosterKey(b)));

const actual = localMembers.members
  .filter((member) => Boolean(member.active))
  .map((member) => ({
    memberId: String(member.memberId),
    firstName: String(member.firstName),
    lastName: String(member.lastName)
  }))
  .sort((a, b) => rosterKey(a).localeCompare(rosterKey(b)));

assert(
  JSON.stringify(actual) === JSON.stringify(expected),
  "Local active roster did not match production. expected=" + JSON.stringify(expected) + " actual=" + JSON.stringify(actual)
);

console.log(JSON.stringify({
  ok: true,
  benchApiBaseUrl,
  remoteApiBaseUrl,
  remoteKioskId,
  synced: pullResult.synced,
  rosterSyncedAt: productionRoster.rosterSyncedAt ?? null,
  pulledAt: pullResult.pulledAt ?? null
}, null, 2));
`;

const ssh = spawn("ssh", [
  sshTarget,
  "bash -lc 'source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; node --input-type=module'"
], {
  stdio: ["pipe", "pipe", "pipe"]
});

let stdout = "";
let stderr = "";
ssh.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});
ssh.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

ssh.stdin.end(remoteScript);

const exitCode = await new Promise((resolve, reject) => {
  ssh.on("error", reject);
  ssh.on("exit", resolve);
});

if (stdout.trim()) console.log(stdout.trim());
if (stderr.trim()) console.error(stderr.trim());

if (exitCode !== 0) {
  process.exitCode = exitCode ?? 1;
}
