import { chromium } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { seekAdapter } from '../../src/adapters/seek.js';
import type { SearchParams } from '../../src/adapters/types.js';

/**
 * specs/10-cicd-pipeline.md — the ONLY test in this repo allowed to hit the real
 * live site. Deliberately small scope (one page, one job) and deliberately run
 * only by .github/workflows/live-smoke-test.yml (weekly/manual), never ci.yml.
 * Do not add this to `npm test` or `npm run test:integration`.
 */
describe('SEEK live smoke test', () => {
  it('finds at least one job link and scrapes its detail page', async () => {
    const params: SearchParams = {
      keywords: 'software-engineer',
      cityLabel: 'Melbourne',
      citySlug: 'Melbourne-VIC-3000',
      dateRangeDays: 7,
      workType: 'full-time',
    };

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const searchUrl = seekAdapter.buildSearchUrl(params);

      const firstLink = await seekAdapter.listJobLinks(page, searchUrl).next();
      expect(firstLink.done).toBe(false);
      if (firstLink.done) return;

      const detail = await seekAdapter.scrapeJobDetail(page, firstLink.value.url);
      expect(detail.title.length).toBeGreaterThan(0);
      expect(detail.html.length).toBeGreaterThan(0);
    } finally {
      await browser.close();
    }
  }, 60_000);
});
