import { loadEnv } from "../config/env.js";
import { createTestToken, delay, summarizeLatency, type LatencyResult } from "./common.js";

const env = loadEnv();
const baseUrl = process.env.LOAD_BASE_URL ?? `http://localhost:${env.port}`;
const userId =
  process.env.LOAD_USER_ID ?? "f412f236-4edc-47a2-8f54-8763a6ed2ce8";
const tradeId =
  process.env.LOAD_TRADE_ID ?? "9c967550-357f-4bfb-9726-c8b863e968ce";
const sessionId =
  process.env.LOAD_SESSION_ID ?? "4f39c2ea-8687-41f7-85a0-1fafd3e976df";
const rps = Number(process.env.LOAD_READ_RPS ?? process.env.LOAD_RPS ?? 100);
const durationSeconds = Number(
  process.env.LOAD_READ_DURATION_SECONDS ?? process.env.LOAD_DURATION_SECONDS ?? 30
);
const concurrency = Number(
  process.env.LOAD_READ_CONCURRENCY ?? process.env.LOAD_CONCURRENCY ?? 50
);
const token = createTestToken(userId);
const startedAt = Date.now();
const totalRequests = rps * durationSeconds;
const results: LatencyResult[] = [];
let nextIndex = 0;

const endpoints = [
  {
    name: "GET /health",
    path: "/health",
    auth: false
  },
  {
    name: "GET /trades/{tradeId}",
    path: `/trades/${tradeId}`,
    auth: true
  },
  {
    name: "GET /sessions/{sessionId}",
    path: `/sessions/${sessionId}`,
    auth: true
  },
  {
    name: "GET /users/{userId}/metrics",
    path: `/users/${userId}/metrics?from=2025-01-01T00:00:00Z&to=2025-03-31T23:59:59Z&granularity=daily`,
    auth: true
  },
  {
    name: "GET /users/{userId}/profile",
    path: `/users/${userId}/profile`,
    auth: true
  }
];

await runReadLoadTest();

async function runReadLoadTest(): Promise<void> {
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  console.log(
    JSON.stringify(
      {
        baseUrl,
        userId,
        tradeId,
        sessionId,
        rps,
        durationSeconds,
        concurrency,
        totalRequests,
        ...summarizeLatency(results)
      },
      null,
      2
    )
  );
}

async function worker(): Promise<void> {
  while (nextIndex < totalRequests) {
    const index = nextIndex;
    nextIndex += 1;

    const scheduledAt = Math.floor((index / rps) * 1000);
    const elapsed = Date.now() - startedAt;
    if (scheduledAt > elapsed) {
      await delay(scheduledAt - elapsed);
    }

    const endpoint = endpoints[index % endpoints.length];
    if (!endpoint) {
      throw new Error("No read load endpoints configured.");
    }
    const started = Date.now();
    const response = await fetch(`${baseUrl}${endpoint.path}`, {
      headers: endpoint.auth ? { authorization: `Bearer ${token}` } : {}
    });
    await response.arrayBuffer();
    results.push({
      name: endpoint.name,
      status: response.status,
      latencyMs: Date.now() - started
    });
  }
}
