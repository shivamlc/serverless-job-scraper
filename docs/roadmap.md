> **Status note**: this is the original design-rationale document, copied here verbatim (minus this note) from `claude-job-search/aws-roadmap/serverless-seek-scraper.md` so it survives that repo being archived — `serverless-job-scraper` is the project going forward and should be self-contained. It's kept as historical "why" context; per `specs/00-overview.md`, the specs win over this document for any current implementation detail. In particular: the "Refactor needed before this works" section below describes work that **has since been done** — see `scripts/scrapeLocal.ts` and `specs/03-seek-adapter.md` for the current, actual local-run story, not the plan described here.

# Serverless Job Scraper — Roadmap (SEEK first, Indeed/LinkedIn-ready, Terraform + CI/CD)

## Goal

Turn the existing local script (`seek-scrape-jobs.spec.ts`, run manually via `run-seek-scrape-jobs.sh` or by `webapp/lib/runScraper.ts`) into a **fully managed, event/cron-triggered pipeline** that:

1. Runs on a schedule with no server to babysit.
2. Scrapes job sites the same way the current Playwright script scrapes SEEK, split into **two stages** (list jobs → scrape one job) so the one genuinely slow, failure-prone, parallelizable step — per-job detail scraping — gets its own queue and isolated retries.
3. Is built **source-agnostic from day one** — SEEK is the first (and only) implemented adapter, but the pipeline, data model, and infra are shaped so adding Indeed or LinkedIn later is "write one adapter + one config entry," not a redesign.
   - Search filters (city, date range, salary band, work arrangement) become a typed `SearchParams` object instead of hardcoded values baked into a URL string — see "Where do `SearchParams` come from?" below. The scraping logic itself never reads environment variables directly; only the local-dev entrypoint does, once, at the edge.
4. Writes structured job data to **DynamoDB** and a raw **.html snapshot** of each job page to **S3**.
5. Is provisioned with **Terraform**, deployed through a **GitHub Actions CI/CD pipeline**, and covered by **unit tests** (parsing/mapping logic) and **integration tests** (handler-level, against emulated AWS services and fixture HTML — not the live site).
6. Costs as close to **$0/month** as AWS allows for a low-frequency (e.g. daily) job.

Everything is TypeScript end-to-end: two Lambda handlers (one shared container image, parameterized per source), Terraform for infra, GitHub Actions for CI/CD.

---

## Architecture

```mermaid
flowchart LR
    EB["EventBridge Scheduler\n1 schedule per source\n(seek-daily, indeed-daily, ...)"] -->|invokes with {source, searchParams}| A["Lambda A: list-jobs\nresolves adapter by `source`,\nwalks pages, extracts job links"]
    A -->|SendMessageBatch per job| QJ[("SQS: job-scrape-queue")]
    QJ -->|triggers| B["Lambda B: job-detail\nresolves adapter by `source`,\nscrapes 1 job listing"]
    B -->|PutItem| DDB[("DynamoDB\nScrapedJobs table")]
    B -->|PutObject| S3[("S3 bucket\njob-snapshots/{source}/...")]
    QJ -.failed x3.-> DLQ[("DLQ: job-scrape-dlq")]
    DLQ -->|alarm| SNS["SNS topic → email"]
```

Same two-Lambda shape as before — one queue, one DLQ — but both Lambdas take `source` as input and dispatch to a **site adapter** instead of hardcoding SEEK's selectors. Adding a new site is: write an adapter module + register one more EventBridge schedule; no new Lambdas, queues, or tables.

---

## Multi-site extensibility — the adapter pattern

Every site-specific concern (selectors, URL shape, pagination mechanics, per-job field extraction) lives behind one interface:

