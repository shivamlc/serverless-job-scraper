import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seekAdapter } from '../../src/adapters/seek.js';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src/adapters/seek.fixtures');

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8');
}

/**
 * specs/11-testing-strategy.md — this is the one test that exercises real
 * multi-page pagination navigation (page 1 → page 2 → terminate), which the
 * fixture-based unit tests deliberately don't cover (spec 03). Still zero real
 * network: page.route() serves a different fixture depending on whether the
 * requested URL is page 1 or page 2.
 */
describe('SEEK adapter pagination navigation (specs/03, specs/11)', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  it('walks from page 1 to page 2 and yields every job across both pages', async () => {
    const page = await browser.newPage();
    await page.route('**/*', (route) => {
      const isPageTwo = route.request().url().includes('page=2');
      const body = readFixture(isPageTwo ? 'results-page-last.html' : 'results-page.html');
      void route.fulfill({ status: 200, contentType: 'text/html', body });
    });

    const links: Array<{ jobId: string; url: string }> = [];
    for await (const link of seekAdapter.listJobLinks(page, 'https://fixture.test/search')) {
      links.push(link);
    }

    expect(links.map((l) => l.jobId)).toEqual(['11111111', '22222222', '33333333', '44444444']);

    await page.close();
  }, 30_000);
});
