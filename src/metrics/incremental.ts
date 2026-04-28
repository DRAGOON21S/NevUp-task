import type pg from "pg";
import { refreshSession } from "../api/tradeService.js";

export type TradeCreatedPayload = {
  tradeId: string;
  userId: string;
  sessionId: string;
};

export async function refreshAnalyticsForTrade(
  pool: pg.Pool,
  payload: TradeCreatedPayload
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const trade = await client.query(
      `
      SELECT trade_id, user_id, session_id, entry_at
      FROM trades
      WHERE trade_id = $1 AND user_id = $2 AND session_id = $3
      FOR UPDATE
      `,
      [payload.tradeId, payload.userId, payload.sessionId]
    );
    if (!trade.rows[0]) {
      await client.query("COMMIT");
      return;
    }

    await refreshSession(client, payload.sessionId);
    await refreshSessionTilt(client, payload.sessionId);
    await refreshOvertradingForTrade(client, payload.userId, payload.tradeId);
    await refreshTradePlanSnapshot(client, payload.userId, payload.tradeId);
    await refreshDailySnapshot(client, payload.userId, trade.rows[0].entry_at);
    await refreshEmotionalStats(client, payload.userId, trade.rows[0].entry_at);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function refreshSessionTilt(
  client: pg.PoolClient,
  sessionId: string
): Promise<void> {
  await client.query(
    `
    WITH ordered AS (
      SELECT
        trade_id,
        session_id,
        outcome,
        lag(outcome) OVER (
          PARTITION BY session_id
          ORDER BY entry_at, trade_id
        ) AS previous_outcome
      FROM trades
      WHERE session_id = $1
    ),
    tilt AS (
      SELECT
        session_id,
        count(*) FILTER (WHERE previous_outcome = 'loss')::numeric
          / nullif(count(*), 0)::numeric AS tilt_index
      FROM ordered
      GROUP BY session_id
    )
    UPDATE sessions s
    SET tilt_index = coalesce(t.tilt_index, 0), updated_at = now()
    FROM tilt t
    WHERE s.session_id = t.session_id
    `,
    [sessionId]
  );
}

async function refreshOvertradingForTrade(
  client: pg.PoolClient,
  userId: string,
  tradeId: string
): Promise<void> {
  const result = await client.query(
    `
    WITH current_trade AS (
      SELECT user_id, trade_id, entry_at
      FROM trades
      WHERE trade_id = $1 AND user_id = $2
    ),
    windowed AS (
      SELECT
        c.user_id,
        c.trade_id,
        c.entry_at AS detected_at,
        c.entry_at - interval '30 minutes' AS window_start_at,
        count(t.trade_id)::integer AS window_trade_count
      FROM current_trade c
      JOIN trades t
        ON t.user_id = c.user_id
        AND t.entry_at >= c.entry_at - interval '30 minutes'
        AND t.entry_at <= c.entry_at
      GROUP BY c.user_id, c.trade_id, c.entry_at
    )
    SELECT * FROM windowed
    `,
    [tradeId, userId]
  );

  const row = result.rows[0];
  if (!row || Number(row.window_trade_count) <= 10) {
    await client.query("DELETE FROM overtrading_events WHERE user_id = $1 AND trade_id = $2", [
      userId,
      tradeId
    ]);
    return;
  }

  await client.query(
    `
    INSERT INTO overtrading_events(
      user_id,
      trade_id,
      detected_at,
      window_start_at,
      window_trade_count
    )
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (user_id, trade_id)
    DO UPDATE SET
      detected_at = EXCLUDED.detected_at,
      window_start_at = EXCLUDED.window_start_at,
      window_trade_count = EXCLUDED.window_trade_count
    `,
    [
      row.user_id,
      row.trade_id,
      row.detected_at,
      row.window_start_at,
      row.window_trade_count
    ]
  );
}

async function refreshTradePlanSnapshot(
  client: pg.PoolClient,
  userId: string,
  tradeId: string
): Promise<void> {
  await client.query(
    `
    WITH target AS (
      SELECT exit_at
      FROM trades
      WHERE user_id = $1
        AND trade_id = $2
        AND status = 'closed'
        AND exit_at IS NOT NULL
        AND plan_adherence IS NOT NULL
    ),
    rolling AS (
      SELECT avg(plan_adherence)::numeric AS plan_adherence_score
      FROM (
        SELECT plan_adherence
        FROM trades, target
        WHERE user_id = $1
          AND status = 'closed'
          AND trades.exit_at IS NOT NULL
          AND plan_adherence IS NOT NULL
          AND trades.exit_at <= target.exit_at
        ORDER BY trades.exit_at DESC, entry_at DESC, trade_id DESC
        LIMIT 10
      ) recent
    )
    INSERT INTO metric_snapshots(user_id, bucket_at, granularity, plan_adherence_score)
    SELECT $1, target.exit_at, 'trade', rolling.plan_adherence_score
    FROM target, rolling
    ON CONFLICT (user_id, bucket_at, granularity)
    DO UPDATE SET
      plan_adherence_score = EXCLUDED.plan_adherence_score,
      computed_at = now()
    `,
    [userId, tradeId]
  );
}

async function refreshDailySnapshot(
  client: pg.PoolClient,
  userId: string,
  entryAt: Date
): Promise<void> {
  await client.query(
    `
    WITH target AS (
      SELECT date_trunc('day', $2::timestamptz) AS bucket_at
    ),
    daily AS (
      SELECT count(*) FILTER (WHERE revenge_flag)::integer AS revenge_trade_count
      FROM trades, target
      WHERE user_id = $1
        AND entry_at >= target.bucket_at
        AND entry_at < target.bucket_at + interval '1 day'
    ),
    overtrading AS (
      SELECT count(*)::integer AS overtrading_event_count
      FROM overtrading_events, target
      WHERE user_id = $1
        AND detected_at >= target.bucket_at
        AND detected_at < target.bucket_at + interval '1 day'
    )
    INSERT INTO metric_snapshots(
      user_id,
      bucket_at,
      granularity,
      revenge_trade_count,
      overtrading_event_count
    )
    SELECT
      $1,
      target.bucket_at,
      'day',
      daily.revenge_trade_count,
      overtrading.overtrading_event_count
    FROM target, daily, overtrading
    ON CONFLICT (user_id, bucket_at, granularity)
    DO UPDATE SET
      revenge_trade_count = EXCLUDED.revenge_trade_count,
      overtrading_event_count = EXCLUDED.overtrading_event_count,
      computed_at = now()
    `,
    [userId, entryAt]
  );
}

async function refreshEmotionalStats(
  client: pg.PoolClient,
  userId: string,
  entryAt: Date
): Promise<void> {
  await client.query(
    `
    INSERT INTO emotional_state_stats(
      user_id,
      emotional_state,
      bucket_at,
      granularity,
      wins,
      losses,
      breakeven,
      win_rate
    )
    SELECT
      user_id,
      emotional_state,
      '1970-01-01T00:00:00Z'::timestamptz,
      'all_time',
      count(*) FILTER (WHERE outcome = 'win')::integer,
      count(*) FILTER (WHERE outcome = 'loss')::integer,
      count(*) FILTER (WHERE outcome = 'breakeven')::integer,
      coalesce(
        count(*) FILTER (WHERE outcome = 'win')::numeric
          / nullif(count(*) FILTER (WHERE outcome IN ('win', 'loss')), 0)::numeric,
        0
      )
    FROM trades
    WHERE user_id = $1 AND emotional_state IS NOT NULL
    GROUP BY user_id, emotional_state
    ON CONFLICT (user_id, emotional_state, bucket_at, granularity)
    DO UPDATE SET
      wins = EXCLUDED.wins,
      losses = EXCLUDED.losses,
      breakeven = EXCLUDED.breakeven,
      win_rate = EXCLUDED.win_rate,
      computed_at = now()
    `,
    [userId]
  );

  await client.query(
    `
    WITH target AS (
      SELECT date_trunc('day', $2::timestamptz) AS bucket_at
    )
    INSERT INTO emotional_state_stats(
      user_id,
      emotional_state,
      bucket_at,
      granularity,
      wins,
      losses,
      breakeven,
      win_rate
    )
    SELECT
      t.user_id,
      t.emotional_state,
      target.bucket_at,
      'day',
      count(*) FILTER (WHERE t.outcome = 'win')::integer,
      count(*) FILTER (WHERE t.outcome = 'loss')::integer,
      count(*) FILTER (WHERE t.outcome = 'breakeven')::integer,
      coalesce(
        count(*) FILTER (WHERE t.outcome = 'win')::numeric
          / nullif(count(*) FILTER (WHERE t.outcome IN ('win', 'loss')), 0)::numeric,
        0
      )
    FROM trades t, target
    WHERE t.user_id = $1
      AND t.emotional_state IS NOT NULL
      AND t.entry_at >= target.bucket_at
      AND t.entry_at < target.bucket_at + interval '1 day'
    GROUP BY t.user_id, t.emotional_state, target.bucket_at
    ON CONFLICT (user_id, emotional_state, bucket_at, granularity)
    DO UPDATE SET
      wins = EXCLUDED.wins,
      losses = EXCLUDED.losses,
      breakeven = EXCLUDED.breakeven,
      win_rate = EXCLUDED.win_rate,
      computed_at = now()
    `,
    [userId, entryAt]
  );
}
