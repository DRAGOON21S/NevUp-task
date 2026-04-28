import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createPool } from "../db/pool.js";
import { createTestToken, delay } from "../loadtest/common.js";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:4010";
const USER_ID = process.env.TEST_USER_ID ?? "f412f236-4edc-47a2-8f54-8763a6ed2ce8";
const OTHER_USER_ID =
  process.env.TEST_OTHER_USER_ID ?? "5ea09db5-13f9-48aa-8fe0-3ec52925d4f2";
const EXISTING_TRADE_ID =
  process.env.TEST_EXISTING_TRADE_ID ?? "9c967550-357f-4bfb-9726-c8b863e968ce";
const EXISTING_SESSION_ID =
  process.env.TEST_EXISTING_SESSION_ID ?? "4f39c2ea-8687-41f7-85a0-1fafd3e976df";

type JsonResponse<T = Record<string, unknown>> = {
  status: number;
  headers: Headers;
  body: T;
};

const tradeId = randomUUID();
const sessionId = randomUUID();
const auth = { authorization: `Bearer ${createTestToken(USER_ID)}` };
const otherAuth = { authorization: `Bearer ${createTestToken(OTHER_USER_ID)}` };
let server: ChildProcessWithoutNullStreams | null = null;

async function main(): Promise<void> {
  const started = await ensureApi();
  const pool = createPool();

  try {
    await runCase("health check", async () => {
      const response = await getJson("/health");
      assert.equal(response.status, 200);
      assert.equal(response.body.status, "ok");
    });

    await runCase("rejects missing auth", async () => {
      const response = await postJson("/trades", makeTrade(), {});
      assert.equal(response.status, 401);
      assert.equal(response.body.error, "UNAUTHORIZED");
    });

    await runCase("creates an idempotent trade", async () => {
      const first = await postJson("/trades", makeTrade(), auth);
      const second = await postJson("/trades", makeTrade(), auth);
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal(first.body.tradeId, tradeId);
      assert.deepEqual(second.body, first.body);
    });

    await runCase("reads trade and session", async () => {
      const trade = await getJson(`/trades/${tradeId}`, auth);
      assert.equal(trade.status, 200);
      assert.equal(trade.body.tradeId, tradeId);

      const session = await getJson(`/sessions/${sessionId}`, auth);
      assert.equal(session.status, 200);
      assert.equal(session.body.sessionId, sessionId);
      assert.ok(Array.isArray(session.body.trades));
    });

    await runCase("enforces tenant isolation", async () => {
      const trade = await getJson(`/trades/${tradeId}`, otherAuth);
      const metrics = await getJson(
        `/users/${USER_ID}/metrics?from=2025-01-01T00:00:00Z&to=2025-03-31T23:59:59Z&granularity=daily`,
        otherAuth
      );
      assert.equal(trade.status, 403);
      assert.equal(metrics.status, 403);
    });

    await runCase("supports debrief, metrics, profile, and SSE coaching", async () => {
      const debrief = await postJson(
        `/sessions/${sessionId}/debrief`,
        {
          overallMood: "calm",
          keyMistake: "None in integration test.",
          keyLesson: "Respect the written plan.",
          planAdherenceRating: 4,
          willReviewTomorrow: true
        },
        auth
      );
      assert.equal(debrief.status, 201);
      assert.equal(debrief.body.sessionId, sessionId);

      const metrics = await getJson(
        `/users/${USER_ID}/metrics?from=2025-01-01T00:00:00Z&to=2026-12-31T23:59:59Z&granularity=daily`,
        auth
      );
      assert.equal(metrics.status, 200);
      assert.equal(metrics.body.userId, USER_ID);
      assert.ok(Array.isArray(metrics.body.timeseries));

      const profile = await getJson(`/users/${USER_ID}/profile`, auth);
      assert.equal(profile.status, 200);
      assert.equal(profile.body.userId, USER_ID);
      assert.ok(Array.isArray(profile.body.dominantPathologies));

      const coaching = await getText(`/sessions/${sessionId}/coaching`, auth);
      assert.equal(coaching.status, 200);
      assert.match(coaching.body, /event: done/);
    });

    await runCase("seed read endpoints remain available", async () => {
      const trade = await getJson(`/trades/${EXISTING_TRADE_ID}`, auth);
      const session = await getJson(`/sessions/${EXISTING_SESSION_ID}`, auth);
      assert.equal(trade.status, 200);
      assert.equal(session.status, 200);
    });

    console.log(
      JSON.stringify({
        event: "integration.complete",
        apiStartedByTest: started,
        tradeId,
        sessionId
      })
    );
  } finally {
    await cleanup(pool);
    await pool.end();
    if (server) {
      server.kill("SIGTERM");
      await Promise.race([once(server, "exit"), delay(2000)]);
    }
  }
}

function makeTrade(): Record<string, unknown> {
  return {
    tradeId,
    userId: USER_ID,
    sessionId,
    asset: "AAPL",
    assetClass: "equity",
    direction: "long",
    entryPrice: 100,
    exitPrice: 101.25,
    quantity: 2,
    entryAt: "2026-04-28T09:30:00.000Z",
    exitAt: "2026-04-28T09:34:00.000Z",
    status: "closed",
    planAdherence: 4,
    emotionalState: "calm",
    entryRationale: "Automated integration test trade."
  };
}

async function ensureApi(): Promise<boolean> {
  if (await isHealthy()) {
    return false;
  }

  server = spawn(process.execPath, ["dist/api/server.js"], {
    cwd: process.cwd(),
    env: process.env
  });
  server.stdout.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await isHealthy()) {
      return true;
    }
    await delay(250);
  }
  throw new Error("API did not become healthy within 15 seconds.");
}

async function isHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function runCase(name: string, fn: () => Promise<void>): Promise<void> {
  const startedAt = Date.now();
  await fn();
  console.log(JSON.stringify({ event: "integration.case", name, latencyMs: Date.now() - startedAt }));
}

async function getJson<T = Record<string, unknown>>(
  path: string,
  headers: Record<string, string> = {}
): Promise<JsonResponse<T>> {
  const response = await fetch(`${BASE_URL}${path}`, { headers });
  return {
    status: response.status,
    headers: response.headers,
    body: (await response.json()) as T
  };
}

async function postJson<T = Record<string, unknown>>(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string>
): Promise<JsonResponse<T>> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });
  return {
    status: response.status,
    headers: response.headers,
    body: (await response.json()) as T
  };
}

async function getText(
  path: string,
  headers: Record<string, string>
): Promise<{ status: number; body: string }> {
  const response = await fetch(`${BASE_URL}${path}`, { headers });
  return { status: response.status, body: await response.text() };
}

async function cleanup(pool: ReturnType<typeof createPool>): Promise<void> {
  await pool.query("DELETE FROM debriefs WHERE session_id = $1", [sessionId]);
  await pool.query("DELETE FROM overtrading_events WHERE trade_id = $1", [tradeId]);
  await pool.query("DELETE FROM event_outbox WHERE aggregate_id = $1", [tradeId]);
  await pool.query("DELETE FROM trades WHERE trade_id = $1", [tradeId]);
  await pool.query("DELETE FROM sessions WHERE session_id = $1", [sessionId]);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
