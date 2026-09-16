# Spec 11 — Testing Strategy

## Unit tests (Vitest, `tests/unit/`, `npm test`)

No network, no AWS, no Docker — must run in a few seconds. This is what `ci.yml` runs on every push and what should catch most regressions.

| Test file | Covers |
|---|---|
| `tests/unit/seekAdapter.test.ts` | `buildSearchUrl` against the default `SearchParams` (byte-identical to today's hardcoded URL — spec 03); `listJobLinks` against `results-page.html`/`results-page-last.html` fixtures (drives a real local Chromium via `page.setContent`, but zero network calls); `scrapeJobDetail` against `job-detail.html`; retry-policy exercised with a mocked `page.goto` that fails twice then succeeds. |
| `tests/unit/config.test.ts` | `loadSearchParamsFromEnv()` defaults, overrides, and validation errors (spec 01). |
| `tests/unit/job.test.ts` | `buildJobKey` (spec 06). |
| `tests/unit/handlers/listJobs.test.ts` | Handler logic with a **fake adapter** (not the real SEEK one) and a mocked DynamoDB client (`aws-sdk-client-mock`) — batching into groups of 10, skip-check behavior, unknown-source throw (spec 04). |
| `tests/unit/handlers/jobDetail.test.ts` | Handler logic with a fake adapter and mocked S3/DynamoDB clients — write ordering (S3 before DynamoDB), `jobKey`/`snapshotKey` construction, failure propagation (spec 05). |

Handler unit tests use a **fake `JobSiteAdapter`** (an in-memory object implementing the interface, not SEEK) so they test the handler's own logic in isolation from real scraping/browser concerns — that's what the LocalStack integration tests (below) are for.

## Integration tests (`tests/integration/`, `npm run test:integration`)

Run against **LocalStack** (DynamoDB, S3, SQS emulated locally) as a Docker service container — no real AWS account touched, no cost. Started via `docker-compose.localstack.yml` at repo root; `ci.yml` runs LocalStack as a GitHub Actions service container instead.

| Test file | Covers |
|---|---|
| `tests/integration/listJobsHandler.integration.test.ts` | Invokes the real `handlers/listJobs.ts` handler (with a fake adapter, to avoid real network) against a LocalStack DynamoDB table + SQS queue provisioned by the test setup; asserts the right messages land on the queue and the skip-check correctly reads from the real (local) table. |
| `tests/integration/jobDetailHandler.integration.test.ts` | Invokes the real `handlers/jobDetail.ts` handler (fake adapter) against LocalStack S3 + DynamoDB; asserts the object lands in the bucket and the item lands in the table with matching `snapshotKey`. |
| `tests/integration/seekAdapterNavigation.integration.test.ts` | Runs the **real** SEEK adapter's `listJobLinks` pagination/next-button-detection logic against fixture HTML served by a local HTTP server (or `page.route()` interception) — proves the navigation logic works, not just the parsing logic (unit tests already cover parsing in isolation). |

**Explicitly excluded from all of the above**: the real `au.seek.com`. Hitting it repeatedly from CI is slow, flaky, and risks rate-limiting/blocking whatever IP CI runs from. That's what `live-smoke-test.yml` (spec 10) is for — kept separate, non-blocking, low-frequency.

## Fixtures

Shared between unit and integration tests: `src/adapters/seek.fixtures/{results-page.html, results-page-last.html, job-detail.html}` (spec 03). Fixtures are **scrubbed** real SEEK HTML — strip anything that looks like personal data (recruiter names/emails in job descriptions) before committing, even though this is scraped-public data; keep only what's needed to exercise the selectors.

## Coverage expectation

No hard numeric threshold enforced in v1 (avoid coverage-percentage theater) — but every acceptance criterion listed in specs 01–08 must map to at least one test asserting it. If a spec's acceptance criterion has no corresponding test, that's a gap to close before calling the feature done (spec 00's definition of done).

## Linting rule enforcing spec 01

An ESLint `no-restricted-syntax` rule, scoped via `files` overrides to `src/adapters/**` and `src/handlers/**`, flags any `process.env` reference with no exceptions — turning spec 01's rule into something CI actually enforces, not just documents. Anything those layers need from the environment goes through a `src/lib/` getter instead (`getSkipWindowHours()`, `getJobScrapeQueueUrl()`, etc.).
