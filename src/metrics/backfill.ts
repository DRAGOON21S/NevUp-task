import type pg from "pg";

export async function backfillSeedMetrics(client: pg.PoolClient): Promise<void> {
  await backfillSessionTilt(client);
  await backfillOvertradingEvents(client);
  await backfillPlanAdherenceSnapshots(client);
  await backfillEmotionalStateStats(client);
}

async function backfillSessionTilt(client: pg.PoolClient): Promise<void> {
  await client.query(`
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
    SET
      tilt_index = coalesce(t.tilt_index, 0),
      updated_at = now()
    FROM tilt t
    WHERE s.session_id = t.session_id
  `);
}

async function backfillPlanAdherenceSnapshots(client: pg.PoolClient): Promise<void> {
  await client.query("DELETE FROM metric_snapshots WHERE granularity IN ('trade', 'day')");

  await client.query(`
    WITH closed_trades AS (
      SELECT
        user_id,
        exit_at AS bucket_at,
        avg(plan_adherence) OVER (
          PARTITION BY user_id
          ORDER BY exit_at, entry_at, trade_id
          ROWS BETWEEN 9 PRECEDING AND CURRENT ROW
        ) AS plan_adherence_score
      FROM trades
      WHERE status = 'closed'
        AND exit_at IS NOT NULL
        AND plan_adherence IS NOT NULL
    )
    INSERT INTO metric_snapshots(user_id, bucket_at, granularity, plan_adherence_score)
    SELECT user_id, bucket_at, 'trade', max(plan_adherence_score)
    FROM closed_trades
    GROUP BY user_id, bucket_at
    ON CONFLICT (user_id, bucket_at, granularity)
    DO UPDATE SET
      plan_adherence_score = EXCLUDED.plan_adherence_score,
      computed_at = now()
  `);

  await client.query(`
    WITH daily AS (
      SELECT
        user_id,
        date_trunc('day', entry_at) AS bucket_at,
        count(*) FILTER (WHERE revenge_flag)::integer AS revenge_trade_count
      FROM trades
      GROUP BY user_id, date_trunc('day', entry_at)
    ),
    overtrading AS (
      SELECT
        user_id,
        date_trunc('day', detected_at) AS bucket_at,
        count(*)::integer AS overtrading_event_count
      FROM overtrading_events
      GROUP BY user_id, date_trunc('day', detected_at)
    )
    INSERT INTO metric_snapshots(
      user_id,
      bucket_at,
      granularity,
      revenge_trade_count,
      overtrading_event_count
    )
    SELECT
      d.user_id,
      d.bucket_at,
      'day',
      d.revenge_trade_count,
      coalesce(o.overtrading_event_count, 0)
    FROM daily d
    LEFT JOIN overtrading o
      ON o.user_id = d.user_id
      AND o.bucket_at = d.bucket_at
    ON CONFLICT (user_id, bucket_at, granularity)
    DO UPDATE SET
      revenge_trade_count = EXCLUDED.revenge_trade_count,
      overtrading_event_count = EXCLUDED.overtrading_event_count,
      computed_at = now()
  `);
}

async function backfillEmotionalStateStats(client: pg.PoolClient): Promise<void> {
  await client.query("DELETE FROM emotional_state_stats");

  await client.query(`
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
      (
        count(*) FILTER (WHERE outcome = 'win')::numeric
        / nullif(count(*) FILTER (WHERE outcome IN ('win', 'loss')), 0)::numeric
      )
    FROM trades
    WHERE emotional_state IS NOT NULL
    GROUP BY user_id, emotional_state
  `);

  await client.query(`
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
      date_trunc('day', entry_at),
      'day',
      count(*) FILTER (WHERE outcome = 'win')::integer,
      count(*) FILTER (WHERE outcome = 'loss')::integer,
      count(*) FILTER (WHERE outcome = 'breakeven')::integer,
      (
        count(*) FILTER (WHERE outcome = 'win')::numeric
        / nullif(count(*) FILTER (WHERE outcome IN ('win', 'loss')), 0)::numeric
      )
    FROM trades
    WHERE emotional_state IS NOT NULL
    GROUP BY user_id, emotional_state, date_trunc('day', entry_at)
  `);
}

async function backfillOvertradingEvents(client: pg.PoolClient): Promise<void> {
  await client.query("DELETE FROM overtrading_events");

  await client.query(`
    WITH windowed AS (
      SELECT
        current_trade.user_id,
        current_trade.trade_id,
        current_trade.entry_at AS detected_at,
        current_trade.entry_at - interval '30 minutes' AS window_start_at,
        count(previous_trade.trade_id)::integer AS window_trade_count
      FROM trades current_trade
      JOIN trades previous_trade
        ON previous_trade.user_id = current_trade.user_id
        AND previous_trade.entry_at >= current_trade.entry_at - interval '30 minutes'
        AND previous_trade.entry_at <= current_trade.entry_at
      GROUP BY current_trade.user_id, current_trade.trade_id, current_trade.entry_at
    )
    INSERT INTO overtrading_events(
      user_id,
      trade_id,
      detected_at,
      window_start_at,
      window_trade_count
    )
    SELECT user_id, trade_id, detected_at, window_start_at, window_trade_count
    FROM windowed
    WHERE window_trade_count > 10
    ON CONFLICT (user_id, trade_id)
    DO UPDATE SET
      detected_at = EXCLUDED.detected_at,
      window_start_at = EXCLUDED.window_start_at,
      window_trade_count = EXCLUDED.window_trade_count
  `);
}
