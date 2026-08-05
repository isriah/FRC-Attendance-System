import { spawn } from "node:child_process";

const productionApiBaseUrl = (process.env.PRODUCTION_API_BASE_URL ?? "https://frc-attendance-api.frc-attendance.workers.dev").replace(/\/$/, "");
const dashboardUrl = (process.env.DASHBOARD_URL ?? "https://frc-attendance-dashboard.pages.dev").replace(/\/$/, "");
const expectedGoogleClientId =
  process.env.EXPECTED_GOOGLE_CLIENT_ID ??
  "180849199739-v04bktp7rfmimgjpvohmq7pinrrpr337.apps.googleusercontent.com";
const skipPi = process.argv.includes("--skip-pi") || process.env.PREDEPLOY_SKIP_PI === "1";

function logStep(message) {
  console.log(`\n==> ${message}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, options = {}) {
  const { response, text } = await fetchText(url, options);
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${url} returned non-JSON response: ${text.slice(0, 300)}`);
  }
  return { response, body, text };
}

async function checkProductionApiHealth() {
  logStep("Production API health");
  const url = `${productionApiBaseUrl}/health`;
  const { response, body, text } = await fetchJson(url);

  assert(response.ok, `${url} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  assert(body?.ok === true, `Expected ok=true from ${url}, got ${JSON.stringify(body)}`);
  assert(body?.service === "frc-attendance-api", `Expected frc-attendance-api service, got ${JSON.stringify(body)}`);

  console.log(`PASS ${url}`);
}

function scriptUrlsFromHtml(html) {
  return [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]);
}

function absoluteAssetUrl(src) {
  return new URL(src, `${dashboardUrl}/`).toString();
}

async function checkDashboardSmoke() {
  logStep("Dashboard Pages smoke");
  const { response, text: html } = await fetchText(dashboardUrl);

  assert(response.ok, `${dashboardUrl} returned HTTP ${response.status}: ${html.slice(0, 300)}`);
  assert(/<div[^>]+id=["']root["']/i.test(html), "Dashboard HTML did not include the React root element");

  const scriptUrls = scriptUrlsFromHtml(html).map(absoluteAssetUrl);
  assert(scriptUrls.length > 0, "Dashboard HTML did not reference any JavaScript bundles");

  const bundles = await Promise.all(
    scriptUrls.map(async (url) => {
      const { response: bundleResponse, text } = await fetchText(url);
      assert(bundleResponse.ok, `${url} returned HTTP ${bundleResponse.status}`);
      return text;
    })
  );
  const bundledSource = bundles.join("\n");

  assert(
    bundledSource.includes(productionApiBaseUrl),
    `Dashboard bundles did not include production API URL ${productionApiBaseUrl}`
  );
  assert(
    bundledSource.includes(expectedGoogleClientId),
    `Dashboard bundles did not include expected Google client ID ${expectedGoogleClientId}`
  );
  assert(
    bundledSource.includes("https://accounts.google.com/gsi/client"),
    "Dashboard bundles did not include the Google sign-in script URL"
  );

  console.log(`PASS ${dashboardUrl}`);
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

async function runPiRosterPullSmoke() {
  if (skipPi) {
    console.log("\n==> Pi-local roster pull smoke");
    console.log("SKIP PREDEPLOY_SKIP_PI=1 or --skip-pi was set");
    return;
  }

  logStep("Pi-local roster pull smoke");

  await new Promise((resolve, reject) => {
    const npmArgs = ["--workspace", "@frc-attendance/api", "run", "smoke:pi-roster-pull"];
    const command = process.platform === "win32" ? "cmd.exe" : npmCommand();
    const args = process.platform === "win32" ? ["/d", "/s", "/c", [npmCommand(), ...npmArgs].join(" ")] : npmArgs;
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Pi roster pull smoke exited with code ${code ?? "unknown"}`));
      }
    });
  });

  console.log("PASS Pi-local roster pull smoke");
}

try {
  await checkProductionApiHealth();
  await checkDashboardSmoke();
  await runPiRosterPullSmoke();
  console.log("\nPre-deploy smoke checks passed.");
} catch (error) {
  console.error("\nPre-deploy smoke checks failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
