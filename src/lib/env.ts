/**
 * Purpose: generic, low-level env-var helpers — the shared primitives every
 * other src/lib module builds its own env-backed getters on top of (specs/01:
 * only modules under src/lib/ may read process.env; src/adapters/** and
 * src/handlers/** call a lib helper instead, never process.env directly).
 * Exports: getRequiredEnv(name) — reads a var, throws if unset/empty;
 * parseIntEnv(value, fallback) — parses an optional numeric-string env value.
 * Used by: src/lib/config.ts, src/lib/dynamo.ts, src/lib/s3.ts, src/lib/sqs.ts.
 */

export function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function parseIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Expected an integer, got "${value}"`);
  }
  return parsed;
}
