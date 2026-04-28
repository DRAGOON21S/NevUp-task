import http from "k6/http";
import { check } from "k6";
import {
  DEFAULT_USER_ID,
  createToken,
  createTrade,
  htmlReport,
  uuid
} from "./helpers.js";

const BASE_URL = __ENV.NEVUP_K6_BASE_URL || __ENV.LOAD_BASE_URL || "http://localhost:4010";
const USER_ID = __ENV.NEVUP_K6_USER_ID || __ENV.LOAD_USER_ID || DEFAULT_USER_ID;
const RPS = Number(__ENV.NEVUP_K6_RPS || __ENV.LOAD_RPS || 200);
const DURATION = __ENV.NEVUP_K6_DURATION || `${__ENV.LOAD_DURATION_SECONDS || 60}s`;
const SESSION_COUNT = Number(__ENV.NEVUP_K6_SESSION_COUNT || __ENV.LOAD_SESSION_COUNT || 100);
const PRE_ALLOCATED_VUS = Number(__ENV.NEVUP_K6_PRE_ALLOCATED_VUS || 100);
const MAX_VUS = Number(__ENV.NEVUP_K6_MAX_VUS || 300);

export const options = {
  scenarios: {
    close_events: {
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
    http_req_duration: ["p(95)<150"],
    checks: ["rate==1"]
  }
};

export function setup() {
  return {
    token: createToken(USER_ID),
    sessionIds: Array.from({ length: SESSION_COUNT }, () => uuid())
  };
}

export default function (data) {
  const trade = createTrade(__ITER, USER_ID, data.sessionIds);
  const response = http.post(`${BASE_URL}/trades`, JSON.stringify(trade), {
    headers: {
      authorization: `Bearer ${data.token}`,
      "content-type": "application/json"
    },
    tags: { endpoint: "POST /trades" },
    timeout: "5s"
  });

  check(response, {
    "POST /trades status is 200": (res) => res.status === 200,
    "POST /trades returns same tradeId": (res) => {
      try {
        return res.json("tradeId") === trade.tradeId;
      } catch {
        return false;
      }
    }
  });
}

export function handleSummary(data) {
  return {
    "reports/k6-trades-summary.json": JSON.stringify(data, null, 2),
    "reports/k6-trades-report.html": htmlReport(data, "NevUp k6 Write Load Test")
  };
}
