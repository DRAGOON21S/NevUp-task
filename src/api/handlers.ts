import type pg from "pg";
import type { ServerResponse } from "node:http";
import { createConnection } from "node:net";
import { loadEnv } from "../config/env.js";
import { assertTenant, isUuid, requireAuth, type AuthClaims } from "./auth.js";
import { badRequest, forbidden, notFound } from "./errors.js";
import { readJson } from "./http.js";
import { createTrade, getTradeById, mapTrade } from "./tradeService.js";

type Headers = { authorization?: string | string[] | undefined };

export async function handleCreateTrade(
  pool: pg.Pool,
  headers: Headers,
  body: unknown
): Promise<{ statusCode: number; body: unknown; userId?: string }> {
  const claims = requireAuth(headers);
  const userId = readBodyUserId(body);
  assertTenant(claims, userId);
  const trade = await createTrade(pool, body);
  assertTenant(claims, String(trade.userId));
  return { statusCode: 200, body: trade, userId: claims.sub };
}

export async function handleGetTrade(
  pool: pg.Pool,
  headers: Headers,
  tradeId: string
): Promise<{ statusCode: number; body: unknown; userId?: string }> {
  const claims = requireAuth(headers);
  const trade = await getTradeById(pool, tradeId);
  if (!trade) {
    throw notFound("TRADE_NOT_FOUND", "Trade with the given tradeId does not exist.");
  }
  assertTenant(claims, String(trade.userId));
  return { statusCode: 200, body: trade, userId: claims.sub };
}

export async function handleGetSession(
  pool: pg.Pool,
  headers: Headers,
  sessionId: string
): Promise<{ statusCode: number; body: unknown; userId?: string }> {
  const claims = requireAuth(headers);
  if (!isUuid(sessionId)) {
    throw badRequest("sessionId must be a UUID.");
  }

  const session = await pool.query("SELECT * FROM sessions WHERE session_id = $1", [
    sessionId
  ]);
  const row = session.rows[0];
  if (!row) {
    throw notFound("SESSION_NOT_FOUND", "Session with the given sessionId does not exist.");
  }
  assertTenant(claims, row.user_id);

  const trades = await pool.query(
    "SELECT * FROM trades WHERE session_id = $1 ORDER BY entry_at, trade_id",
    [sessionId]
  );

  const tradeCount = Number(row.trade_count);
  const wins = Number(row.winning_trades);
  const losses = Number(row.losing_trades);

  return {
    statusCode: 200,
    userId: claims.sub,
    body: {
      sessionId: row.session_id,
      userId: row.user_id,
      date: toIso(row.first_entry_at),
      notes: null,
      tradeCount,
      winRate: wins + losses === 0 ? 0 : wins / (wins + losses),
      totalPnl: Number(row.total_pnl),
      trades: trades.rows.map(mapTrade)
    }
  };
}

export async function handleSubmitDebrief(
  pool: pg.Pool,
  headers: Headers,
  sessionId: string,
  reqBody: unknown
): Promise<{ statusCode: number; body: unknown; userId?: string }> {
  const claims = requireAuth(headers);
  if (!isUuid(sessionId)) {
    throw badRequest("sessionId must be a UUID.");
  }

  const session = await pool.query("SELECT user_id FROM sessions WHERE session_id = $1", [
    sessionId
  ]);
  const row = session.rows[0];
  if (!row) {
    throw notFound("SESSION_NOT_FOUND", "Session with the given sessionId does not exist.");
  }
  assertTenant(claims, row.user_id);

  const body = parseDebriefInput(reqBody);
  const notes = [
    `overallMood: ${body.overallMood}`,
    body.keyMistake ? `keyMistake: ${body.keyMistake}` : null,
    body.keyLesson ? `keyLesson: ${body.keyLesson}` : null,
    `planAdherenceRating: ${body.planAdherenceRating}`,
    `willReviewTomorrow: ${body.willReviewTomorrow}`
  ]
    .filter(Boolean)
    .join("\n");

  const inserted = await pool.query(
    `
    INSERT INTO debriefs(session_id, user_id, notes, lessons)
    VALUES ($1, $2, $3, $4)
    RETURNING debrief_id, session_id, created_at
    `,
    [sessionId, claims.sub, notes, body.keyLesson]
  );

  return {
    statusCode: 201,
    userId: claims.sub,
    body: {
      debriefId: inserted.rows[0].debrief_id,
      sessionId: inserted.rows[0].session_id,
      savedAt: toIso(inserted.rows[0].created_at)
    }
  };
}

