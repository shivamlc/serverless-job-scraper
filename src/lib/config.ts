import type { SearchParams } from '../adapters/types.js';
import { parseIntEnv } from './env.js';

/**
 * Purpose: the ONLY place in this repo allowed to read process.env for
 * site-search configuration (specs/01-search-params-and-config.md), plus the
 * one operational (non-search) setting Lambda A needs from the environment.
 * Exports: loadSearchParamsFromEnv() — called once, at the top of a local
 * entrypoint (never inside src/adapters/** or src/handlers/**), producing a
 * plain SearchParams object that flows down as a function argument from there;
 * getSkipWindowHours() — how many hours before a job is re-scraped (specs/04).
 * Used by: getSkipWindowHours() is used by src/handlers/listJobs.ts.
 * loadSearchParamsFromEnv() is used by ../../scripts/scrapeLocal.ts for local/
 * manual runs — Lambda gets SearchParams from its EventBridge event instead
 * (specs/01's "production config source").
 */

const WORK_TYPES = ['full-time', 'part-time', 'contract', 'casual'] as const;
type WorkType = (typeof WORK_TYPES)[number];

const SALARY_TYPES = ['annual', 'hourly'] as const;
type SalaryType = (typeof SALARY_TYPES)[number];

const WORK_ARRANGEMENTS = ['onsite', 'hybrid', 'remote'] as const;
type WorkArrangement = (typeof WORK_ARRANGEMENTS)[number];

function assertOneOf<T extends string>(value: string, allowed: readonly T[], envVarName: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`${envVarName}="${value}" is invalid — must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

export function loadSearchParamsFromEnv(): SearchParams {
  const workType = assertOneOf<WorkType>(
    process.env.SCRAPE_WORK_TYPE ?? 'full-time',
    WORK_TYPES,
    'SCRAPE_WORK_TYPE'
  );
  const salaryType = assertOneOf<SalaryType>(
    process.env.SCRAPE_SALARY_TYPE ?? 'annual',
    SALARY_TYPES,
    'SCRAPE_SALARY_TYPE'
  );
  const workArrangement = (process.env.SCRAPE_WORK_ARRANGEMENT ?? 'onsite,hybrid,remote')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => assertOneOf<WorkArrangement>(s, WORK_ARRANGEMENTS, 'SCRAPE_WORK_ARRANGEMENT'));

  return {
    keywords: process.env.SCRAPE_KEYWORDS ?? 'software-engineer',
    cityLabel: process.env.SCRAPE_CITY_LABEL ?? 'Melbourne',
    citySlug: process.env.SCRAPE_CITY_SLUG ?? 'Melbourne-VIC-3000',
    dateRangeDays: parseIntEnv(process.env.SCRAPE_DATE_RANGE_DAYS, 7),
    workType,
    salaryMin: parseIntEnv(process.env.SCRAPE_SALARY_MIN, 0),
    salaryMax: parseIntEnv(process.env.SCRAPE_SALARY_MAX, 150000),
    salaryType,
    workArrangement,
  };
}

/**
 * specs/04-lambda-list-jobs.md — operational tuning (how aggressively to re-scrape),
 * not site-search configuration, but still resolved here (not in the handler) so
 * src/handlers/** never touches process.env at all.
 */
export function getSkipWindowHours(): number {
  return parseIntEnv(process.env.SKIP_IF_SCRAPED_WITHIN_HOURS, 24);
}
