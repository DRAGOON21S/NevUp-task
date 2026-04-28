import "dotenv/config";

export type AppEnv = {
  databaseUrl: string;
  redisUrl: string;
  seedCsvPath: string;
  nodeEnv: string;
  port: number;
  jwtSecret: string;
  poolMax: number;
  requestLogSampleRate: number;
};

export function loadEnv(): AppEnv {
  return {
    databaseUrl:
      process.env.DATABASE_URL ?? "postgres://nevup:nevup@localhost:5432/nevup",
    redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
    seedCsvPath: process.env.SEED_CSV_PATH ?? "data/nevup_seed_dataset.csv",
    nodeEnv: process.env.NODE_ENV ?? "development",
    port: Number(process.env.PORT ?? 4010),
    jwtSecret:
      process.env.JWT_SECRET ??
      "97791d4db2aa5f689c3cc39356ce35762f0a73aa70923039d8ef72a2840a1b02",
    poolMax: Number(process.env.POOL_MAX ?? 50),
    requestLogSampleRate: Number(process.env.REQUEST_LOG_SAMPLE_RATE ?? 1)
  };
}
