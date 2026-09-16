/**
 * specs/01-search-params-and-config.md — only modules under src/lib/ may read
 * process.env. src/adapters/** and src/handlers/** call a lib helper instead
 * (e.g. getSkipWindowHours(), getJobScrapeQueueUrl()), never process.env directly.
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
