# Spec 02 — `JobSiteAdapter` Interface & Registry

## Interface

```ts
// src/adapters/types.ts
import type { Page } from 'playwright-core';

export interface JobLink {
  jobId: string;
  url: string;
}

export interface ScrapedJobDetail {
  jobId: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  workType: string;
  listingUrl: string;
  postedDate: string;
  sections: Array<{ heading: string; content: string }>;
  fullText: string;
  html: string; // raw page.content() snapshot, captured at scrape time
}

export type JobSource = 'seek' | 'indeed' | 'linkedin';

export interface JobSiteAdapter {
  readonly source: JobSource;

  /** Translates common SearchParams into this site's own URL/query shape. Pure function, no I/O. */
  buildSearchUrl(params: SearchParams): string;

  /**
   * Walks all result pages for a search URL, yielding one JobLink per job found, across
   * as many pages as exist. Must not open any individual job listing page.
   */
  listJobLinks(page: Page, searchUrl: string): AsyncGenerator<JobLink>;

  /** Navigates to and scrapes one job's detail page, including a raw HTML snapshot. */
  scrapeJobDetail(page: Page, url: string): Promise<ScrapedJobDetail>;
}
```

## Registry

```ts
// src/adapters/index.ts
export function getAdapter(source: string): JobSiteAdapter;
```

- Throws `Error('No adapter registered for source "<source>"')` for any unregistered source — callers (both Lambda handlers) must let this throw propagate as a hard failure, not swallow it, since an unknown source means a config/deploy mistake, not a transient error.
- The registry is a plain object literal keyed by `JobSource`; adding an adapter is adding one entry, never touching existing entries.

## Contract every adapter must satisfy

1. **No ambient state.** `buildSearchUrl` takes `SearchParams` and returns a string — no `process.env`, no module-level mutable state.
2. **`listJobLinks` never opens a job detail page.** Only list/search-result pages. This boundary is what keeps Lambda A fast (see spec 04).
3. **`listJobLinks` terminates.** It must detect "no more pages" and stop yielding — an adapter that loops forever is a bug, not Lambda A's problem to catch.
4. **`scrapeJobDetail` is a single navigation.** One `page.goto`, then extraction — it must not itself paginate or follow more links.
5. **Idempotent extraction.** Calling `scrapeJobDetail` twice on the same URL must produce the same structured fields (barring genuine site content changes) — no side effects, no reliance on prior calls.
6. **Network retry, not silent failure.** Transient navigation errors (connection reset, DNS blip) should be retried a bounded number of times inside the adapter (see spec 03 for SEEK's specific retry policy); a failure that exhausts retries must throw, so the Lambda's own error handling / SQS redelivery takes over — an adapter must never return partial or empty data as if it succeeded.

## Acceptance criteria

- [ ] `getAdapter('seek')` returns the SEEK adapter.
- [ ] `getAdapter('bogus')` throws.
- [ ] TypeScript compilation fails if any adapter is missing a required method (interface, not duck-typed).
- [ ] `JobSiteAdapter`, `SearchParams`, `JobLink`, `ScrapedJobDetail` are all exported from `src/adapters/types.ts` and imported (not redeclared) everywhere else they're used.