```ts
// src/adapters/types.ts
export interface SearchParams {
  keywords: string;                 // e.g. "software-engineer" (category slug or free-text query)
  cityLabel: string;                 // e.g. "Melbourne" — display/storage value
  citySlug: string;                   // e.g. "Melbourne-VIC-3000" — SEEK's own slug format
  dateRangeDays: number;                // e.g. 7
  workType: 'full-time' | 'part-time' | 'contract' | 'casual';
  salaryMin?: number;
  salaryMax?: number;
  salaryType?: 'annual' | 'hourly';
  workArrangement?: Array<'onsite' | 'hybrid' | 'remote'>;
}

export interface JobSiteAdapter {
  readonly source: 'seek' | 'indeed' | 'linkedin';

  /** Translates common SearchParams into this site's own URL/query shape. */
  buildSearchUrl(params: SearchParams): string;

  /** Walks all result pages for a search URL, yielding job links as it finds them. */
  listJobLinks(page: Page, searchUrl: string): AsyncGenerator<{ jobId: string; url: string }>;

  /** Scrapes one job's detail page into the common JobDetail shape. */
  scrapeJobDetail(page: Page, url: string): Promise<JobDetail>;
}
```

```ts
// src/adapters/index.ts
import { seekAdapter } from './seek';
// import { indeedAdapter } from './indeed';   // added later
// import { linkedinAdapter } from './linkedin'; // added later

const adapters: Record<string, JobSiteAdapter> = {
  seek: seekAdapter,
};

export function getAdapter(source: string): JobSiteAdapter {
  const adapter = adapters[source];
  if (!adapter) throw new Error(`No adapter registered for source "${source}"`);
  return adapter;
}
```

`src/adapters/seek.ts` is exactly today's scraping logic (pagination walk + `page.evaluate()` extraction from `seek-scrape-jobs.spec.ts`) refactored to implement `JobSiteAdapter`. Both Lambda handlers become source-agnostic:

- **Lambda A** reads `source` + `searchParams` from its invocation event, calls `getAdapter(source).buildSearchUrl(searchParams)` to get the actual URL, then `getAdapter(source).listJobLinks(...)`, enqueues `{ source, jobId, url }`.
- **Lambda B** reads `source` from the SQS message, calls `getAdapter(source).scrapeJobDetail(...)`, writes to DynamoDB/S3 under that source's namespace.

