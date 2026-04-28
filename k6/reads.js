import http from "k6/http";
import { check } from "k6";
import {
  DEFAULT_SESSION_ID,
  DEFAULT_TRADE_ID,
  DEFAULT_USER_ID,
  createToken,
  htmlReport
} from "./helpers.js";

const BASE_URL = __ENV.NEVUP_K6_BASE_URL || __ENV.LOAD_BASE_URL || "http://localhost:4010";
const USER_ID = __ENV.NEVUP_K6_USER_ID || __ENV.LOAD_USER_ID || DEFAULT_USER_ID;
const TRADE_ID = __ENV.NEVUP_K6_TRADE_ID || __ENV.LOAD_TRADE_ID || DEFAULT_TRADE_ID;
const SESSION_ID = __ENV.NEVUP_K6_SESSION_ID || __ENV.LOAD_SESSION_ID || DEFAULT_SESSION_ID;
const RPS = Number(__ENV.NEVUP_K6_READ_RPS || __ENV.LOAD_READ_RPS || 100);
const DURATION = __ENV.NEVUP_K6_READ_DURATION || `${__ENV.LOAD_READ_DURATION_SECONDS || 60}s`;
const PRE_ALLOCATED_VUS = Number(__ENV.NEVUP_K6_READ_PRE_ALLOCATED_VUS || 50);
const MAX_VUS = Number(__ENV.NEVUP_K6_READ_MAX_VUS || 150);

export const options = {
  scenarios: {
    reads: {
      executor: "constant-arrival-rate",
      rate: RPS,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: PRE_ALLOCATED_VUS,
      maxVUs: MAX_VUS
    }
  },
  thresholds: {
    http_req_failed: ["rate==0"],
    http_req_duration: ["p(95)<200"],
    checks: ["rate==1"]
  }
};

export function setup() {
  return { token: createToken(USER_ID) };
}

export default function (data) {
  const endpoints = [
    { name: "GET /health", path: "/health", auth: false },
    { name: "GET /trades/{tradeId}", path: `/trades/${TRADE_ID}`, auth: true },
    { name: "GET /sessions/{sessionId}", path: `/sessions/${SESSION_ID}`, auth: true },
    {
      name: "GET /users/{userId}/metrics",
      path: `/users/${USER_ID}/metrics?from=2025-01-01T00:00:00Z&to=2025-03-31T23:59:59Z&granularity=daily`,
      auth: true
    },
    { name: "GET /users/{userId}/profile", path: `/users/${USER_ID}/profile`, auth: true }
  ];
  const endpoint = endpoints[__ITER % endpoints.length];
  const response = http.get(`${BASE_URL}${endpoint.path}`, {
    headers: endpoint.auth ? { authorization: `Bearer ${data.token}` } : {},
    tags: { endpoint: endpoint.name },
    timeout: "5s"
  });

  check(response, {
    [`${endpoint.name} status is 200`]: (res) => res.status === 200
  });
}

export function handleSummary(data) {
  return {
    "reports/k6-reads-summary.json": JSON.stringify(data, null, 2),
    "reports/k6-reads-report.html": htmlReport(data, "NevUp k6 Read Load Test")
  };
}
