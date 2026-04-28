import { randomUUID } from "node:crypto";
import { createTestToken } from "../loadtest/common.js";

const BASE_URL = process.env.DEPLOY_BASE_URL ?? process.env.LOAD_BASE_URL;
const USER_ID = process.env.DEPLOY_USER_ID ?? "f412f236-4edc-47a2-8f54-8763a6ed2ce8";
const SEED_TRADE_ID =
  process.env.DEPLOY_TRADE_ID ?? "9c967550-357f-4bfb-9726-c8b863e968ce";
const SEED_SESSION_ID =
  process.env.DEPLOY_SESSION_ID ?? "4f39c2ea-8687-41f7-85a0-1fafd3e976df";

if (!BASE_URL) {
  throw new Error("Set DEPLOY_BASE_URL or LOAD_BASE_URL to the deployed API URL.");
}

const token = createTestToken(USER_ID);
const auth = { authorization: `Bearer ${token}` };

await main();

async function main(): Promise<void> {
  const tradeId = randomUUID();
  const sessionId = randomUUID();

  const checks = [
    await getJson("/health"),
    await getJson(`/trades/${SEED_TRADE_ID}`, auth),
    await getJson(`/sessions/${SEED_SESSION_ID}`, auth),
    await getJson(
      `/users/${USER_ID}/metrics?from=2025-01-01T00:00:00Z&to=2025-03-31T23:59:59Z&granularity=daily`,
      auth
    ),
    await getJson(`/users/${USER_ID}/profile`, auth),
    await postJson("/trades", buildTrade(tradeId, sessionId), auth),
    await postJson("/trades", buildTrade(tradeId, sessionId), auth)
  ];

  const failed = checks.filter((check) => check.status >= 400);
  console.log(
    JSON.stringify(
      {
        baseUrl: BASE_URL,
        checks: checks.map(({ name, status }) => ({ name, status })),
        syntheticTradeId: tradeId,
        syntheticSessionId: sessionId,
        cleanupNote:
          "Run loadtest:cleanup with the deployed DATABASE_URL if this smoke wrote to a persistent deployed database.",
        passed: failed.length === 0
      },
      null,
      2
    )
  );

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

function buildTrade(tradeId: string, sessionId: string): Record<string, unknown> {
  return {
    tradeId,
    userId: USER_ID,
    sessionId,
    asset: "AAPL",
    assetClass: "equity",
    direction: "long",
    entryPrice: 100,
    exitPrice: 101,
    quantity: 1,
    entryAt: "2026-04-28T15:00:00.000Z",
    exitAt: "2026-04-28T15:01:00.000Z",
    status: "closed",
    planAdherence: 4,
    emotionalState: "calm",
    entryRationale: "Automated deployment smoke trade."
  };
}

async function getJson(
  path: string,
  headers: Record<string, string> = {}
): Promise<{ name: string; status: number }> {
  const response = await fetch(`${BASE_URL}${path}`, { headers });
  await response.arrayBuffer();
  return { name: `GET ${path.split("?")[0]}`, status: response.status };
}

async function postJson(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string>
): Promise<{ name: string; status: number }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  await response.arrayBuffer();
  return { name: `POST ${path}`, status: response.status };
}
