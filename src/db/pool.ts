import pg from "pg";
import { loadEnv } from "../config/env.js";

const { Pool } = pg;

export function createPool(): pg.Pool {
  const env = loadEnv();

  return new Pool({
    connectionString: env.databaseUrl,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  });
}