export async function handleGetMetrics(
  pool: pg.Pool,
  headers: Headers,
  userId: string,
  searchParams: URLSearchParams
): Promise<{ statusCode: number; body: unknown; userId?: string }> {
  const claims = requireAuth(headers);
  assertTenant(claims, userId);

  const from = requireQueryDate(searchParams.get("from"), "from");
  const to = requireQueryDate(searchParams.get("to"), "to");
  const granularity = searchParams.get("granularity");
  if (!granularity || !["hourly", "daily", "rolling30d"].includes(granularity)) {
    throw badRequest("granularity must be hourly, daily, or rolling30d.");
  }

  const [summary, emotions, timeseries] = await Promise.all([
    pool.query(
      `
      SELECT
        avg(plan_adherence)::numeric AS plan_adherence_score,
        count(*) FILTER (WHERE revenge_flag)::integer AS revenge_trades,
        coalesce(sum(pnl), 0)::numeric AS pnl,
        count(*) FILTER (WHERE outcome = 'win')::integer AS wins,
        count(*) FILTER (WHERE outcome = 'loss')::integer AS losses
      FROM trades
      WHERE user_id = $1 AND entry_at >= $2 AND entry_at <= $3
      `,
      [userId, from, to]
    ),
    pool.query(
      `
      SELECT emotional_state, wins, losses, win_rate
      FROM emotional_state_stats
      WHERE user_id = $1 AND granularity = 'all_time'
      `,
      [userId]
    ),
    pool.query(
      `
      SELECT
        date_trunc($4, entry_at) AS bucket,
        count(*)::integer AS trade_count,
        count(*) FILTER (WHERE outcome = 'win')::numeric
          / nullif(count(*) FILTER (WHERE outcome IN ('win', 'loss')), 0)::numeric AS win_rate,
        coalesce(sum(pnl), 0)::numeric AS pnl,
        avg(plan_adherence)::numeric AS avg_plan_adherence
      FROM trades
      WHERE user_id = $1 AND entry_at >= $2 AND entry_at <= $3
      GROUP BY date_trunc($4, entry_at)
      ORDER BY bucket
      `,
      [userId, from, to, granularity === "hourly" ? "hour" : "day"]
    )
  ]);

  const overtrading = await pool.query(
    `
    SELECT count(*)::integer AS count
    FROM overtrading_events
    WHERE user_id = $1 AND detected_at >= $2 AND detected_at <= $3
    `,
    [userId, from, to]
  );
  const tilt = await pool.query(
    "SELECT avg(tilt_index)::numeric AS session_tilt_index FROM sessions WHERE user_id = $1",
    [userId]
  );

  const summaryRow = summary.rows[0] ?? {};

  return {
    statusCode: 200,
    userId: claims.sub,
    body: {
      userId,
      granularity,
      from,
      to,
      planAdherenceScore: nullableNumber(summaryRow.plan_adherence_score),
      sessionTiltIndex: nullableNumber(tilt.rows[0]?.session_tilt_index) ?? 0,
      winRateByEmotionalState: Object.fromEntries(
        emotions.rows.map((row) => [
          row.emotional_state,
          {
            wins: Number(row.wins),
            losses: Number(row.losses),
            winRate: nullableNumber(row.win_rate) ?? 0
          }
        ])
      ),
      revengeTrades: Number(summaryRow.revenge_trades ?? 0),
      overtradingEvents: Number(overtrading.rows[0]?.count ?? 0),
      timeseries: timeseries.rows.map((row) => ({
        bucket: toIso(row.bucket),
        tradeCount: Number(row.trade_count),
        winRate: nullableNumber(row.win_rate) ?? 0,
        pnl: nullableNumber(row.pnl) ?? 0,
        avgPlanAdherence: nullableNumber(row.avg_plan_adherence) ?? 0
      }))
    }
  };
}

