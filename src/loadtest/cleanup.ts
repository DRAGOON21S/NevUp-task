import { createPool } from "../db/pool.js";
import { backfillSeedMetrics } from "../metrics/backfill.js";
import { createRedis } from "../queue/redis.js";

const marker = process.env.LOAD_MARKER ?? "Automated load test trade.";
const clearRedis = process.env.LOAD_CLEAR_REDIS_STREAM !== "false";
const pool = createPool();
const client = await pool.connect();

try {
  await client.query("BEGIN");

  const trades = await client.query(
    "SELECT trade_id, session_id FROM trades WHERE entry_rationale = $1",
    [marker]
  );
  const tradeIds = trades.rows.map((row) => row.trade_id);
  const sessionIds = [...new Set(trades.rows.map((row) => row.session_id))];

  if (tradeIds.length > 0) {
    await client.query("DELETE FROM overtrading_events WHERE trade_id = ANY($1::uuid[])", [
      tradeIds
    ]);
    await client.query("DELETE FROM event_outbox WHERE aggregate_id = ANY($1::uuid[])", [
      tradeIds
    ]);
    await client.query("DELETE FROM trades WHERE trade_id = ANY($1::uuid[])", [tradeIds]);
  }

  if (sessionIds.length > 0) {
    await client.query(
      `
      DELETE FROM sessions s
      WHERE s.session_id = ANY($1::uuid[])
        AND NOT EXISTS (
          SELECT 1 FROM trades t WHERE t.session_id = s.session_id
        )
      `,
      [sessionIds]
    );
  }

  await backfillSeedMetrics(client);
  await client.query("COMMIT");

  let deletedRedisStreams = 0;
  if (clearRedis) {
    deletedRedisStreams = await clearRedisStream();
  }

  console.log(
    JSON.stringify({
      marker,
      deletedTrades: tradeIds.length,
      candidateSessions: sessionIds.length,
      deletedRedisStreams
    })
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}

async function clearRedisStream(): Promise<number> {
  try {
    const redis = createRedis();
    await redis.connect();
    const deleted = await redis.del("nevup:events");
    await redis.quit();
    return deleted;
  } catch {
    return 0;
  }
}
