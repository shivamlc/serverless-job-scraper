/**
 * Purpose: the self-contained local entrypoint that actually drives a real SEEK
 * scrape end to end — load params → walk pages → scrape each job → write a JSON
 * file. This is the "Track A" piece described in ../NEXT-STEPS.md and
 * ../specs/03-seek-adapter.md: src/adapters/seek.ts was fully built and tested
 * against fixtures, but nothing outside tests ever exercised it against the real
 * site until this script existed.
 *
 * Deliberately lives under scripts/, not src/ — it's a one-off dev tool, not part
 * of the deployable Lambda image (tsconfig.build.json only includes src/).
 * Not under the src/adapters/**\/src/handlers/** process.env boundary (specs/01)
 * either, so it's free to read env vars directly for its own concerns
 * (SCRAPE_LOCAL_MAX_JOBS below) as long as SearchParams itself still comes from
 * loadSearchParamsFromEnv(), not ad-hoc process.env reads scattered around.
 *
 * Why this drains listJobLinks fully before scraping any job detail, rather than
 * interleaving (scrape a job right after finding its link, like the pipeline's
 * original single-script predecessor did): listJobLinks and scrapeJobDetail are
 * documented (specs/02) to each own the shared `page` for their own navigations
 * only. listJobLinks briefly leaves the page on a listing page between yields so
 * it can check for a next-page control when resumed; if a caller navigated that
 * same page to a job-detail URL in between, the next `next()` call would see the
 * wrong page and could terminate pagination early. Two phases — list everything,
 * then scrape everything — sidesteps that entirely and is simpler to reason
 * about for an occasional manual run where scrape-as-you-go performance doesn't matter.
 *
 * Usage:
 *   npm run scrape:local
 *   SCRAPE_CITY_LABEL=Sydney SCRAPE_CITY_SLUG=Sydney-NSW-2000 npm run scrape:local
 *   SCRAPE_LOCAL_MAX_JOBS=5 npm run scrape:local   # cap for a quick manual check
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { seekAdapter } from '../src/adapters/seek.js';
import type { JobLink, ScrapedJobDetail } from '../src/adapters/types.js';
import { loadSearchParamsFromEnv } from '../src/lib/config.js';

// Resolved against cwd (not import.meta.url — this compiles to CommonJS via
// tsconfig.scripts.json, which doesn't support import.meta) — `npm run
// scrape:local` always runs with cwd at the repo root, so this lands next to package.json.
const OUTPUT_FILE = resolve(process.cwd(), 'seek-job-results.local.json');

async function main(): Promise<void> {
  const params = loadSearchParamsFromEnv();
  const maxJobs = process.env.SCRAPE_LOCAL_MAX_JOBS
    ? Number.parseInt(process.env.SCRAPE_LOCAL_MAX_JOBS, 10)
    : undefined;

  console.log(`Searching: ${params.cityLabel} (${params.citySlug}), last ${params.dateRangeDays} days`);

  const browser = await chromium.launch({ headless: true });
  const results: ScrapedJobDetail[] = [];

  try {
    const listPage = await browser.newPage();
    const searchUrl = seekAdapter.buildSearchUrl(params);
    console.log(`Search URL: ${searchUrl}`);

    const links: JobLink[] = [];
    for await (const link of seekAdapter.listJobLinks(listPage, searchUrl)) {
      links.push(link);
      if (maxJobs && links.length >= maxJobs) break;
    }
    await listPage.close();
    console.log(`Found ${links.length} job link(s).`);

    const detailPage = await browser.newPage();
    for (const [i, link] of links.entries()) {
      console.log(`Scraping ${i + 1}/${links.length}: ${link.jobId}`);
      try {
        const detail = await seekAdapter.scrapeJobDetail(detailPage, link.url);
        results.push(detail);
      } catch (err) {
        console.warn(`  Failed to scrape ${link.jobId}:`, err instanceof Error ? err.message : err);
      }
    }
    await detailPage.close();
  } finally {
    await browser.close();
  }

  await writeFile(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\nDone. Scraped ${results.length} job(s) -> ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
