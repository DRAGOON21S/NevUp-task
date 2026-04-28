import crypto from "node:crypto";
import { loadEnv } from "../config/env.js";

export type LatencyResult = {
  name: string;
  status: number;
  latencyMs: number;
};

export function createTestToken(userId: string): string {
  const env = loadEnv();
  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const encodedPayload = base64Url(
    JSON.stringify({
      sub: userId,
      iat: now,
      exp: now + 3600,
      role: "trader"
    })
  );
  const signature = crypto
    .createHmac("sha256", env.jwtSecret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export function summarizeLatency(
  results: LatencyResult[]
): Record<string, unknown> {
  const latencies = results.map((result) => result.latencyMs).sort((a, b) => a - b);
  const byEndpoint = new Map<string, LatencyResult[]>();
  for (const result of results) {
    byEndpoint.set(result.name, [...(byEndpoint.get(result.name) ?? []), result]);
  }

  return {
    completed: results.length,
    errors: results.filter((result) => result.status >= 400).length,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    p99LatencyMs: percentile(latencies, 0.99),
    endpoints: Object.fromEntries(
      [...byEndpoint.entries()].map(([name, endpointResults]) => [
        name,
        summarizeEndpoint(endpointResults)
      ])
    )
  };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  return values[Math.ceil(values.length * p) - 1] ?? values[values.length - 1] ?? 0;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeEndpoint(results: LatencyResult[]): Record<string, number> {
  const latencies = results.map((result) => result.latencyMs).sort((a, b) => a - b);
  return {
    completed: results.length,
    errors: results.filter((result) => result.status >= 400).length,
    p95LatencyMs: percentile(latencies, 0.95)
  };
}

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}
