import { createClient, type RedisClientType } from "redis";
import { loadEnv } from "../config/env.js";

export type AppRedisClient = RedisClientType;

export function createRedis(): AppRedisClient {
  const env = loadEnv();
  return createClient({ url: env.redisUrl });
}
