/// <reference types="node" />

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const apiRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(apiRoot, "../..");

describe("bench API report parity", () => {
  let server: ChildProcessWithoutNullStreams | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    if (server && !server.killed) {
      server.kill();
      await new Promise((resolveKill) => server?.once("exit", resolveKill));
    }
    server = undefined;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it("hides unscheduled meeting summaries by default and includes them when requested", async () => {
    const port = 19000 + Math.floor(Math.random() * 1000);
    const baseUrl = `http://127.0.0.1:${port}`;
    tempDir = mkdtempSync(join(tmpdir(), "frc-bench-api-"));
    server = spawn(process.execPath, [resolve(repoRoot, "node_modules/tsx/dist/cli.mjs"), "src/benchServer.ts"], {
      cwd: apiRoot,
      env: {
        ...process.env,
        PORT: String(port),
        BENCH_DB_PATH: join(tempDir, "bench.sqlite"),
        KIOSK_DB_PATH: join(tempDir, "kiosk.sqlite")
      }
    });

    await waitForHealth(baseUrl);
    const sync = await fetch(`${baseUrl}/kiosk/sync`, {
      method: "POST",
      headers: {
        authorization: "Bearer dev-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        kioskId: "bench-01",
        events: [{
          localEventId: "unscheduled-jan-05",
          memberId: "100001",
          occurredAt: "2026-01-05T20:00:00.000Z",
          source: "fingerprint"
        }]
      })
    });
    expect(sync.status).toBe(200);

    const defaultReport = await getJson<{ meetings: Array<{ meetingDate: string; scheduled: boolean }> }>(
      `${baseUrl}/admin/reports/meetings?startDate=2026-01-05&endDate=2026-01-05`
    );
    const toggledReport = await getJson<{ meetings: Array<{ meetingDate: string; scheduled: boolean; presentCount: number }> }>(
      `${baseUrl}/admin/reports/meetings?startDate=2026-01-05&endDate=2026-01-05&includeUnscheduled=1`
    );

    expect(defaultReport.meetings).toEqual([]);
    expect(toggledReport.meetings).toHaveLength(1);
    expect(toggledReport.meetings[0]).toMatchObject({
      meetingDate: "2026-01-05",
      scheduled: false,
      presentCount: 1
    });
  }, 15000);
});

async function waitForHealth(baseUrl: string) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const health = await getJson<{ ok: boolean }>(`${baseUrl}/health`);
      if (health.ok) return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
  }
  throw new Error("Bench API did not start");
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}
