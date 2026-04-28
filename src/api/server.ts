import { createServer } from "node:http";
import { createPool } from "../db/pool.js";
import { loadEnv } from "../config/env.js";
import {
  handleCreateTrade,
  handleGetMetrics,
  handleGetProfile,
  handleGetSession,
  handleGetTrade,
  handleHealth,
  handleSubmitDebrief,
  readRequestJson,
  streamCoaching
} from "./handlers.js";
import { createContext, logRequest, sendError, sendJson } from "./http.js";
import { notFound } from "./errors.js";

const env = loadEnv();
const pool = createPool();

const server = createServer(async (req, res) => {
  const context = createContext();
  let userId: string | undefined;
  let statusCode = 500;

  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const method = req.method ?? "GET";
    const route = matchRoute(method, url.pathname);

    if (route.kind === "coaching") {
      userId = await streamCoaching(pool, req.headers, route.sessionId, res, context.traceId);
      statusCode = 200;
      return;
    }

    const result = await dispatch(route, req, url);
    userId = result.userId;
    statusCode = result.statusCode;
    sendJson(res, result.statusCode, result.body, context.traceId);
  } catch (error) {
    statusCode = sendError(res, error, context.traceId);
  } finally {
    if (shouldLogRequest(statusCode)) {
      logRequest({
        traceId: context.traceId,
        ...(userId ? { userId } : {}),
        method: req.method,
        path: req.url,
        statusCode,
        latency: Date.now() - context.startedAt
      });
    }
  }
});

server.listen(env.port, () => {
  console.log(
    JSON.stringify({
      event: "server.started",
      port: env.port,
      nodeEnv: env.nodeEnv
    })
  );
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function shutdown(): Promise<void> {
  server.close();
  await pool.end();
  process.exit(0);
}

function shouldLogRequest(statusCode: number): boolean {
  return statusCode >= 400 || Math.random() < env.requestLogSampleRate;
}

type Route =
  | { kind: "createTrade" }
  | { kind: "getTrade"; tradeId: string }
  | { kind: "getSession"; sessionId: string }
  | { kind: "submitDebrief"; sessionId: string }
  | { kind: "coaching"; sessionId: string }
  | { kind: "getMetrics"; userId: string }
  | { kind: "getProfile"; userId: string }
  | { kind: "health" };

function matchRoute(method: string, path: string): Route {
  if (method === "POST" && path === "/trades") {
    return { kind: "createTrade" };
  }
  if (method === "GET" && path === "/health") {
    return { kind: "health" };
  }

  const parts = path.split("/").filter(Boolean);
  if (method === "GET" && parts.length === 2 && parts[0] === "trades") {
    return { kind: "getTrade", tradeId: parts[1] ?? "" };
  }
  if (method === "GET" && parts.length === 2 && parts[0] === "sessions") {
    return { kind: "getSession", sessionId: parts[1] ?? "" };
  }
  if (
    method === "POST" &&
    parts.length === 3 &&
    parts[0] === "sessions" &&
    parts[2] === "debrief"
  ) {
    return { kind: "submitDebrief", sessionId: parts[1] ?? "" };
  }
  if (
    method === "GET" &&
    parts.length === 3 &&
    parts[0] === "sessions" &&
    parts[2] === "coaching"
  ) {
    return { kind: "coaching", sessionId: parts[1] ?? "" };
  }
  if (
    method === "GET" &&
    parts.length === 3 &&
    parts[0] === "users" &&
    parts[2] === "metrics"
  ) {
    return { kind: "getMetrics", userId: parts[1] ?? "" };
  }
  if (
    method === "GET" &&
    parts.length === 3 &&
    parts[0] === "users" &&
    parts[2] === "profile"
  ) {
    return { kind: "getProfile", userId: parts[1] ?? "" };
  }

  throw notFound("ROUTE_NOT_FOUND", "No route matches this request.");
}

async function dispatch(
  route: Exclude<Route, { kind: "coaching" }>,
  req: Parameters<typeof readRequestJson>[0],
  url: URL
): Promise<{ statusCode: number; body: unknown; userId?: string }> {
  switch (route.kind) {
    case "createTrade":
      return handleCreateTrade(pool, req.headers, await readRequestJson(req));
    case "getTrade":
      return handleGetTrade(pool, req.headers, route.tradeId);
    case "getSession":
      return handleGetSession(pool, req.headers, route.sessionId);
    case "submitDebrief":
      return handleSubmitDebrief(
        pool,
        req.headers,
        route.sessionId,
        await readRequestJson(req)
      );
    case "getMetrics":
      return handleGetMetrics(pool, req.headers, route.userId, url.searchParams);
    case "getProfile":
      return handleGetProfile(pool, req.headers, route.userId);
    case "health":
      return handleHealth(pool);
  }
}