export async function handleGetProfile(
  pool: pg.Pool,
  headers: Headers,
  userId: string
): Promise<{ statusCode: number; body: unknown; userId?: string }> {
  const claims = requireAuth(headers);
  assertTenant(claims, userId);

  const exists = await pool.query("SELECT 1 FROM trades WHERE user_id = $1 LIMIT 1", [
    userId
  ]);
  if (exists.rowCount === 0) {
    throw notFound("USER_NOT_FOUND", "No trading data exists for the given userId.");
  }

  const [pathologies, strengths, peak] = await Promise.all([
    pool.query(
      `
      WITH exploded AS (
        SELECT
          unnest(ground_truth_pathologies) AS pathology,
          trade_id,
          session_id,
          entry_at
        FROM trades
        WHERE user_id = $1
      ),
      ranked AS (
        SELECT
          pathology,
          trade_id,
          session_id,
          entry_at,
          row_number() OVER (PARTITION BY pathology ORDER BY entry_at, trade_id) AS trade_rank
        FROM exploded
      )
      SELECT
        pathology,
        count(*)::integer AS count,
        array_agg(trade_id ORDER BY entry_at, trade_id) FILTER (WHERE trade_rank <= 5) AS trade_ids,
        array_agg(DISTINCT session_id) AS session_ids
      FROM ranked
      GROUP BY pathology
      ORDER BY count DESC
      LIMIT 5
      `,
      [userId]
    ),
    pool.query(
      `
      SELECT
        avg(plan_adherence)::numeric AS avg_plan_adherence,
        count(*) FILTER (WHERE revenge_flag)::integer AS revenge_count
      FROM trades
      WHERE user_id = $1
      `,
      [userId]
    ),
    pool.query(
      `
      SELECT
        extract(hour from entry_at)::integer AS hour,
        count(*) FILTER (WHERE outcome = 'win')::numeric
          / nullif(count(*) FILTER (WHERE outcome IN ('win', 'loss')), 0)::numeric AS win_rate,
        count(*)::integer AS trade_count
      FROM trades
      WHERE user_id = $1
      GROUP BY extract(hour from entry_at)
      HAVING count(*) >= 2
      ORDER BY win_rate DESC NULLS LAST, trade_count DESC
      LIMIT 1
      `,
      [userId]
    )
  ]);

  const strengthRow = strengths.rows[0] ?? {};
  const profileStrengths: string[] = [];
  if ((nullableNumber(strengthRow.avg_plan_adherence) ?? 0) >= 4) {
    profileStrengths.push("High average plan adherence across recorded trades.");
  }
  if (Number(strengthRow.revenge_count ?? 0) === 0) {
    profileStrengths.push("No revenge trades detected in the available journal data.");
  }
  if (profileStrengths.length === 0) {
    profileStrengths.push("Maintains enough journal detail to support behavioral review.");
  }

  const peakRow = peak.rows[0];
  const peakPerformanceWindow = peakRow
    ? {
        startHour: Number(peakRow.hour),
        endHour: Number(peakRow.hour) + 1,
        winRate: nullableNumber(peakRow.win_rate) ?? 0
      }
    : null;

  return {
    statusCode: 200,
    userId: claims.sub,
    body: {
      userId,
      generatedAt: new Date().toISOString(),
      dominantPathologies: pathologies.rows.map((row) => ({
        pathology: row.pathology,
        confidence: Math.min(1, Number(row.count) / 10),
        evidenceSessions: row.session_ids ?? [],
        evidenceTrades: row.trade_ids ?? []
      })),
      strengths: profileStrengths,
      peakPerformanceWindow
    }
  };
}

export async function handleHealth(
  pool: pg.Pool
): Promise<{ statusCode: number; body: unknown }> {
  let dbConnection: "connected" | "disconnected" = "connected";
  try {
    await pool.query("SELECT 1");
  } catch {
    dbConnection = "disconnected";
  }

  const queueLag = await getQueueLag();
  const status = dbConnection === "connected" ? "ok" : "degraded";
  return {
    statusCode: status === "ok" ? 200 : 503,
    body: {
      status,
      dbConnection,
      queueLag,
      timestamp: new Date().toISOString()
    }
  };
}

