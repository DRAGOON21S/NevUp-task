import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { ApiError } from "./errors.js";

export type RequestContext = {
  traceId: string;
  startedAt: number;
};

export type JsonResponse = {
  statusCode: number;
  body: unknown;
};

export function createContext(): RequestContext {
  return {
    traceId: randomUUID(),
    startedAt: Date.now()
  };
}

export async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "Request body must be valid JSON.");
  }
}

export function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
  traceId: string
): void {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "x-trace-id": traceId
  });
  res.end(JSON.stringify(body));
}

export function sendError(
  res: ServerResponse,
  error: unknown,
  traceId: string
): number {
  if (error instanceof ApiError) {
    sendJson(
      res,
      error.statusCode,
      { error: error.code, message: error.message, traceId },
      traceId
    );
    return error.statusCode;
  }

  console.error(JSON.stringify({ traceId, error }));
  sendJson(
    res,
    500,
    {
      error: "INTERNAL_SERVER_ERROR",
      message: "Unexpected server error.",
      traceId
    },
    traceId
  );
  return 500;
}

export function logRequest(args: {
  traceId: string;
  userId?: string;
  method?: string | undefined;
  path?: string | undefined;
  statusCode: number;
  latency: number;
}): void {
  console.log(JSON.stringify(args));
}
