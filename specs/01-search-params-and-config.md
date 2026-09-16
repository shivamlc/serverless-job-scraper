# Spec 01 — SearchParams & Configuration

## Rule (non-negotiable)

Code under `src/adapters/**` and `src/handlers/**` **must never read `process.env` directly** — no exceptions, including infra wiring like queue URLs/bucket names and operational tuning constants. Anything that needs an environment variable (site-search config, an AWS resource identifier, an operational threshold) is resolved by a small getter under `src/lib/` (`loadSearchParamsFromEnv()`, `getSkipWindowHours()`, `getJobScrapeQueueUrl()`, `getSnapshotBucketName()`, …) and called from there. All *site-search* configuration specifically flows through the `SearchParams` type below, passed as a plain function argument — that's the part of this rule motivated by the original ask ("don't hardcode Melbourne/7-days, but don't tightly couple scraping logic to env vars either").

This is what "config doesn't tightly couple to env vars" means in this repo: env vars are a config-*loading* detail at one specific edge, not something scraping logic is aware of.

## Type

```ts
// src/adapters/types.ts
export interface SearchParams {
  keywords: string;                     // e.g. "software-engineer" — category slug / free-text query
  cityLabel: string;                     // e.g. "Melbourne" — human-readable, stored on the DynamoDB item
  citySlug: string;                       // e.g. "Melbourne-VIC-3000" — site-specific slug, opaque to callers
  dateRangeDays: number;                    // e.g. 7
  workType: 'full-time' | 'part-time' | 'contract' | 'casual';
  salaryMin?: number;
  salaryMax?: number;
  salaryType?: 'annual' | 'hourly';
  workArrangement?: Array<'onsite' | 'hybrid' | 'remote'>;
}
```

## Local-dev env var mapping (`src/lib/config.ts`)

`loadSearchParamsFromEnv(): SearchParams` reads the following, applying the listed default when unset:

| Env var | Default | Notes |
|---|---|---|
| `SCRAPE_KEYWORDS` | `"software-engineer"` | |
| `SCRAPE_CITY_LABEL` | `"Melbourne"` | |
| `SCRAPE_CITY_SLUG` | `"Melbourne-VIC-3000"` | |
| `SCRAPE_DATE_RANGE_DAYS` | `7` | parsed as integer; throws on non-numeric input |
| `SCRAPE_WORK_TYPE` | `"full-time"` | must be one of the four literal values; throws otherwise |
| `SCRAPE_SALARY_MIN` | `0` | parsed as integer |
| `SCRAPE_SALARY_MAX` | `150000` | parsed as integer |
| `SCRAPE_SALARY_TYPE` | `"annual"` | `"annual"` \| `"hourly"` |
| `SCRAPE_WORK_ARRANGEMENT` | `"onsite,hybrid,remote"` | comma-separated, split + trimmed |

These defaults reproduce today's hardcoded behavior exactly (Melbourne, 7-day range, $0–150k annual, all work arrangements) — they exist so `loadSearchParamsFromEnv()` is safe to call with zero configuration, not so the values are baked into any adapter.

## Production (Lambda) config source

Lambda A receives `searchParams` directly in its invocation event (populated by Terraform from `var.sources[*].search_params` — see spec 09). It never calls `loadSearchParamsFromEnv()`. Lambda B never needs `SearchParams` at all — it receives a fully-formed job URL in its SQS message.

## Acceptance criteria

- [ ] `loadSearchParamsFromEnv()` returns the documented defaults when no relevant env vars are set.
- [ ] `loadSearchParamsFromEnv()` overrides only the fields whose env var is set.
- [ ] `loadSearchParamsFromEnv()` throws a clear error on an invalid `SCRAPE_WORK_TYPE` or `SCRAPE_SALARY_TYPE` (not a silent fallback).
- [ ] Zero references to `process.env` anywhere under `src/adapters/` or `src/handlers/`, with no exceptions (enforced by an ESLint rule scoped to those paths — see spec 11).
