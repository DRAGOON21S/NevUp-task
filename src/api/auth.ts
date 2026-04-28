import { createHmac, timingSafeEqual } from "node:crypto";
import { loadEnv } from "../config/env.js";
import { forbidden, unauthorized } from "./errors.js";

export type AuthClaims = {
  sub: string;
  iat: number;
  exp: number;
  role: "trader";
  name?: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireAuth(headers: {
  authorization?: string | string[] | undefined;
}): AuthClaims {
  const authorization = Array.isArray(headers.authorization)
    ? headers.authorization[0]
    : headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    throw unauthorized();
  }

  return verifyJwt(authorization.slice("Bearer ".length));
}

export function assertTenant(claims: AuthClaims, requestedUserId: string): void {
  if (claims.sub !== requestedUserId) {
    throw forbidden();
  }
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function verifyJwt(token: string): AuthClaims {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw unauthorized();
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseBase64Json(encodedHeader);
  const payload = parseBase64Json(encodedPayload);

  if (header.alg !== "HS256" || header.typ !== "JWT") {
    throw unauthorized();
  }

  const env = loadEnv();
  const expected = base64url(
    createHmac("sha256", env.jwtSecret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest()
  );

  if (!safeEqual(expected, encodedSignature)) {
    throw unauthorized();
  }

  if (!isUuid(payload.sub)) {
    throw unauthorized();
  }
  if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) {
    throw unauthorized();
  }
  const iat = payload.iat as number;
  const exp = payload.exp as number;
  if (exp <= Math.floor(Date.now() / 1000)) {
    throw unauthorized("JWT has expired.");
  }
  if (payload.role !== "trader") {
    throw unauthorized();
  }

  return {
    sub: payload.sub,
    iat,
    exp,
    role: payload.role,
    ...(typeof payload.name === "string" ? { name: payload.name } : {})
  };
}

function parseBase64Json(value: string): Record<string, unknown> {
  try {
    const json = Buffer.from(value, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid json");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw unauthorized();
  }
}

function base64url(value: Buffer): string {
  return value
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
