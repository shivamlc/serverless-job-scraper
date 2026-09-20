import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seekAdapter } from '../../src/adapters/seek.js';
import type { SearchParams } from '../../src/adapters/types.js';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src/adapters/seek.fixtures');

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8');
}

/**
 * specs/03-seek-adapter.md describes unit tests as loading fixtures via
 * page.setContent(). We use page.route() interception instead: it exercises the
 * adapter's real public methods (which do their own page.goto navigation) rather
 * than requiring a separate parse-only export, while still making zero real
 * network calls — same "networkless but real browser" goal, different mechanism.
 */
async function fulfillAllRequestsWith(page: Page, html: string): Promise<void> {
  await page.route('**/*', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: html })
  );
}

const DEFAULT_PARAMS: SearchParams = {
  keywords: 'software-engineer',
  cityLabel: 'Melbourne',
  citySlug: 'Melbourne-VIC-3000',
  dateRangeDays: 7,
  workType: 'full-time',
  salaryMin: 0,
  salaryMax: 150000,
  salaryType: 'annual',
  workArrangement: ['onsite', 'hybrid', 'remote'],
};

describe('seekAdapter (specs/03-seek-adapter.md)', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  it('buildSearchUrl matches today\'s hardcoded fallback URL for the default params', () => {
    const url = seekAdapter.buildSearchUrl(DEFAULT_PARAMS);
    expect(url).toBe(
      'https://au.seek.com/software-engineer-jobs/in-Melbourne-VIC-3000/full-time?daterange=7&salaryrange=0-150000&salarytype=annual&workarrangement=1%2C2%2C3'
    );
  });

  it('buildSearchUrl omits salary/work-arrangement params when unset', () => {
    const { salaryMin: _salaryMin, salaryMax: _salaryMax, salaryType: _salaryType, workArrangement: _workArrangement, ...rest } = DEFAULT_PARAMS;
    const url = seekAdapter.buildSearchUrl(rest);
    expect(url).not.toContain('salaryrange');
    expect(url).not.toContain('salarytype');
    expect(url).not.toContain('workarrangement');
    expect(url).toContain('daterange=7');
  });

  it('listJobLinks yields every job card on a single page', async () => {
    page = await browser.newPage();
    await fulfillAllRequestsWith(page, readFixture('results-page.html'));

    const links: Array<{ jobId: string; url: string }> = [];
    for await (const link of seekAdapter.listJobLinks(page, 'https://fixture.test/search')) {
      links.push(link);
      if (links.length === 3) break; // stop before the generator would walk to "page 2"
    }

    expect(links).toEqual([
      { jobId: '11111111', url: expect.stringContaining('/job/11111111') },
      { jobId: '22222222', url: expect.stringContaining('/job/22222222') },
      { jobId: '33333333', url: expect.stringContaining('/job/33333333') },
    ]);

    await page.close();
  });

  it('listJobLinks terminates on a page with no next-page control', async () => {
    page = await browser.newPage();
    await fulfillAllRequestsWith(page, readFixture('results-page-last.html'));

    const links: Array<{ jobId: string; url: string }> = [];
    for await (const link of seekAdapter.listJobLinks(page, 'https://fixture.test/search')) {
      links.push(link);
    }

    expect(links).toHaveLength(1);
    expect(links[0]?.jobId).toBe('44444444');

    await page.close();
  });

  it('scrapeJobDetail extracts fields and captures an HTML snapshot', async () => {
    page = await browser.newPage();
    await fulfillAllRequestsWith(page, readFixture('job-detail.html'));

    const url = 'https://fixture.test/job/99999999?type=standard';
    const result = await seekAdapter.scrapeJobDetail(page, url);

    expect(result.jobId).toBe('99999999');
    expect(result.listingUrl).toBe(url);
    expect(result.title).toBe('Senior Software Engineer');
    expect(result.company).toBe('Example Pty Ltd');
    expect(result.location).toBe('Melbourne VIC');
    expect(result.salary).toBe('$120,000 - $140,000');
    expect(result.workType).toBe('Full time');

    const requirements = result.sections.find((s) => s.heading === 'Requirements');
    expect(requirements?.content).toContain('• 5+ years professional software engineering experience');
    expect(requirements?.content).toContain('• Strong TypeScript and Node.js skills');

    expect(result.fullText).toContain('About the role');
    expect(result.html.length).toBeGreaterThan(0);
    expect(result.html).toContain('data-automation="jobAdDetails"');

    await page.close();
  });

  it(
    'retries navigation on a network-shaped failure before succeeding',
    async () => {
      page = await browser.newPage();
      const targetUrl = 'https://fixture.test/job/1?type=standard';
      let attempts = 0;
      // Routed to the exact target URL only, so an incidental favicon request
      // (unrouted, and thus simply failing silently) can't inflate the count.
      await page.route(targetUrl, (route) => {
        attempts++;
        if (attempts === 1) {
          void route.abort('internetdisconnected');
        } else {
          void route.fulfill({ status: 200, contentType: 'text/html', body: readFixture('job-detail.html') });
        }
      });

      const result = await seekAdapter.scrapeJobDetail(page, targetUrl);

      expect(attempts).toBe(2);
      expect(result.title).toBe('Senior Software Engineer');

      await page.close();
    },
    20_000
  );
});
