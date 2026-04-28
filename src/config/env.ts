import "dotenv/config";

export type AppEnv = {
  databaseUrl: string;
  redisUrl: string;
  seedCsvPath: string;
  nodeEnv: string;
};

export function loadEnv(): AppEnv {
  return {
    databaseUrl:
      process.env.DATABASE_URL ?? "postgres://nevup:nevup@localhost:5432/nevup",
    redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
    seedCsvPath: process.env.SEED_CSV_PATH ?? "data/nevup_seed_dataset.csv",
    nodeEnv: process.env.NODE_ENV ?? "development"
  };
}
