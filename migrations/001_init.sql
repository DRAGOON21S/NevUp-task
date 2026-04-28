CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  trader_name text,
  first_entry_at timestamptz NOT NULL,
  last_exit_at timestamptz,
  trade_count integer NOT NULL DEFAULT 0,
  winning_trades integer NOT NULL DEFAULT 0,
  losing_trades integer NOT NULL DEFAULT 0,
  total_pnl numeric(18,8) NOT NULL DEFAULT 0,
  plan_adherence_avg numeric(10,4),
  tilt_index numeric(10,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trades (
  trade_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  trader_name text,
  session_id uuid NOT NULL REFERENCES sessions(session_id),
  asset text NOT NULL,
  asset_class text NOT NULL CHECK (asset_class IN ('equity', 'crypto', 'forex')),
  direction text NOT NULL CHECK (direction IN ('long', 'short')),
  entry_price numeric(18,8) NOT NULL CHECK (entry_price > 0),
  exit_price numeric(18,8) CHECK (exit_price IS NULL OR exit_price > 0),
  quantity numeric(18,8) NOT NULL CHECK (quantity > 0),
  entry_at timestamptz NOT NULL,
  exit_at timestamptz,
  status text NOT NULL CHECK (status IN ('open', 'closed', 'cancelled')),
  outcome text CHECK (outcome IS NULL OR outcome IN ('win', 'loss', 'breakeven')),
  pnl numeric(18,8),
  plan_adherence integer CHECK (plan_adherence IS NULL OR plan_adherence BETWEEN 1 AND 5),
  emotional_state text CHECK (
    emotional_state IS NULL OR emotional_state IN ('calm', 'anxious', 'greedy', 'fearful', 'neutral')
  ),
  entry_rationale text CHECK (entry_rationale IS NULL OR char_length(entry_rationale) <= 500),
  revenge_flag boolean NOT NULL DEFAULT false,
  ground_truth_pathologies text[] NOT NULL DEFAULT '{}',
  source text NOT NULL DEFAULT 'seed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS debriefs (
  debrief_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(session_id),
  user_id uuid NOT NULL,
  notes text NOT NULL,
  lessons text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS metric_snapshots (
  snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  bucket_at timestamptz NOT NULL,
  granularity text NOT NULL CHECK (granularity IN ('trade', 'session', 'day')),
  plan_adherence_score numeric(10,4),
  revenge_trade_count integer NOT NULL DEFAULT 0,
  session_tilt_index numeric(10,4),
  overtrading_event_count integer NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, bucket_at, granularity)
);

CREATE TABLE IF NOT EXISTS emotional_state_stats (
  user_id uuid NOT NULL,
  emotional_state text NOT NULL CHECK (emotional_state IN ('calm', 'anxious', 'greedy', 'fearful', 'neutral')),
  bucket_at timestamptz NOT NULL,
  granularity text NOT NULL CHECK (granularity IN ('all_time', 'day')),
  wins integer NOT NULL DEFAULT 0,
  losses integer NOT NULL DEFAULT 0,
  breakeven integer NOT NULL DEFAULT 0,
  win_rate numeric(10,4) NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, emotional_state, bucket_at, granularity)
);

CREATE TABLE IF NOT EXISTS overtrading_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  trade_id uuid NOT NULL REFERENCES trades(trade_id),
  detected_at timestamptz NOT NULL,
  window_start_at timestamptz NOT NULL,
  window_trade_count integer NOT NULL CHECK (window_trade_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, trade_id)
);

CREATE TABLE IF NOT EXISTS event_outbox (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS worker_checkpoints (
  worker_name text PRIMARY KEY,
  stream_name text NOT NULL,
  consumer_group text NOT NULL,
  last_message_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trades_user_entry_at ON trades(user_id, entry_at);
CREATE INDEX IF NOT EXISTS idx_trades_user_exit_at ON trades(user_id, exit_at);
CREATE INDEX IF NOT EXISTS idx_trades_session_entry_at ON trades(session_id, entry_at);
CREATE INDEX IF NOT EXISTS idx_trades_user_emotion_exit_at ON trades(user_id, emotional_state, exit_at);
CREATE INDEX IF NOT EXISTS idx_metric_snapshots_user_bucket_granularity
  ON metric_snapshots(user_id, bucket_at, granularity);
CREATE INDEX IF NOT EXISTS idx_overtrading_events_user_detected_at
  ON overtrading_events(user_id, detected_at);
CREATE INDEX IF NOT EXISTS idx_event_outbox_unpublished
  ON event_outbox(created_at)
  WHERE published_at IS NULL;
