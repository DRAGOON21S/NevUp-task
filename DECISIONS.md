# Decisions

This document records the implementation choices that matter for hackathon review: correctness, performance, tenancy, and deployability.

## Track Focus

The implementation targets Track 1: Trade Journal backend.

The core goal is to accept close-event writes quickly, preserve idempotency, isolate tenant data by JWT subject, and expose analytics without making every write wait for full metric recomputation.

## Stack

- Runtime: Node.js with TypeScript.
- API: native Node HTTP server.
- Database: PostgreSQL 16.
- Queue: Redis Streams.
- Worker: separate Node process consuming Redis Stream events.
- Deployment: Render Blueprint in `render.yaml`.

The API intentionally avoids a heavy framework. The endpoint surface is small, and the native HTTP server keeps the hot write path predictable for the 200 writes/sec target.

## Data Model

Primary tables:

- `trades`: canonical trade journal records keyed by `trade_id`.
- `sessions`: session summaries keyed by `session_id`.
- `debriefs`: user debrief submissions.
- `metric_snapshots`: derived plan, tilt, revenge, and overtrading snapshots.
- `emotional_state_stats`: win-rate by emotional state.
- `overtrading_events`: detected overtrading windows.
- `event_outbox`: durable handoff from API transaction to Redis Stream.

The seed loader is idempotent. The provided CSV loads to `388` trades across `10` users and `52` sessions.

## Index Choices

The migration adds indexes around the endpoint access patterns:

- `idx_trades_user_entry_at` for metrics time windows by user.
- `idx_trades_user_exit_at` for exit-time behavioral lookups.
- `idx_trades_session_entry_at` for session trade lists.
- `idx_trades_user_emotion_exit_at` for emotional-state analytics.
- `idx_metric_snapshots_user_bucket_granularity` for derived time-series lookups.
- `idx_overtrading_events_user_detected_at` for metrics over date ranges.
- `idx_event_outbox_unpublished` for efficient worker polling of unpublished events.

These indexes support the read target while keeping write overhead moderate.

## Idempotency

`POST /trades` is idempotent by `tradeId`.

Behavior:

- If `tradeId` already exists for the same `userId`, the API returns the existing trade.
- If `tradeId` exists for another user, the API returns `403`.
- Outbox events use a unique `idempotency_key` of `trade.created:{tradeId}` so duplicate submissions do not enqueue duplicate analytics work.

## Tenancy

JWT auth uses HS256 and the provided shared hackathon secret.

The API enforces:

- `sub` must be a UUID.
- `role` must be `trader`.
- `iat` and `exp` must be valid integers.
- expired tokens return `401`.
- cross-tenant resource access returns `403`.

All user-owned endpoint handlers compare requested or stored `userId` against `claims.sub`.

## Write Path

The synchronous write path does only what must be transactionally correct:

1. Validate JWT and request body.
2. Check trade idempotency.
3. Check session ownership.
4. Compute basic P&L, outcome, and revenge flag.
5. Insert the trade.
6. Increment session counters in constant time.
7. Insert an outbox event.
8. Commit.

Full analytics refresh is handled asynchronously by the worker.

This keeps close-event writes below the p95 target while preserving durable analytics handoff.

## Queue Choice

Redis Streams is used because it gives the project:

- durable stream entries
- consumer groups
- explicit acknowledgement
- pending message recovery
- low operational weight for a hackathon deployment

The API writes to PostgreSQL `event_outbox` inside the same transaction as the trade insert. The worker then publishes unpublished outbox rows to Redis Streams and marks them as published. This avoids losing analytics events if Redis is briefly unavailable during an API write.

## Analytics Worker

The worker:

- creates/uses stream `nevup:events`
- creates/uses consumer group `analytics-workers`
- publishes pending `event_outbox` rows
- consumes `trade.created`
- refreshes affected session and user analytics
- acknowledges messages only after processing

The worker is intentionally separate from the API so analytics work cannot block the write response.

## Metrics Implemented

The metrics/profile surface includes:

- plan adherence score
- session tilt index
- win rate by emotional state
- revenge trade count
- overtrading event count
- P&L and win-rate time series
- dominant behavioral pathologies from seed labels
- strengths and peak performance window

## Observability

Each API request gets a trace ID returned in `x-trace-id`.

Errors return structured JSON:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable message.",
  "traceId": "uuid"
}
```

Successful request logging is configurable through `REQUEST_LOG_SAMPLE_RATE`; errors are always logged. This preserves observability while keeping console I/O from dominating load-test latency.

## Performance Evidence

Latest local Phase 5 run:

- Write target with API and analytics worker running:
  - `LOAD_RPS=200`
  - `LOAD_DURATION_SECONDS=60`
  - `LOAD_CONCURRENCY=100`
  - `LOAD_SESSION_COUNT=100`
  - `REQUEST_LOG_SAMPLE_RATE=0.01`
  - `12000` completed
  - `0` errors
  - p95 write latency `19ms`
- Read target:
  - `LOAD_READ_RPS=100`
  - `LOAD_READ_DURATION_SECONDS=60`
  - `LOAD_READ_CONCURRENCY=50`
  - `6000` completed
  - `0` errors
  - p95 read latency `6ms`

Synthetic load-test trades were removed afterward. The database was verified back at `388` trades, `52` sessions, and `0` unpublished outbox rows.

## Known Limitations

- The coaching SSE endpoint uses deterministic heuristic coaching text rather than calling an external LLM. This keeps the endpoint reliable and avoids adding network/API-key risk during judging.
- Metrics are designed around the supplied dataset and hackathon endpoint contract, not a generalized broker-grade reporting engine.
- The local load harness is intentionally simple and repo-native. It avoids requiring k6 installation while still proving the requested throughput and latency targets.
