import type pg from "pg";
import { badRequest, forbidden, notFound } from "./errors.js";
import { isUuid } from "./auth.js";

type TradeInput = {
  tradeId: string;
  userId: string;
  sessionId: string;
  asset: string;
  assetClass: "equity" | "crypto" | "forex";
  direction: "long" | "short";
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  entryAt: string;
  exitAt: string | null;
  status: "open" | "closed" | "cancelled";
  planAdherence: number | null;
  emotionalState: "calm" | "anxious" | "greedy" | "fearful" | "neutral" | null;
  entryRationale: string | null;
};

const ASSET_CLASSES = new Set(["equity", "crypto", "forex"]);
const DIRECTIONS = new Set(["long", "short"]);
const STATUSES = new Set(["open", "closed", "cancelled"]);
const EMOTIONS = new Set(["calm", "anxious", "greedy", "fearful", "neutral"]);

export function mapTrade(row: Record<string, unknown>): Record<string, unknown> {
  return {
    tradeId: row.trade_id,
    userId: row.user_id,
    sessionId: row.session_id,
    asset: row.asset,
    assetClass: row.asset_class,
    direction: row.direction,
    entryPrice: asNumber(row.entry_price),
    exitPrice: asNullableNumber(row.exit_price),
    quantity: asNumber(row.quantity),
    entryAt: toIso(row.entry_at),
    exitAt: toNullableIso(row.exit_at),
    status: row.status,
    planAdherence: row.plan_adherence,
    emotionalState: row.emotional_state,
    entryRationale: row.entry_rationale,
    outcome: row.outcome,
    pnl: asNullableNumber(row.pnl),
    revengeFlag: row.revenge_flag,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

export async function getTradeById(
  client: pg.Pool | pg.PoolClient,
  tradeId: string
): Promise<Record<string, unknown> | null> {
  if (!isUuid(tradeId)) {
    throw badRequest("tradeId must be a UUID.");
  }

  const result = await client.query("SELECT * FROM trades WHERE trade_id = $1", [
    tradeId
  ]);
  return result.rows[0] ? mapTrade(result.rows[0]) : null;
}

export async function createTrade(
  pool: pg.Pool,
  body: unknown
): Promise<Record<string, unknown>> {
  const input = parseTradeInput(body);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query("SELECT * FROM trades WHERE trade_id = $1", [
      input.tradeId
    ]);
    if (existing.rows[0]) {
      if (String(existing.rows[0].user_id) !== input.userId) {
        throw forbidden("tradeId already belongs to another user.");
      }
      await client.query("COMMIT");
      return mapTrade(existing.rows[0]);
    }

    const computed = await computeDerivedFields(client, input);
    await upsertSessionShell(client, input);

    const inserted = await client.query(
      `
      INSERT INTO trades(
        trade_id,
        user_id,
        session_id,
        asset,
        asset_class,
        direction,
        entry_price,
        exit_price,
        quantity,
        entry_at,
        exit_at,
        status,
        outcome,
        pnl,
        plan_adherence,
        emotional_state,
        entry_rationale,
        revenge_flag,
        source
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, 'api'
      )
      RETURNING *
      `,
      [
        input.tradeId,
        input.userId,
        input.sessionId,
        input.asset,
        input.assetClass,
        input.direction,
        input.entryPrice,
        input.exitPrice,
        input.quantity,
        input.entryAt,
        input.exitAt,
        input.status,
        computed.outcome,
        computed.pnl,
        input.planAdherence,
        input.emotionalState,
        input.entryRationale,
        computed.revengeFlag
      ]
    );

    await applySessionInsert(client, input, computed);
    await recordOutboxEvent(client, input.tradeId, input);
    await client.query("COMMIT");

    return mapTrade(inserted.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function refreshSession(
  client: pg.Pool | pg.PoolClient,
  sessionId: string
): Promise<void> {
  await client.query(
    `
    WITH summary AS (
      SELECT
        session_id,
        min(user_id::text)::uuid AS user_id,
        min(trader_name) AS trader_name,
        min(entry_at) AS first_entry_at,
        max(exit_at) AS last_exit_at,
        count(*)::integer AS trade_count,
        count(*) FILTER (WHERE outcome = 'win')::integer AS winning_trades,
        count(*) FILTER (WHERE outcome = 'loss')::integer AS losing_trades,
        coalesce(sum(pnl), 0) AS total_pnl,
        avg(plan_adherence) AS plan_adherence_avg
      FROM trades
      WHERE session_id = $1
      GROUP BY session_id
    )
    UPDATE sessions s
    SET
      user_id = summary.user_id,
      trader_name = summary.trader_name,
      first_entry_at = summary.first_entry_at,
      last_exit_at = summary.last_exit_at,
      trade_count = summary.trade_count,
      winning_trades = summary.winning_trades,
      losing_trades = summary.losing_trades,
      total_pnl = summary.total_pnl,
      plan_adherence_avg = summary.plan_adherence_avg,
      updated_at = now()
    FROM summary
    WHERE s.session_id = summary.session_id
    `,
    [sessionId]
  );
}

function parseTradeInput(body: unknown): TradeInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be an object.");
  }

  const data = body as Record<string, unknown>;
  const tradeId = requireUuid(data.tradeId, "tradeId");
  const userId = requireUuid(data.userId, "userId");
  const sessionId = requireUuid(data.sessionId, "sessionId");
  const asset = requireString(data.asset, "asset", 1, 32).toUpperCase();
  const assetClass = requireEnum(data.assetClass, "assetClass", ASSET_CLASSES);
  const direction = requireEnum(data.direction, "direction", DIRECTIONS);
  const entryPrice = requirePositiveNumber(data.entryPrice, "entryPrice");
  const quantity = requirePositiveNumber(data.quantity, "quantity");
  const entryAt = requireDate(data.entryAt, "entryAt");
  const status = requireEnum(data.status, "status", STATUSES);
  const exitPrice = optionalPositiveNumber(data.exitPrice, "exitPrice");
  const exitAt = optionalDate(data.exitAt, "exitAt");
  const planAdherence = optionalIntegerInRange(data.planAdherence, "planAdherence", 1, 5);
  const emotionalState = optionalEnum(data.emotionalState, "emotionalState", EMOTIONS);
  const entryRationale = optionalString(data.entryRationale, "entryRationale", 500);

  if (status === "closed" && (!exitAt || exitPrice === null)) {
    throw badRequest("Closed trades require exitAt and exitPrice.");
  }
  if (status !== "closed" && (exitAt || exitPrice !== null)) {
    throw badRequest("Only closed trades may include exitAt and exitPrice.");
  }

  return {
    tradeId,
    userId,
    sessionId,
    asset,
    assetClass: assetClass as TradeInput["assetClass"],
    direction: direction as TradeInput["direction"],
    entryPrice,
    exitPrice,
    quantity,
    entryAt,
    exitAt,
    status: status as TradeInput["status"],
    planAdherence,
    emotionalState: emotionalState as TradeInput["emotionalState"],
    entryRationale
  };
}

async function computeDerivedFields(
  client: pg.PoolClient,
  input: TradeInput
): Promise<{ pnl: number | null; outcome: string | null; revengeFlag: boolean }> {
  const pnl = input.status === "closed" ? computePnl(input) : null;
  const outcome = pnl === null ? null : pnl > 0 ? "win" : pnl < 0 ? "loss" : "breakeven";

  const previousLoss = await client.query(
    `
    SELECT trade_id
    FROM trades
    WHERE user_id = $1
      AND outcome = 'loss'
      AND exit_at IS NOT NULL
      AND exit_at <= $2
      AND exit_at >= ($2::timestamptz - interval '90 seconds')
    ORDER BY exit_at DESC
    LIMIT 1
    `,
    [input.userId, input.entryAt]
  );

  const revengeFlag =
    (previousLoss.rowCount ?? 0) > 0 &&
    (input.emotionalState === "anxious" || input.emotionalState === "fearful");

  return { pnl, outcome, revengeFlag };
}

function computePnl(input: TradeInput): number {
  const exitPrice = input.exitPrice;
  if (exitPrice === null) {
    throw badRequest("Closed trades require exitPrice.");
  }
  const diff =
    input.direction === "long"
      ? exitPrice - input.entryPrice
      : input.entryPrice - exitPrice;
  return Number((diff * input.quantity).toFixed(8));
}

async function upsertSessionShell(
  client: pg.PoolClient,
  input: TradeInput
): Promise<void> {
  const existingSession = await client.query(
    "SELECT user_id FROM sessions WHERE session_id = $1 FOR UPDATE",
    [input.sessionId]
  );
  if (
    existingSession.rows[0] &&
    String(existingSession.rows[0].user_id) !== input.userId
  ) {
    throw forbidden("sessionId already belongs to another user.");
  }

  await client.query(
    `
    INSERT INTO sessions(session_id, user_id, first_entry_at, last_exit_at)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (session_id)
    DO UPDATE SET
      first_entry_at = LEAST(sessions.first_entry_at, EXCLUDED.first_entry_at),
      last_exit_at = GREATEST(sessions.last_exit_at, EXCLUDED.last_exit_at),
      updated_at = now()
    `,
    [input.sessionId, input.userId, input.entryAt, input.exitAt]
  );
}

async function applySessionInsert(
  client: pg.PoolClient,
  input: TradeInput,
  computed: { pnl: number | null; outcome: string | null }
): Promise<void> {
  await client.query(
    `
    UPDATE sessions
    SET
      first_entry_at = LEAST(first_entry_at, $2),
      last_exit_at = GREATEST(last_exit_at, $3),
      trade_count = trade_count + 1,
      winning_trades = winning_trades + CASE WHEN $4 = 'win' THEN 1 ELSE 0 END,
      losing_trades = losing_trades + CASE WHEN $4 = 'loss' THEN 1 ELSE 0 END,
      total_pnl = total_pnl + coalesce($5::numeric, 0),
      plan_adherence_avg = CASE
        WHEN $6::integer IS NULL THEN plan_adherence_avg
        ELSE ((coalesce(plan_adherence_avg, 0) * trade_count) + $6::integer) / (trade_count + 1)
      END,
      updated_at = now()
    WHERE session_id = $1
    `,
    [
      input.sessionId,
      input.entryAt,
      input.exitAt,
      computed.outcome,
      computed.pnl,
      input.planAdherence
    ]
  );
}

async function recordOutboxEvent(
  client: pg.PoolClient,
  tradeId: string,
  input: TradeInput
): Promise<void> {
  await client.query(
    `
    INSERT INTO event_outbox(
      aggregate_type,
      aggregate_id,
      event_type,
      payload,
      idempotency_key
    )
    VALUES ('trade', $1, 'trade.created', $2::jsonb, $3)
    ON CONFLICT (idempotency_key) DO NOTHING
    `,
    [
      tradeId,
      JSON.stringify({ tradeId, userId: input.userId, sessionId: input.sessionId }),
      `trade.created:${tradeId}`
    ]
  );
}

function requireUuid(value: unknown, field: string): string {
  if (!isUuid(value)) {
    throw badRequest(`${field} must be a UUID.`);
  }
  return value;
}

function requireString(
  value: unknown,
  field: string,
  minLength: number,
  maxLength: number
): string {
  if (
    typeof value !== "string" ||
    value.length < minLength ||
    value.length > maxLength
  ) {
    throw badRequest(`${field} must be a string between ${minLength} and ${maxLength} characters.`);
  }
  return value;
}

function optionalString(
  value: unknown,
  field: string,
  maxLength: number
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string" || value.length > maxLength) {
    throw badRequest(`${field} must be a string up to ${maxLength} characters.`);
  }
  return value;
}

function requireEnum(value: unknown, field: string, options: Set<string>): string {
  if (typeof value !== "string" || !options.has(value)) {
    throw badRequest(`${field} has an unsupported value.`);
  }
  return value;
}

function optionalEnum(
  value: unknown,
  field: string,
  options: Set<string>
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return requireEnum(value, field, options);
}

function requirePositiveNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw badRequest(`${field} must be a positive number.`);
  }
  return value;
}

function optionalPositiveNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  return requirePositiveNumber(value, field);
}

function optionalIntegerInRange(
  value: unknown,
  field: string,
  min: number,
  max: number
): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw badRequest(`${field} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function requireDate(value: unknown, field: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw badRequest(`${field} must be an ISO date-time string.`);
  }
  return new Date(value).toISOString();
}

function optionalDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return requireDate(value, field);
}

function asNumber(value: unknown): number {
  return Number(value);
}

function asNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function toIso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(String(value)).toISOString();
}

function toNullableIso(value: unknown): string | null {
  return value === null || value === undefined ? null : toIso(value);
}
