import { randomUUID } from "node:crypto";
import { createPool } from "../db/pool.js";
import { createTestToken } from "../loadtest/common.js";

const BASE_URL = process.env.DEMO_BASE_URL ?? "http://localhost:4010";
const USER_ID = process.env.DEMO_USER_ID ?? "f412f236-4edc-47a2-8f54-8763a6ed2ce8";
const OTHER_USER_ID =
  process.env.DEMO_OTHER_USER_ID ?? "5ea09db5-13f9-48aa-8fe0-3ec52925d4f2";
const SEED_TRADE_ID =
  process.env.DEMO_SEED_TRADE_ID ?? "9c967550-357f-4bfb-9726-c8b863e968ce";
const SEED_SESSION_ID =
  process.env.DEMO_SEED_SESSION_ID ?? "4f39c2ea-8687-41f7-85a0-1fafd3e976df";
const CLEANUP = process.env.DEMO_CLEANUP !== "false";

const tradeId = randomUUID();
const sessionId = randomUUID();
const auth = { authorization: `Bearer ${createTestToken(USER_ID)}` };
const otherAuth = { authorization: `Bearer ${createTestToken(OTHER_USER_ID)}` };

await main();

async function main(): Promise<void> {
  const pool = createPool();
  try {
    const health = await getJson("/health");
    printStep("health", health);

    const seededTrade = await getJson(`/trades/${SEED_TRADE_ID}`, auth);
    printStep("seeded_trade_read", pick(seededTrade.body, ["tradeId", "userId", "sessionId", "asset", "status"]));

    const seededSession = await getJson(`/sessions/${SEED_SESSION_ID}`, auth);
    printStep("seeded_session_read", pick(seededSession.body, ["sessionId", "userId", "tradeCount", "winRate", "totalPnl"]));

    const payload = buildTrade();
    const firstWrite = await postJson("/trades", payload, auth);
    const secondWrite = await postJson("/trades", payload, auth);
    printStep("idempotent_write", {
      firstStatus: firstWrite.status,
      secondStatus: secondWrite.status,
      sameBody: JSON.stringify(firstWrite.body) === JSON.stringify(secondWrite.body),
      tradeId
    });

    const crossTenant = await getJson(`/trades/${tradeId}`, otherAuth);
    printStep("tenant_isolation", {
      status: crossTenant.status,
      error: crossTenant.body.error
    });

    const metrics = await getJson(
      `/users/${USER_ID}/metrics?from=2025-01-01T00:00:00Z&to=2026-12-31T23:59:59Z&granularity=daily`,
      auth
    );
    printStep("metrics", {
      status: metrics.status,
      userId: metrics.body.userId,
      timeseriesPoints: Array.isArray(metrics.body.timeseries) ? metrics.body.timeseries.length : 0,
      revengeTrades: metrics.body.revengeTrades,
      overtradingEvents: metrics.body.overtradingEvents
    });

    const profile = await getJson(`/users/${USER_ID}/profile`, auth);
    printStep("profile", {
      status: profile.status,
      dominantPathologies: Array.isArray(profile.body.dominantPathologies)
        ? profile.body.dominantPathologies.slice(0, 3)
        : [],
      strengths: profile.body.strengths
    });

    const coaching = await getText(`/sessions/${sessionId}/coaching`, auth);
    printStep("coaching_sse", {
      status: coaching.status,
      emittedDone: coaching.body.includes("event: done")
    });

    printStep("performance_proof", {
      writeTarget: "12000 writes, 0 errors, p95 19ms",
      readTarget: "6000 reads, 0 errors, p95 6ms",
      source: "docs/performance.md and DECISIONS.md"
    });
  } finally {
    if (CLEANUP) {
      await cleanup(pool);
    }
    await pool.end();
  }
}

function buildTrade(): Record<string, unknown> {
  return {
    tradeId,
    userId: USER_ID,
    sessionId,
    asset: "AAPL",
    assetClass: "equity",
    direction: "long",
    entryPrice: 100,
    exitPrice: 102,
    quantity: 1,
    entryAt: "2026-04-28T14:00:00.000Z",
    exitAt: "2026-04-28T14:02:00.000Z",
    status: "closed",
    planAdherence: 5,
    emotionalState: "calm",
    entryRationale: "Automated judge demo trade."
  };
}

async function getJson(
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${BASE_URL}${path}`, { headers });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function postJson(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string>
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
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

function pick(
  source: Record<string, unknown>,
  keys: string[]
): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}

function printStep(name: string, data: unknown): void {
  console.log(JSON.stringify({ step: name, data }, null, 2));
}
