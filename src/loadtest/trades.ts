import crypto from "node:crypto";
import { loadEnv } from "../config/env.js";
import { createTestToken, delay, summarizeLatency, type LatencyResult } from "./common.js";

const env = loadEnv();
const baseUrl = process.env.LOAD_BASE_URL ?? `http://localhost:${env.port}`;
const userId =
  process.env.LOAD_USER_ID ?? "f412f236-4edc-47a2-8f54-8763a6ed2ce8";
const sessionId = process.env.LOAD_SESSION_ID ?? crypto.randomUUID();
const sessionCount = Math.max(1, Number(process.env.LOAD_SESSION_COUNT ?? 100));
const rps = Number(process.env.LOAD_RPS ?? 200);
const durationSeconds = Number(process.env.LOAD_DURATION_SECONDS ?? 60);
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? 100);
const requestTimeoutMs = Number(process.env.LOAD_REQUEST_TIMEOUT_MS ?? 5000);
const token = createTestToken(userId);
const sessionIds = Array.from({ length: sessionCount }, (_, index) =>
  index === 0 ? sessionId : crypto.randomUUID()
);

const totalRequests = rps * durationSeconds;
const results: LatencyResult[] = [];
const startedAt = Date.now();
let nextIndex = 0;

await runLoadTest();

async function runLoadTest(): Promise<void> {
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  console.log(
    JSON.stringify(
      {
        baseUrl,
        userId,
        sessionId,
        sessionCount,
        rps,
        durationSeconds,
        concurrency,
        requestTimeoutMs,
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    const started = Date.now();
    try {
      const response = await fetch(`${baseUrl}/trades`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(buildTrade(index)),
        signal: controller.signal
      });
      await response.arrayBuffer();
      results.push({
        name: "POST /trades",
        status: response.status,
        latencyMs: Date.now() - started
      });
    } catch {
      results.push({
        name: "POST /trades",
        status: 599,
        latencyMs: Date.now() - started
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function buildTrade(index: number): Record<string, unknown> {
  const entryAt = new Date(Date.UTC(2025, 2, 1, 14, 0, index));
  const exitAt = new Date(entryAt.getTime() + 60_000);
  const direction = index % 2 === 0 ? "long" : "short";
  const entryPrice = 100 + (index % 25);
  const exitPrice = direction === "long" ? entryPrice + 0.25 : entryPrice - 0.25;

  return {
    tradeId: crypto.randomUUID(),
    userId,
    sessionId: sessionIds[index % sessionIds.length],
    asset: "AAPL",
    assetClass: "equity",
    direction,
    entryPrice,
    exitPrice,
    quantity: 1,
    entryAt: entryAt.toISOString(),
    exitAt: exitAt.toISOString(),
    status: "closed",
    planAdherence: 4,
    emotionalState: index % 5 === 0 ? "anxious" : "calm",
    entryRationale: "Automated load test trade."
  };
}
