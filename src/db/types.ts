import type { CsvRow } from "./csv.js";

export type SeedTrade = {
  tradeId: string;
  userId: string;
  traderName: string | null;
  sessionId: string;
  asset: string;
  assetClass: "equity" | "crypto" | "forex";
  direction: "long" | "short";
  entryPrice: string;
  exitPrice: string | null;
  quantity: string;
  entryAt: string;
  exitAt: string | null;
  status: "open" | "closed" | "cancelled";
  outcome: "win" | "loss" | "breakeven" | null;
  pnl: string | null;
  planAdherence: number | null;
  emotionalState: "calm" | "anxious" | "greedy" | "fearful" | "neutral" | null;
  entryRationale: string | null;
  revengeFlag: boolean;
  groundTruthPathologies: string[];
};

export function rowToSeedTrade(row: CsvRow): SeedTrade {
  return {
    tradeId: requireField(row, "tradeId"),
    userId: requireField(row, "userId"),
    traderName: nullableString(row.traderName),
    sessionId: requireField(row, "sessionId"),
    asset: requireField(row, "asset"),
    assetClass: parseEnum(row.assetClass, ["equity", "crypto", "forex"], "assetClass"),
    direction: parseEnum(row.direction, ["long", "short"], "direction"),
    entryPrice: requireField(row, "entryPrice"),
    exitPrice: nullableString(row.exitPrice),
    quantity: requireField(row, "quantity"),
    entryAt: requireField(row, "entryAt"),
    exitAt: nullableString(row.exitAt),
    status: parseEnum(row.status, ["open", "closed", "cancelled"], "status"),
    outcome: nullableEnum(row.outcome, ["win", "loss", "breakeven"], "outcome"),
    pnl: nullableString(row.pnl),
    planAdherence: nullableInteger(row.planAdherence),
    emotionalState: nullableEnum(
      row.emotionalState,
      ["calm", "anxious", "greedy", "fearful", "neutral"],
      "emotionalState"
    ),
    entryRationale: nullableString(row.entryRationale),
    revengeFlag: row.revengeFlag === "true",
    groundTruthPathologies: splitPathologies(row.groundTruthPathologies)
  };
}

function requireField(row: CsvRow, key: string): string {
  const value = row[key];
  if (!value) {
    throw new Error(`Missing required CSV field: ${key}`);
  }
  return value;
}

function nullableString(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function nullableInteger(value: string | undefined): number | null {
  const normalized = nullableString(value);
  return normalized === null ? null : Number.parseInt(normalized, 10);
}

function parseEnum<const T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  key: string
): T {
  if (allowed.includes(value as T)) {
    return value as T;
  }
  throw new Error(`Invalid ${key}: ${value ?? ""}`);
}

function nullableEnum<const T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  key: string
): T | null {
  const normalized = nullableString(value);
  return normalized === null ? null : parseEnum(normalized, allowed, key);
}

function splitPathologies(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
