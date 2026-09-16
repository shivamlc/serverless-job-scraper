# Spec 03 — SEEK Adapter

Ports the logic already proven in `../seek-scrape-jobs.spec.ts` into a `JobSiteAdapter` implementation. Behavior should match that script exactly except where explicitly changed below (parameterization, generator shape, HTML capture).

## `buildSearchUrl(params: SearchParams): string`

Produces a URL of the shape:
```
https://au.seek.com/{keywords}-jobs/in-{citySlug}/{workType}?daterange={dateRangeDays}&salaryrange={salaryMin}-{salaryMax}&salarytype={salaryType}&workarrangement={codes}
```

- `workarrangement` codes: map `SearchParams.workArrangement` entries via `{ onsite: 1, hybrid: 2, remote: 3 }`, comma-joined. **This mapping is a best-effort guess at SEEK's actual codes** (the current hardcoded value `1,2,3` implies "all three," which is consistent with this mapping but doesn't confirm which number means what) — verify against a real SEEK search before relying on filtering by a subset of arrangements in production; until verified, only "all three" (the current default) is trustworthy.
- Omit `salaryrange`/`salarytype` query params entirely if `salaryMin`/`salaryMax` are undefined; omit `workarrangement` if the array is empty/undefined.
- Must produce **byte-identical output** to today's hardcoded fallback URL when called with the default `SearchParams` from spec 01 (this is the regression check that the refactor didn't change behavior).

## `listJobLinks(page, searchUrl)`

Ports the outer `while (hasNextPage)` loop (`seek-scrape-jobs.spec.ts:33-181`), restructured as an `AsyncGenerator<JobLink>`:

1. For `pageNum` starting at 1: navigate to `pageNum === 1 ? searchUrl : ${searchUrl}&page=${pageNum}` with retry (see Retry policy below).
2. `await page.waitForTimeout(2000)` after navigation (matches today's behavior — SEEK's listing is client-rendered).
3. Extract job cards via `page.$$eval('article[data-card-type="JobCard"] a[data-automation="jobTitle"]', ...)`, parsing `jobId` from the `jobId=(\d+)` pattern in the href.
4. If zero job cards found, stop (no more pages) — do not yield, do not increment.
5. Otherwise, `yield` a `JobLink` for each card found on this page, then check for a next-page control (`[data-automation="page-next"], a[aria-label="Next"], button[aria-label="Next"], [aria-label="Go to next page"]`); continue if present+enabled, or if the page returned a full page of results (≥20) even though no next-page control was detected (today's existing fallback heuristic).
6. **Explicitly does not** navigate into any job's detail page — that responsibility moved to `scrapeJobDetail` / Lambda B.

## `scrapeJobDetail(page, url)`

Ports the per-job `page.evaluate()` block (`seek-scrape-jobs.spec.ts:75-135`):

1. Navigate to `url` with retry.
2. `await page.waitForTimeout(1500)`.
3. Run the existing DOM-walking `page.evaluate()` — same heading/section/list extraction logic, unchanged — to get `title`, `company`, `location`, `salary`, `workType`, `postedDate`, `sections`, `fullText`.
4. Capture `const html = await page.content()` **after** the evaluate call (same loaded state), included in the returned `ScrapedJobDetail` as `html`.
5. Parse `jobId` from `url`'s `jobId=(\d+)` pattern; set `listingUrl = url`.
6. Return the full `ScrapedJobDetail`.

## Retry policy (shared helper, used by both methods)

Port the existing retry logic verbatim: up to 4 attempts per navigation, only retrying on network-shaped errors (`ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|interrupted by another navigation`), with `attempt * 5000`ms backoff between attempts. Exhausting retries throws (per spec 02, contract item 6).

## Fixtures for testing (spec 11)

- `src/adapters/seek.fixtures/results-page.html` — a scrubbed real SEEK results page with at least 2 `article[data-card-type="JobCard"]` entries and a `[data-automation="page-next"]` control, used to unit-test `listJobLinks`'s single-page extraction (not full pagination, which needs multiple fixture pages or a mocked `page.goto`).
- `src/adapters/seek.fixtures/results-page-last.html` — same shape but with no next-page control, to test pagination termination.
- `src/adapters/seek.fixtures/job-detail.html` — a scrubbed real job detail page with `[data-automation="jobAdDetails"]` and the field selectors listed above, used to unit-test `scrapeJobDetail`'s extraction.

## Acceptance criteria

- [ ] `buildSearchUrl(defaultParams)` equals today's hardcoded fallback URL string.
- [ ] `listJobLinks` yields the correct `JobLink[]` against `results-page.html` and correctly stops (no infinite loop, no exception) against `results-page-last.html`.
- [ ] `scrapeJobDetail` against `job-detail.html` produces the same field values a human reading that fixture would expect, plus a non-empty `html` string.
- [ ] Retry logic is exercised by a test that fails `page.goto` with a network-shaped error twice then succeeds, and asserts 3 total attempts occurred.
