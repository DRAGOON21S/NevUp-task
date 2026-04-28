import { readFile } from "node:fs/promises";
import { parseCsv } from "./csv.js";
import { createPool } from "./pool.js";
import { rowToSeedTrade, type SeedTrade } from "./types.js";
import { backfillSeedMetrics } from "../metrics/backfill.js";
import { loadEnv } from "../config/env.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const pool = createPool();

  try {
    const csv = await readFile(env.seedCsvPath, "utf8");
    const trades = parseCsv(csv).map(rowToSeedTrade);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await upsertSessions(client, trades);
      await upsertTrades(client, trades);
      await refreshSessions(client);
      await backfillSeedMetrics(client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const counts = await pool.query(`
      SELECT
        count(*)::integer AS trade_count,
        count(DISTINCT user_id)::integer AS user_count,
        count(DISTINCT session_id)::integer AS session_count
      FROM trades
    `);

    console.log({
      seededRows: trades.length,
      tradeCount: counts.rows[0]?.trade_count,
      userCount: counts.rows[0]?.user_count,
      sessionCount: counts.rows[0]?.session_count
    });
  } finally {
    await pool.end();
  }
}

async function upsertSessions(
  client: { query: (text: string, values?: unknown[]) => Promise<unknown> },
  trades: SeedTrade[]
): Promise<void> {
  const sessionRows = new Map<string, SeedTrade>();

  for (const trade of trades) {
    const existing = sessionRows.get(trade.sessionId);
    if (!existing || trade.entryAt < existing.entryAt) {
      sessionRows.set(trade.sessionId, trade);
    }
  }

  for (const trade of sessionRows.values()) {
    await client.query(
      `
      INSERT INTO sessions(
        session_id,
        user_id,
        trader_name,
        first_entry_at,
        last_exit_at
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (session_id)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        trader_name = EXCLUDED.trader_name,
        first_entry_at = LEAST(sessions.first_entry_at, EXCLUDED.first_entry_at),
        last_exit_at = GREATEST(sessions.last_exit_at, EXCLUDED.last_exit_at),
        updated_at = now()
      `,
      [trade.sessionId, trade.userId, trade.traderName, trade.entryAt, trade.exitAt]
    );
  }
}

async function upsertTrades(
  client: { query: (text: string, values?: unknown[]) => Promise<unknown> },
  trades: SeedTrade[]
): Promise<void> {
  for (const trade of trades) {
    await client.query(
      `
      INSERT INTO trades(
        trade_id,
        user_id,
        trader_name,
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
        ground_truth_pathologies,
        source
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, 'seed'
      )
      ON CONFLICT (trade_id)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        trader_name = EXCLUDED.trader_name,
        session_id = EXCLUDED.session_id,
        asset = EXCLUDED.asset,
        asset_class = EXCLUDED.asset_class,
        direction = EXCLUDED.direction,
        entry_price = EXCLUDED.entry_price,
        exit_price = EXCLUDED.exit_price,
        quantity = EXCLUDED.quantity,
        entry_at = EXCLUDED.entry_at,
        exit_at = EXCLUDED.exit_at,
        status = EXCLUDED.status,
        outcome = EXCLUDED.outcome,
        pnl = EXCLUDED.pnl,
        plan_adherence = EXCLUDED.plan_adherence,
        emotional_state = EXCLUDED.emotional_state,
        entry_rationale = EXCLUDED.entry_rationale,
        revenge_flag = EXCLUDED.revenge_flag,
        ground_truth_pathologies = EXCLUDED.ground_truth_pathologies,
        source = EXCLUDED.source,
        updated_at = now()
      `,
      [
        trade.tradeId,
        trade.userId,
        trade.traderName,
        trade.sessionId,
        trade.asset,
        trade.assetClass,
        trade.direction,
        trade.entryPrice,
        trade.exitPrice,
        trade.quantity,
        trade.entryAt,
        trade.exitAt,
        trade.status,
        trade.outcome,
        trade.pnl,
        trade.planAdherence,
        trade.emotionalState,
        trade.entryRationale,
        trade.revengeFlag,
        trade.groundTruthPathologies
      ]
    );
  }
}

async function refreshSessions(client: {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
}): Promise<void> {
  await client.query(`
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
  `);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