**What adding Indeed later actually looks like**: write `src/adapters/indeed.ts` implementing the same interface (its own `buildSearchUrl` mapping the *same* `SearchParams` fields onto Indeed's URL scheme), register it in `adapters/index.ts`, add one fixture-based unit/integration test file, add one Terraform `source` entry (see below) with Indeed's search params and cron schedule. No changes to Lambda code, Terraform Lambda/SQS/DynamoDB/S3 resources, or the CI/CD pipeline itself.

This is also *why* the data model below is namespaced by `source` from the start rather than being SEEK-specific — retrofitting that later would mean a migration; doing it now costs nothing.

### Where do `SearchParams` come from? (removing the hardcoded Melbourne/7-day default)

Today, city and date range are hardcoded into a fallback URL string in `seek-scrape-jobs.spec.ts` (`process.env.SEEK_URL ?? 'https://au.seek.com/software-engineer-jobs/in-Melbourne-VIC-3000/full-time?daterange=7&salaryrange=0-150000&salarytype=annual&workarrangement=1%2C2%2C3'`) — city, date range, salary band, and work arrangement are all baked in, and only city/date range are even parameterizable today (via `webapp/lib/scrapeSettings.ts` → `runScraper.ts`'s `buildSeekUrl`, which itself still hardcodes the salary band and work arrangement).

The fix isn't just "read more env vars" — it's making sure the **adapter logic itself never reads `process.env` (or any other ambient global) directly**. `listJobLinks`, `scrapeJobDetail`, and `buildSearchUrl` all take a `SearchParams` object as a plain argument. That object gets constructed exactly once, at whichever entrypoint is running, from whatever configuration source fits that entrypoint:

| Entrypoint | Where `SearchParams` comes from | Why |
|---|---|---|
| Local dev (`seek-scrape-jobs.spec.ts`, `run-seek-scrape-jobs.sh`) | A `loadSearchParamsFromEnv()` helper (`src/lib/config.ts`) reads `SCRAPE_CITY_LABEL`, `SCRAPE_CITY_SLUG`, `SCRAPE_DATE_RANGE_DAYS`, `SCRAPE_SALARY_MIN`, `SCRAPE_SALARY_MAX`, `SCRAPE_SALARY_TYPE`, `SCRAPE_WORK_ARRANGEMENT` (comma-separated), `SCRAPE_WORK_TYPE`, `SCRAPE_KEYWORDS` once, with documented defaults matching today's behavior (Melbourne, 7 days, full-time) purely as local-dev convenience — called once, at the top, before any scraping starts | One-off manual/local runs are naturally configured via env vars (`.env`, shell exports) |
| Lambda (production) | The **EventBridge event payload** — `{ source, searchParams }` — populated per-schedule from the Terraform `sources` variable (below), not from Lambda environment variables | One Lambda function serves every source *and* every city/filter combination via N EventBridge schedules; a static Lambda env var can't vary per-schedule the way an event payload can |
| Unit/integration tests | A literal `SearchParams` object constructed inline in the test | No env vars needed at all to test adapter logic — this is the real payoff: the adapter is trivially testable with arbitrary params, with no environment to mock |

Same typed object, three different sources, zero `process.env` reads inside `adapters/*.ts` — that's what "doesn't depend on env vars tightly" means in practice: env vars are a *local-dev config-loading detail* at the outermost edge, not something the scraping logic itself is aware of.

---

## Why two Lambdas, not one, not three

| Concern | One Lambda (fully monolithic) | **Two Lambdas (this design)** | Three Lambdas (page-walk / page-links / job-detail split further) |
|---|---|---|---|
| Timeout risk | Real on a large result set — pagination + every job's detail scrape in one run | **Solved for the actual bottleneck** — Lambda A only walks pages and reads job cards (fast, no per-job navigation), so it stays well under 15 min even for dozens of pages; Lambda B scrapes exactly one job per invocation | Also solved, but pagination and job-link extraction were never the risky part — splitting them adds a queue without addressing a real constraint |
| Retry granularity | A crash mid-run restarts the whole scrape | A failed job retries just that job; a failed listing run just re-walks pages (cheap) | Same as two-Lambda for jobs; page-level retries add little since page-walking rarely fails independently of link-extraction |
| Parallelism | None | SQS + Lambda concurrency parallelizes job-detail scraping automatically | Same benefit, no additional parallelism gained from the extra split |
| Infra to maintain | 1 function, 1 role | 2 functions, 1 queue, 1 DLQ, 2 roles | 3 functions, 2 queues, 2 DLQs, 3 roles — the extra queue mostly buys ceremony, not resilience, at this volume |
| Multi-site fit | Same adapter dispatch works regardless of Lambda count | Adapter dispatch happens exactly twice (once per stage) | Adapter dispatch would happen three times for no added benefit |

### Concurrency control (important — don't skip this)

SQS-triggered Lambda scales up pollers automatically. Left unbounded, Lambda B could spin up dozens of concurrent headless-Chromium sessions hitting a job site at once.

- Set **`reserved_concurrent_executions`** on Lambda B (e.g. `3`) to cap parallelism — a deliberate politeness/anti-bot-detection throttle, not just a cost control. Consider scoping this **per source** once a second site is added (e.g. via a separate queue+Lambda pair, or a `source` tag used to self-throttle inside the handler) so one site's rate limit doesn't starve another's.
- Set the queue's **visibility timeout** to comfortably exceed Lambda B's timeout (AWS's own guidance: ~6× the function timeout).
- Lambda A only ever runs once per source per cron trigger — no throttling needed there.

---

## Pipeline stages in detail

### Lambda A — `list-jobs`
- Triggered by EventBridge Scheduler with event input `{ source: "seek", searchParams: {...} }` (see `SearchParams` above) — one schedule rule per source, same Lambda.
- Resolves the adapter via `getAdapter(source)`, calls `adapter.buildSearchUrl(searchParams)` to get the actual URL, then runs its `listJobLinks` (the pagination walk from `seek-scrape-jobs.spec.ts:33-181` for the `seek` adapter) — does **not** open any individual job listing.
- Before enqueueing a job, `Query` the DynamoDB `listingUrl-index` GSI and skip it if already scraped recently.
- `SendMessageBatch` (up to 10 per call) each surviving job link to `job-scrape-queue` as `{ source, jobId, url }`.

### Lambda B — `job-detail` (SQS-triggered, batch size 1 to start)
- Consumes one `{ source, jobId, url }` message.
- Resolves the adapter via `getAdapter(source)`, runs its `scrapeJobDetail` (the `page.evaluate()` extraction from `seek-scrape-jobs.spec.ts:75-135` for `seek`), and captures `await page.content()` for the raw HTML snapshot.
- `PutItem` to DynamoDB, `PutObject` to S3 under `snapshots/{source}/...`.

---

## Queue & dead-letter handling

| Queue | Type | Consumer | Message body | DLQ | `maxReceiveCount` |
|---|---|---|---|---|---|
| `job-scrape-queue` | Standard | Lambda B | `{ source: string; jobId: string; url: string }` | `job-scrape-dlq` | 3 |

- **Standard**, not FIFO — order doesn't matter and writes are idempotent (upsert by `jobId`/`listingUrl`, per source).
- CloudWatch Alarm on `ApproximateNumberOfMessagesVisible > 0` for the DLQ → SNS → email.

---

## Data model (source-namespaced from the start)

### DynamoDB — table `ScrapedJobs`

Reuse the existing `JobDetail` shape from `webapp/lib/jobSchema.ts` field-for-field, plus a `source` attribute, so downstream code (resume/cover-letter generation, job browsing) is a small additive change, not a rewrite.

| Attribute | Type | Role |
|---|---|---|
| `jobKey` | String | **Partition key** — `${source}#${jobId}` (e.g. `seek#87654321`) so job IDs can never collide across sites |
| `scrapedAt` | String (ISO date) | **Sort key** — keeps scrape history, makes "only scrape what's new" a cheap `Query` |
| `source` | String | `seek` \| `indeed` \| `linkedin` — plain attribute, also embedded in `jobKey` |
| `jobId` | String | the site's own job id, unprefixed |
| `title`, `company`, `location`, `salary`, `workType`, `postedDate`, `listingUrl` | String | direct port from `JobDetail` |
| `sections` | List<Map> | direct port (`{ heading, content }[]`) |
| `fullText` | String | direct port |
| `city` | String | direct port |
| `snapshotKey` | String | S3 object key for this scrape's HTML snapshot |

- **GSI** `listingUrl-index` (PK `listingUrl`) — URLs are globally unique across sites by construction, so this GSI needs no `source` component; used by Lambda A's skip-check.
- Billing mode: `PAY_PER_REQUEST`.
- Optional TTL (`ttl` epoch-seconds attribute) for scrape-history cleanup.

### S3 — bucket `job-snapshots-<account-id>`

- Key convention: `snapshots/{source}/{jobId}/{scrapedAt}.html`.
- Lifecycle rule: transition to Glacier Instant Retrieval after 30 days, or expire after e.g. 180 days.
- Block all public access (default).

---

## IAM (least privilege — two roles, source-agnostic)

Because both Lambdas are parameterized by `source` rather than deployed per-site, the IAM policies below don't change when a new site is added — they're scoped to the shared table/queue/bucket, not to any one source.

**Lambda A role** (`list-jobs`):
```jsonc
[
  { "Effect": "Allow", "Action": "sqs:SendMessage", "Resource": "arn:aws:sqs:<region>:<account-id>:job-scrape-queue" },
  { "Effect": "Allow", "Action": "dynamodb:Query", "Resource": "arn:aws:dynamodb:<region>:<account-id>:table/ScrapedJobs/index/listingUrl-index" }
]
```

**Lambda B role** (`job-detail`):
```jsonc
[
  { "Effect": "Allow", "Action": ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], "Resource": "arn:aws:sqs:<region>:<account-id>:job-scrape-queue" },
  { "Effect": "Allow", "Action": "dynamodb:PutItem", "Resource": "arn:aws:dynamodb:<region>:<account-id>:table/ScrapedJobs" },
  { "Effect": "Allow", "Action": "s3:PutObject", "Resource": "arn:aws:s3:::job-snapshots-<account-id>/snapshots/*" }
]
```

Both also need `logs:CreateLogGroup`/`CreateLogStream`/`PutLogEvents` on `arn:aws:logs:<region>:<account-id>:*`.

---

## Packaging Playwright for Lambda

Both Lambdas do browser automation, so both need `playwright-core` + `@sparticuz/chromium` on a `public.ecr.aws/lambda/nodejs:20` base image.

```
src/
  adapters/
    types.ts            # JobSiteAdapter interface
    index.ts            # getAdapter(source) registry
    seek.ts              # SEEK implementation (today's only adapter)
    seek.fixtures/        # saved HTML fixtures for tests (see Testing strategy)
    # indeed.ts, linkedin.ts — added later, same shape
  handlers/
    listJobs.ts          # Lambda A entrypoint — resolves adapter, walks pages, enqueues
    jobDetail.ts          # Lambda B entrypoint — resolves adapter, scrapes one job, writes DDB+S3
  lib/
    dynamo.ts             # thin DynamoDB client wrapper
    s3.ts                 # thin S3 client wrapper
```

Build one container image, push once to ECR; the two Lambda functions reference the same image with different `image_config.command` overrides pointing at their own handler.

### Refactor needed before this works

`seek-scrape-jobs.spec.ts` is a **Playwright test file** — split its logic into `src/adapters/seek.ts` implementing `JobSiteAdapter`, including a `buildSearchUrl` that replaces today's hardcoded fallback URL string (Melbourne, 7-day range, salary band, work arrangement all baked in). Add `src/lib/config.ts` with `loadSearchParamsFromEnv()` (see the config table above) so the script's only remaining env-var read lives in one place, at the top. `seek-scrape-jobs.spec.ts` then becomes a thin wrapper: load params from env → `buildSearchUrl` → `listJobLinks` → `scrapeJobDetail` per job — keeping `run-seek-scrape-jobs.sh` and `webapp`'s "run scraper now" button working unchanged, just no longer hardcoded to Melbourne/7 days when run without any env vars set (it'll use `loadSearchParamsFromEnv()`'s documented defaults instead, which is a config default, not logic baked into the scrape itself).

---

## Testing strategy

### Unit tests (Vitest)

Pure-function tests, no network, no AWS, run in milliseconds — these are what CI runs on every push and what should catch most regressions.

- **Adapter parsing logic**: for each adapter, save a real (scrubbed) result-page HTML and job-detail-page HTML as fixtures (`src/adapters/seek.fixtures/results-page-1.html`, `job-detail.html`), load them with `page.setContent(fixtureHtml)` in a Playwright-driven-but-networkless test, and assert `listJobLinks`/`scrapeJobDetail` produce the expected structured output. This is how you catch **SEEK changing its markup** without ever hitting the live site in CI.
- **`jobKey` construction, DynamoDB item mapping, S3 key construction** — plain data-transform functions, trivially unit-testable.
- **Skip-check logic** (given a mocked "already scraped within N days" GSI result, does Lambda A correctly skip/include a job) — mock the DynamoDB client (`aws-sdk-client-mock`), no real AWS calls.

### Integration tests

Two layers, both run in CI without touching real AWS or the real job sites:

1. **Handler-level, against emulated AWS** — run **LocalStack** (or `dynamodb-local` + a local S3-compatible service) as a Docker service container in the GitHub Actions job. Invoke the actual Lambda handler functions (`handlers/listJobs.ts`, `handlers/jobDetail.ts`) directly (not through real Lambda) against these local endpoints, and assert the right item lands in the local DynamoDB table and the right object lands in the local bucket. This proves the handler wiring (IAM-shaped calls, item/key construction, SQS message shape) is correct end-to-end without any billed AWS usage.
2. **Adapter-level, against fixture HTML served over a local server** — spin up a tiny local HTTP server (or use Playwright's `page.route()` interception) serving the same saved fixture pages used in unit tests, and run the adapter's real pagination-walk/next-button-detection logic against them. This is slower than the pure unit tests (it drives a real headless browser) but proves the *navigation* logic works, not just the parsing logic.

**Explicitly not in CI**: hitting the real live site. It's slow, flaky, and scraping a real site repeatedly from a CI runner risks rate-limiting/blocking the account this runs under. Instead, add one **optional, separately-scheduled "live smoke test"** GitHub Actions workflow (e.g. weekly, or manually triggered) that runs the real adapter against the real site once and reports pass/fail — this is your early warning for markup drift, kept deliberately out of the required PR merge-gate so an external site hiccup never blocks a deploy.

---

## Terraform layout

```
terraform/
  main.tf              # provider, backend config
  variables.tf          # project_name, aws_region, sources (map, see below)
  dynamodb.tf            # ScrapedJobs table + listingUrl-index GSI
  s3.tf                  # snapshot bucket + lifecycle rule
  sqs.tf                 # job-scrape-queue + job-scrape-dlq
  ecr.tf                  # repository for the shared container image
  lambda.tf                # 2 lambda_function resources (image-based), reserved concurrency on B
  eventbridge.tf            # for_each over var.sources → one schedule per source
  iam.tf                     # 2 roles + policies above
  sns.tf                      # alarm topic + email subscription
  outputs.tf                   # table name, queue URL, ECR repo URL, etc.
  backend.tf                    # S3 backend + DynamoDB lock table for remote state
```

- **Remote state**: S3 bucket + a small DynamoDB lock table (a nice callback — the same on-demand billing story as `ScrapedJobs`), so state isn't a local file at risk of being lost/diverging.
- **Multi-site config as data, not code** — `variables.tf`:
  ```hcl
  variable "sources" {
    type = map(object({
      schedule_expression = string  # e.g. "cron(0 8 * * ? *)"
      search_params = object({
        keywords          = string
        city_label        = string
        city_slug         = string
        date_range_days   = number
        work_type         = string
        salary_min        = optional(number)
        salary_max        = optional(number)
        salary_type       = optional(string)
        work_arrangement  = optional(list(string))
      })
    }))
    default = {
      seek = {
        schedule_expression = "cron(0 8 * * ? *)"
        search_params = {
          keywords         = "software-engineer"
          city_label       = "Melbourne"
          city_slug        = "Melbourne-VIC-3000"
          date_range_days  = 7
          work_type        = "full-time"
          salary_min       = 0
          salary_max       = 150000
          salary_type      = "annual"
          work_arrangement = ["onsite", "hybrid", "remote"]
        }
      }
      # indeed = { schedule_expression = "...", search_params = { ... } }  # added later
    }
  }
  ```
  Every dimension that's hardcoded into today's script (city, date range, salary band, work arrangement) is now a plain Terraform value — **changing the city or date range is a one-line `tfvars` edit**, not a code change, and it's structured per-field rather than one opaque URL string. `eventbridge.tf` does `for_each = var.sources` to create one schedule per entry, each invoking Lambda A with `{ source = each.key, searchParams = each.value.search_params }`. **Adding Indeed later is a one-entry Terraform diff**, not a new resource block.

---

## CI/CD pipeline (GitHub Actions)

### `ci.yml` — runs on every PR
1. Checkout, setup Node, `npm ci`.
2. `tsc --noEmit` (typecheck) + lint.
3. Unit tests (Vitest) — fixture-based adapter parsing, item/key mapping, skip-check logic.
4. Integration tests — spin up LocalStack as a service container, run handler-level tests against it.
5. `terraform fmt -check` + `terraform validate`.
6. `terraform plan` (authenticated via **GitHub OIDC → a scoped AWS IAM role**, no long-lived AWS access keys stored as repo secrets) — post the plan as a PR comment for review.

### `cd.yml` — runs on merge to `main`
1. Build the shared Docker image, tag with the git SHA, push to ECR.
2. `terraform apply` (same OIDC-federated role, narrower `apply`-capable permissions than a human would need) — update the two Lambda functions' image tag and any other changed infra.
3. Gate this behind a GitHub **Environment** with a required reviewer (this touches real, billed AWS infra — a manual approval click before `apply` is a cheap, standard safeguard).

### `live-smoke-test.yml` — scheduled weekly + manually triggerable
- Runs each adapter against the real live site once, reports pass/fail (e.g. to the same SNS topic or a GitHub issue), but is **not** a required check on `ci.yml`/PRs — isolates "the site changed its markup" from "my code change broke something," so a live-site hiccup never blocks an unrelated deploy.

**Security note**: use GitHub's OIDC provider to assume an AWS IAM role scoped to exactly what `plan`/`apply` need (the resources in the Terraform layout above) — this avoids ever storing an AWS access key/secret as a GitHub secret, which is the standard modern replacement for long-lived CI credentials.

---

## Build phases

| # | What you build | Notes |
|---|---|---|
| 1 | Extract `src/adapters/types.ts` (`SearchParams` + `JobSiteAdapter`) and `src/adapters/seek.ts` (today's logic, including a `buildSearchUrl` replacing the hardcoded Melbourne/7-day fallback URL) from `seek-scrape-jobs.spec.ts`; add `src/lib/config.ts` (`loadSearchParamsFromEnv()`) | Verify local `run-seek-scrape-jobs.sh` still produces the same `seek-job-results.json`, now driven by `SCRAPE_*` env vars with documented defaults instead of a hardcoded URL |
| 2 | Save real SEEK result-page + job-detail-page HTML as test fixtures; write unit tests for `listJobLinks`/`scrapeJobDetail` against them | This is your regression harness for "SEEK changed its markup," from day one |
| 3 | Write `handlers/listJobs.ts` / `handlers/jobDetail.ts`, parameterized by `source`, calling `getAdapter(source)` | Unit-test the skip-check and item/key-construction logic with a mocked DynamoDB client |
| 4 | Set up LocalStack-based integration tests for both handlers | Assert correct DynamoDB item + S3 object shape without touching real AWS |
| 5 | Write the Terraform modules (dynamodb, s3, sqs, ecr, lambda, eventbridge w/ `for_each` over `sources`, iam, sns, remote-state backend) | `terraform validate` locally before wiring CI |
| 6 | Write `ci.yml` (typecheck, lint, unit tests, LocalStack integration tests, `terraform plan` via OIDC) | Get this green on a PR before touching `cd.yml` |
| 7 | Write `cd.yml` (build+push image to ECR, `terraform apply` via OIDC, gated by a GitHub Environment reviewer) | First `apply` should still be reviewed carefully by hand |
| 8 | Set `reserved_concurrent_executions` on Lambda B and the queue's visibility timeout (≥ 6× Lambda B's timeout) | Politeness/anti-bot throttle — don't skip |
| 9 | CloudWatch Alarms on the DLQ + Lambda `Errors` on both functions → SNS → email | |
| 10 | Add `live-smoke-test.yml` (weekly/manual, non-blocking) | Early warning for markup drift, isolated from the merge gate |
| 11 | End-to-end test on the real schedule; watch CloudWatch Logs and queue depth for the first several runs | |
| 12 | *(when adding a new site)* Write `src/adapters/indeed.ts` + fixtures + tests, add one `sources` entry in Terraform, open a PR | No Lambda/queue/table/CI changes needed |

---

## Estimated monthly cost (daily run, single source)

Assume ~15 result pages and ~300 new job listings/day (after the DynamoDB skip-check filters out already-scraped ones). Adding a second/third source roughly scales Lambda B invocations and S3/DynamoDB writes proportionally — still comfortably inside free tiers at this volume.

| Service | Usage | Cost |
|---|---|---|
| Lambda A invocations | 30/month, ~1–3 min each | **$0** (inside always-free 1M requests + 400,000 GB-s/month) |
| Lambda B invocations | ~9,000/month, ~5–15s each | **$0** — far under the always-free tier at this duration/memory |
| SQS requests | Tens of thousands/month | **$0** (1M requests/month always free) |
| DynamoDB on-demand | ~300 writes/day + a Query per candidate job, <25GB stored | **~$0** (fractions of a cent; 25GB storage always free) |
| S3 storage | ~300 HTML snapshots/day | **$0.02–0.10/month** (cheaper after lifecycle transition to Glacier IR) |
| ECR image storage | One shared container image, few hundred MB | **~$0–0.05/month** |
| CloudWatch Logs | 2 log streams; set retention to 14–30 days | **~$0–0.10/month** |
| GitHub Actions | CI/CD minutes on a private repo | Free tier (2,000 min/month) almost certainly covers this at a few builds/day; LocalStack runs as a free OSS container, no external cost |

**Total: still effectively $0–1/month.** Terraform, CI/CD, and the test suite are all either free (GitHub Actions free tier, open-source LocalStack) or one-time/negligible (ECR image storage) — none of this changes the AWS runtime bill. Verify exact current free-tier thresholds on AWS's Free Tier page before deploying — pricing/limits shift over time.
