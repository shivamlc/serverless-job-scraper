# Spec 05 — Lambda B: `job-detail`

## Trigger & input event

SQS-triggered from `job-scrape-queue`, **batch size 1** for v1 (see spec 00 — raising this is explicitly out of scope until real volume justifies the added `batchItemFailures` complexity). Each invocation receives exactly one `JobScrapeMessage` (spec 04):

```ts
interface JobScrapeMessage {
  source: JobSource;
  jobId: string;
  url: string;
  cityLabel: string;
}
```

## Behavior

1. `const adapter = getAdapter(message.source)`.
2. Launch a browser (same packaging as Lambda A).
3. `const scraped = await adapter.scrapeJobDetail(page, message.url)`.
4. Construct the DynamoDB item (spec 06):
   ```ts
   const scrapedAt = new Date().toISOString();
   const jobKey = buildJobKey(message.source, scraped.jobId);
   const snapshotKey = `snapshots/${message.source}/${scraped.jobId}/${scrapedAt}.html`;
   ```
5. `PutObject` the raw `scraped.html` to S3 at `snapshotKey` **before** the DynamoDB write (so a DynamoDB write never references a snapshot that doesn't exist yet; if S3 fails, the whole invocation fails and SQS redelivers — no DynamoDB item is written for a missing snapshot).
6. `PutItem` to DynamoDB: `{ jobKey, scrapedAt, source: message.source, jobId: scraped.jobId, title, company, location, salary, workType, postedDate, listingUrl: scraped.listingUrl, sections, fullText, city: message.cityLabel, snapshotKey }`.
7. Close the browser.

## Error handling

- Any exception (adapter throw after exhausting its own retries, S3/DynamoDB failure) propagates and fails the invocation — SQS's standard visibility-timeout + redelivery mechanism retries it (up to `maxReceiveCount = 3`, per spec 07) before it lands in the DLQ.
- No partial writes: step 5 (S3) happens fully before step 6 (DynamoDB) starts, and step 6 is a single `PutItem` — there is no intermediate state where "half" a job is recorded.

## Timeout budget

Lambda timeout: 2 minutes (one navigation + one extraction; generous headroom over typical single-page-load time).

## Acceptance criteria

- [ ] Given a fixture-backed adapter and mocked S3/DynamoDB clients, the handler calls `PutObject` before `PutItem`, with matching `snapshotKey` in both the S3 call and the DynamoDB item's `snapshotKey` field.
- [ ] `jobKey` in the written item equals `` `${message.source}#${scraped.jobId}` ``.
- [ ] `city` on the written item equals `message.cityLabel`, not anything derived from the adapter.
- [ ] A thrown error from `scrapeJobDetail` prevents both the S3 `PutObject` and the DynamoDB `PutItem` from being called.
- [ ] An S3 `PutObject` failure prevents the DynamoDB `PutItem` from being called.
