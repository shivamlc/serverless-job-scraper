import type { Page } from 'playwright-core';
import type { JobLink, JobSiteAdapter, ScrapedJobDetail, SearchParams } from './types.js';

/**
 * specs/03-seek-adapter.md — best-effort guess at SEEK's work-arrangement codes.
 * Only "all three" (today's default) is verified; do not rely on filtering by a
 * subset in production without confirming these codes against a real SEEK search.
 */
const WORK_ARRANGEMENT_CODES: Record<'onsite' | 'hybrid' | 'remote', number> = {
  onsite: 1,
  hybrid: 2,
  remote: 3,
};

const NETWORK_ERROR_PATTERN =
  /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|interrupted by another navigation/;

const MAX_NAV_ATTEMPTS = 4;

/** specs/03-seek-adapter.md — Retry policy (shared helper) */
async function gotoWithRetry(page: Page, url: string): Promise<void> {
  for (let attempt = 1; attempt <= MAX_NAV_ATTEMPTS; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      return;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const isNetworkError = NETWORK_ERROR_PATTERN.test(message);
      if (isNetworkError && attempt < MAX_NAV_ATTEMPTS) {
        await page.waitForTimeout(attempt * 5000);
        continue;
      }
      throw err;
    }
  }
}

function extractJobId(url: string): string {
  return url.match(/jobId=(\d+)/)?.[1] ?? '';
}

/** specs/03-seek-adapter.md — buildSearchUrl */
function buildSearchUrl(params: SearchParams): string {
  const url = new URL(
    `https://au.seek.com/${params.keywords}-jobs/in-${params.citySlug}/${params.workType}`
  );
  url.searchParams.set('daterange', String(params.dateRangeDays));
  if (params.salaryMin !== undefined && params.salaryMax !== undefined) {
    url.searchParams.set('salaryrange', `${params.salaryMin}-${params.salaryMax}`);
  }
  if (params.salaryType) {
    url.searchParams.set('salarytype', params.salaryType);
  }
  if (params.workArrangement && params.workArrangement.length > 0) {
    const codes = params.workArrangement.map((w) => WORK_ARRANGEMENT_CODES[w]).join(',');
    url.searchParams.set('workarrangement', codes);
  }
  return url.toString();
}

/** specs/03-seek-adapter.md — listJobLinks */
async function* listJobLinks(page: Page, searchUrl: string): AsyncGenerator<JobLink> {
  let pageNum = 1;
  let hasNextPage = true;

  while (hasNextPage) {
    const pageUrl = pageNum === 1 ? searchUrl : `${searchUrl}&page=${pageNum}`;
    await gotoWithRetry(page, pageUrl);
    await page.waitForTimeout(2000);

    const jobLinks = await page.$$eval(
      'article[data-card-type="JobCard"] a[data-automation="jobTitle"]',
      (anchors) =>
        anchors.map((a) => ({
          href: (a as HTMLAnchorElement).href,
          jobId: (a as HTMLAnchorElement).href.match(/jobId=(\d+)/)?.[1] ?? '',
        }))
    );

    if (jobLinks.length === 0) {
      break;
    }

    for (const { href, jobId } of jobLinks) {
      yield { jobId, url: href };
    }

    const nextButton = page.locator(
      '[data-automation="page-next"], a[aria-label="Next"], button[aria-label="Next"], [aria-label="Go to next page"]'
    );
    const nextCount = await nextButton.count();
    const nextDisabled = nextCount > 0 ? await nextButton.first().isDisabled() : true;
    hasNextPage = nextCount > 0 && !nextDisabled;
    if (!hasNextPage && jobLinks.length >= 20) {
      hasNextPage = true;
    }
    pageNum++;
  }
}

/** specs/03-seek-adapter.md — scrapeJobDetail (DOM-walking logic ported verbatim from seek-scrape-jobs.spec.ts) */
async function scrapeJobDetail(page: Page, url: string): Promise<ScrapedJobDetail> {
  await gotoWithRetry(page, url);
  await page.waitForTimeout(1500);

  const detail = await page.evaluate(() => {
    const text = (sel: string) => document.querySelector(sel)?.textContent?.trim() ?? '';

    const adRoot = document.querySelector('[data-automation="jobAdDetails"]');
    const sections: { heading: string; content: string }[] = [];

    if (adRoot) {
      let currentHeading = '(intro)';
      let currentLines: string[] = [];

      const flush = () => {
        const content = currentLines.join('\n').trim();
        if (content) sections.push({ heading: currentHeading, content });
        currentLines = [];
      };

      const walk = (node: Element) => {
        for (const child of Array.from(node.childNodes)) {
          if (child.nodeType === Node.ELEMENT_NODE) {
            const el = child as Element;
            const tag = el.tagName.toLowerCase();
            if (/^h[1-6]$/.test(tag) || (tag === 'strong' && el.closest('p') === null)) {
              flush();
              currentHeading = el.textContent?.trim() ?? currentHeading;
            } else if (tag === 'li') {
              const t = el.textContent?.trim();
              if (t) currentLines.push(`• ${t}`);
            } else if (tag === 'p' || tag === 'div' || tag === 'span') {
              const directText = Array.from(el.childNodes)
                .filter((n) => n.nodeType === Node.TEXT_NODE)
                .map((n) => n.textContent?.trim())
                .filter(Boolean)
                .join(' ');
              if (directText) currentLines.push(directText);
              walk(el);
            } else {
              walk(el);
            }
          } else if (child.nodeType === Node.TEXT_NODE) {
            const t = child.textContent?.trim();
            if (t) currentLines.push(t);
          }
        }
      };

      walk(adRoot);
      flush();
    }

    return {
      title: text('[data-automation="job-detail-title"]'),
      company: text('[data-automation="advertiser-name"]'),
      location: text('[data-automation="job-detail-location"]'),
      salary: text('[data-automation="job-detail-salary"]'),
      workType: text('[data-automation="job-detail-work-type"]'),
      postedDate: text('[data-automation="job-detail-date"]'),
      sections,
      fullText: adRoot?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    };
  });

  const html = await page.content();

  return {
    ...detail,
    jobId: extractJobId(url),
    listingUrl: url,
    html,
  };
}

export const seekAdapter: JobSiteAdapter = {
  source: 'seek',
  buildSearchUrl,
  listJobLinks,
  scrapeJobDetail,
};
