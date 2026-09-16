# Spec 04 — Lambda A: `list-jobs`

## Trigger & input event

Invoked directly by EventBridge Scheduler, one schedule per configured source (see spec 09). Event shape:

```ts
interface ListJobsEvent {
  source: JobSource;       // e.g. "seek"
  searchParams: SearchParams; // see spec 01
}
```

## Behavior

1. `const adapter = getAdapter(event.source)` — let it throw on an unknown source (spec 02).
2. `const searchUrl = adapter.buildSearchUrl(event.searchParams)`.
3. Launch a browser (`@sparticuz/chromium` + `playwright-core` in the Lambda runtime; a normal local Chromium in dev/tests — see spec 09 for packaging).
4. `for await (const { jobId, url } of adapter.listJobLinks(page, searchUrl))`:
   a. **Skip-check**: `Query` the DynamoDB `listingUrl-index` GSI (spec 06) for `listingUrl = url`. If a matching item exists with `scrapedAt` within the configured freshness window (default: 24h — see Constants below), skip this job (do not enqueue).
   b. Otherwise, buffer `{ source: event.source, jobId, url, cityLabel: event.searchParams.cityLabel }` for enqueueing.
   c. Flush the buffer via `SendMessageBatch` every 10 messages (SQS's per-call batch limit), and once more at the end for any remainder.
5. Close the browser. Return `{ jobsFound, jobsEnqueued, jobsSkipped }` as the Lambda result (useful for CloudWatch Logs / manual runs, not consumed by anything downstream). Per-page counts aren't tracked — `listJobLinks` yields per-job, not per-page, and adding a page counter to the adapter interface isn't worth the complexity for a number nothing consumes; page-by-page progress is still visible in CloudWatch Logs via the adapter's own navigation logging.

## Constants

- `SKIP_IF_SCRAPED_WITHIN_HOURS`, default `24`: operational tuning (how aggressively to re-scrape), not site-search configuration. Resolved via `getSkipWindowHours()` in `src/lib/config.ts` (which reads the `SKIP_IF_SCRAPED_WITHIN_HOURS` env var, defaulting to 24) — the handler calls this helper rather than reading `process.env` itself, keeping `src/handlers/**` free of any direct environment access (spec 01).

## SQS message schema (`job-scrape-queue`)

```ts
interface JobScrapeMessage {
  source: JobSource;
  jobId: string;
  url: string;
  cityLabel: string; // carried forward so Lambda B doesn't need SearchParams at all
}
```

## Error handling

- A failed page navigation inside `listJobLinks` that exhausts its own retries (spec 03) propagates up and fails the whole Lambda A invocation — EventBridge Scheduler's own retry policy (configured in Terraform, spec 09) handles re-running the whole listing walk. There is no partial/resume state for Lambda A; a re-run naturally re-does the (cheap) page walk and re-applies the skip-check, so a full retry is inexpensive.
- A `SendMessageBatch` call that partially fails (some message IDs rejected) must log the failed IDs and throw, rather than silently dropping jobs.

## Timeout budget

Lambda timeout: 5 minutes (generous headroom over the "well under 15 min" expectation from the roadmap for a few dozen pages; adjust upward only if real runs approach it, per spec 00's non-goal of over-provisioning upfront).

## Acceptance criteria

- [ ] Given a fixture-backed adapter returning 25 job links across 2 pages, and a mocked DynamoDB client reporting none as already-scraped, the handler sends exactly 3 `SendMessageBatch` calls (10 + 10 + 5) with `source`/`cityLabel` correctly populated on every message.
- [ ] Given a mocked DynamoDB client reporting some links as scraped within the freshness window, those are excluded from enqueued messages and counted in `jobsSkipped`.
- [ ] An unknown `event.source` throws before any browser is launched.
- [ ] `SKIP_IF_SCRAPED_WITHIN_HOURS` is honored from its env var when set, and defaults to 24 when unset.