export async function streamCoaching(
  pool: pg.Pool,
  headers: Headers,
  sessionId: string,
  res: ServerResponse,
  traceId: string
): Promise<string | undefined> {
  const claims = requireAuth(headers);
  if (!isUuid(sessionId)) {
    throw badRequest("sessionId must be a UUID.");
  }
  const session = await pool.query("SELECT * FROM sessions WHERE session_id = $1", [
    sessionId
  ]);
  const row = session.rows[0];
  if (!row) {
    throw notFound("SESSION_NOT_FOUND", "Session with the given sessionId does not exist.");
  }
  assertTenant(claims, row.user_id);

  const tokens = buildCoachingMessage(row).split(" ");
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-trace-id": traceId
  });

  for (const token of tokens) {
    res.write(`event: token\ndata: ${JSON.stringify(`${token} `)}\n\n`);
    await delay(25);
  }
  res.write("event: done\ndata: {}\n\n");
  res.end();
  return claims.sub;
}

export async function readRequestJson(req: Parameters<typeof readJson>[0]): Promise<unknown> {
  return readJson(req);
}

function readBodyUserId(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be an object.");
  }
  const userId = (body as Record<string, unknown>).userId;
  if (!isUuid(userId)) {
    throw badRequest("userId must be a UUID.");
  }
  return userId;
}

function parseDebriefInput(body: unknown): {
  overallMood: string;
  keyMistake: string | null;
  keyLesson: string | null;
  planAdherenceRating: number;
  willReviewTomorrow: boolean;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be an object.");
  }
  const data = body as Record<string, unknown>;
  const moods = ["calm", "anxious", "greedy", "fearful", "neutral"];
  if (typeof data.overallMood !== "string" || !moods.includes(data.overallMood)) {
    throw badRequest("overallMood has an unsupported value.");
  }
  if (
    !Number.isInteger(data.planAdherenceRating) ||
    Number(data.planAdherenceRating) < 1 ||
    Number(data.planAdherenceRating) > 5
  ) {
    throw badRequest("planAdherenceRating must be an integer between 1 and 5.");
  }
  return {
    overallMood: data.overallMood,
    keyMistake: optionalDebriefString(data.keyMistake, "keyMistake"),
    keyLesson: optionalDebriefString(data.keyLesson, "keyLesson"),
    planAdherenceRating: Number(data.planAdherenceRating),
    willReviewTomorrow:
      typeof data.willReviewTomorrow === "boolean" ? data.willReviewTomorrow : false
  };
}

function optionalDebriefString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string" || value.length > 1000) {
    throw badRequest(`${field} must be a string up to 1000 characters.`);
  }
  return value;
}

function requireQueryDate(value: string | null, field: string): string {
  if (!value || Number.isNaN(Date.parse(value))) {
    throw badRequest(`${field} query parameter must be an ISO date-time string.`);
  }
  return new Date(value).toISOString();
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function toIso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(String(value)).toISOString();
}

function buildCoachingMessage(session: Record<string, unknown>): string {
  const tilt = nullableNumber(session.tilt_index) ?? 0;
  const plan = nullableNumber(session.plan_adherence_avg) ?? 0;
  const pnl = nullableNumber(session.total_pnl) ?? 0;
  const tradeCount = Number(session.trade_count ?? 0);

  return [
    `Session review: ${tradeCount} trades, total P&L ${pnl.toFixed(2)}.`,
    tilt > 0.35
      ? "Your tilt index was elevated, so slow the next session after any loss and require a fresh setup before re-entry."
      : "Tilt pressure was controlled; keep using the same reset behavior after losing trades.",
    plan < 3.5
      ? "Plan adherence is the main improvement area. Before each entry, write the invalidation level and do not move it."
      : "Plan adherence was a relative strength. Protect that discipline when volatility rises."
  ].join(" ");
}

async function getQueueLag(): Promise<number> {
  const env = loadEnv();
  const url = new URL(env.redisUrl);
  const port = Number(url.port || 6379);
  const host = url.hostname;

  const start = Date.now();
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, timeout: 500 }, () => {
      socket.end();
      resolve(Date.now() - start);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(999);
    });
    socket.on("error", () => resolve(999));
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
