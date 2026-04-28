import os from "node:os";
import type pg from "pg";
import { createPool } from "../db/pool.js";
import {
  refreshAnalyticsForTrade,
  type TradeCreatedPayload
} from "../metrics/incremental.js";
import { createRedis, type AppRedisClient } from "../queue/redis.js";

const STREAM_NAME = "nevup:events";
const GROUP_NAME = "analytics-workers";
const WORKER_NAME = process.env.WORKER_NAME ?? `${os.hostname()}-${process.pid}`;
const BATCH_SIZE = Number(process.env.WORKER_BATCH_SIZE ?? 50);

const pool = createPool();
const redis = createRedis();
let stopping = false;

redis.on("error", (error) => {
  console.error(JSON.stringify({ event: "redis.error", error: String(error) }));
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await main();

async function main(): Promise<void> {
  await redis.connect();
  await ensureConsumerGroup(redis);
  console.log(
    JSON.stringify({
      event: "worker.started",
      stream: STREAM_NAME,
      group: GROUP_NAME,
      consumer: WORKER_NAME,
      batchSize: BATCH_SIZE
    })
  );

  while (!stopping) {
    await consumeStreamBatch(pool, redis, "0");
    await publishOutboxBatch(pool, redis);
    await consumeStreamBatch(pool, redis, ">");
  }
}

async function ensureConsumerGroup(client: AppRedisClient): Promise<void> {
  try {
    await client.xGroupCreate(STREAM_NAME, GROUP_NAME, "0", { MKSTREAM: true });
  } catch (error) {
    if (!String(error).includes("BUSYGROUP")) {
      throw error;
    }
  }
}

async function publishOutboxBatch(
  db: pg.Pool,
  client: AppRedisClient
): Promise<void> {
  const connection = await db.connect();
  try {
    await connection.query("BEGIN");
    const events = await connection.query(
      `
      SELECT event_id, aggregate_type, aggregate_id, event_type, payload
      FROM event_outbox
      WHERE published_at IS NULL
      ORDER BY created_at, event_id
      LIMIT $1
      FOR UPDATE SKIP LOCKED
      `,
      [BATCH_SIZE]
    );

    for (const row of events.rows) {
      await client.xAdd(STREAM_NAME, "*", {
        eventId: String(row.event_id),
        aggregateType: String(row.aggregate_type),
        aggregateId: String(row.aggregate_id),
        eventType: String(row.event_type),
        payload: JSON.stringify(row.payload)
      });
      await connection.query(
        "UPDATE event_outbox SET published_at = now() WHERE event_id = $1",
        [row.event_id]
      );
    }

    await connection.query("COMMIT");
    if (events.rowCount) {
      console.log(JSON.stringify({ event: "outbox.published", count: events.rowCount }));
    }
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
}

async function consumeStreamBatch(
  db: pg.Pool,
  client: AppRedisClient,
  id: "0" | ">"
): Promise<void> {
  const options = id === ">" ? { COUNT: BATCH_SIZE, BLOCK: 1000 } : { COUNT: BATCH_SIZE };
  const response = await client.xReadGroup(
    GROUP_NAME,
    WORKER_NAME,
    [{ key: STREAM_NAME, id }],
    options
  );
  if (!response) {
    return;
  }

  for (const stream of response) {
    for (const message of stream.messages) {
      await processMessage(db, client, message.id, message.message);
    }
  }
}

async function processMessage(
  db: pg.Pool,
  client: AppRedisClient,
  messageId: string,
  fields: Record<string, string>
): Promise<void> {
  const startedAt = Date.now();
  try {
    if (fields.eventType === "trade.created") {
      await refreshAnalyticsForTrade(db, parseTradeCreatedPayload(fields.payload));
    }
    await client.xAck(STREAM_NAME, GROUP_NAME, messageId);
    console.log(
      JSON.stringify({
        event: "analytics.processed",
        messageId,
        eventType: fields.eventType,
        latencyMs: Date.now() - startedAt
      })
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "analytics.failed",
        messageId,
        eventType: fields.eventType,
        error: String(error)
      })
    );
  }
}

function parseTradeCreatedPayload(value: string | undefined): TradeCreatedPayload {
  if (!value) {
    throw new Error("Missing trade.created payload.");
  }
  const parsed = JSON.parse(value) as Partial<TradeCreatedPayload>;
  if (!parsed.tradeId || !parsed.userId || !parsed.sessionId) {
    throw new Error("Invalid trade.created payload.");
  }
  return {
    tradeId: parsed.tradeId,
    userId: parsed.userId,
    sessionId: parsed.sessionId
  };
}

async function shutdown(): Promise<void> {
  stopping = true;
  await redis.quit();
  await pool.end();
  process.exit(0);
}
