import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getSkipWindowHours, loadSearchParamsFromEnv } from '../../src/lib/config.js';

const SCRAPE_ENV_VARS = [
  'SCRAPE_KEYWORDS',
  'SCRAPE_CITY_LABEL',
  'SCRAPE_CITY_SLUG',
  'SCRAPE_DATE_RANGE_DAYS',
  'SCRAPE_WORK_TYPE',
  'SCRAPE_SALARY_MIN',
  'SCRAPE_SALARY_MAX',
  'SCRAPE_SALARY_TYPE',
  'SCRAPE_WORK_ARRANGEMENT',
  'SKIP_IF_SCRAPED_WITHIN_HOURS',
];

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(SCRAPE_ENV_VARS.map((k) => [k, process.env[k]]));
  for (const k of SCRAPE_ENV_VARS) delete process.env[k];
});

afterEach(() => {
  for (const k of SCRAPE_ENV_VARS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('loadSearchParamsFromEnv (specs/01-search-params-and-config.md)', () => {
  it('returns documented defaults matching today\'s hardcoded behavior when nothing is set', () => {
    expect(loadSearchParamsFromEnv()).toEqual({
      keywords: 'software-engineer',
      cityLabel: 'Melbourne',
      citySlug: 'Melbourne-VIC-3000',
      dateRangeDays: 7,
      workType: 'full-time',
      salaryMin: 0,
      salaryMax: 150000,
      salaryType: 'annual',
      workArrangement: ['onsite', 'hybrid', 'remote'],
    });
  });

  it('overrides only the fields whose env var is set', () => {
    process.env.SCRAPE_CITY_LABEL = 'Sydney';
    process.env.SCRAPE_CITY_SLUG = 'Sydney-NSW-2000';
    process.env.SCRAPE_DATE_RANGE_DAYS = '14';

    const params = loadSearchParamsFromEnv();

    expect(params.cityLabel).toBe('Sydney');
    expect(params.citySlug).toBe('Sydney-NSW-2000');
    expect(params.dateRangeDays).toBe(14);
    expect(params.workType).toBe('full-time'); // untouched, still default
  });

  it('throws on an invalid SCRAPE_WORK_TYPE', () => {
    process.env.SCRAPE_WORK_TYPE = 'remote-only';
    expect(() => loadSearchParamsFromEnv()).toThrow(/SCRAPE_WORK_TYPE/);
  });

  it('throws on an invalid SCRAPE_SALARY_TYPE', () => {
    process.env.SCRAPE_SALARY_TYPE = 'weekly';
    expect(() => loadSearchParamsFromEnv()).toThrow(/SCRAPE_SALARY_TYPE/);
  });

  it('throws on a non-numeric SCRAPE_DATE_RANGE_DAYS', () => {
    process.env.SCRAPE_DATE_RANGE_DAYS = 'soon';
    expect(() => loadSearchParamsFromEnv()).toThrow(/integer/);
  });
});

describe('getSkipWindowHours (specs/04-lambda-list-jobs.md)', () => {
  it('defaults to 24', () => {
    expect(getSkipWindowHours()).toBe(24);
  });

  it('honors the env var when set', () => {
    process.env.SKIP_IF_SCRAPED_WITHIN_HOURS = '48';
    expect(getSkipWindowHours()).toBe(48);
  });
});
