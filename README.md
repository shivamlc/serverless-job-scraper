# serverless-job-scraper

A serverless, cron-triggered pipeline that scrapes job listings (SEEK first; Indeed/LinkedIn designed-for) into DynamoDB + S3.

- **Why this shape**: [`docs/roadmap.md`](docs/roadmap.md)
- **What to build, precisely**: [`specs/`](specs/) — start at [`specs/00-overview.md`](specs/00-overview.md)
- **Agent/contributor instructions**: [`AGENTS.md`](AGENTS.md)

## Layout

```
specs/            spec-driven contracts — read before writing code
docs/             self-contained design rationale (roadmap.md)
scripts/          scrapeLocal.ts — the local, real-site scrape entrypoint
src/
  adapters/        JobSiteAdapter implementations (seek.ts) + interface + fixtures
  handlers/         Lambda entrypoints (listJobs.ts, jobDetail.ts)
  lib/               config loading, thin AWS SDK wrappers
  types/              shared data types (JobDetail, etc.)
tests/
  unit/              fixture-based, no network/AWS
  integration/        LocalStack-based, no real AWS
terraform/          IaC — DynamoDB, S3, SQS, Lambda, EventBridge Scheduler, IAM, SNS
.github/workflows/  ci.yml, build.yml (build+push, auto-deploy dev), deploy.yml (reusable),
                    promote.yml (manual uat/prod), live-smoke-test.yml (non-blocking)
```

## Running locally

### 1. Setup

```bash
npm install
npx playwright install chromium   # downloads a local Chromium build for tests
```

Node version: see `package.json`'s `engines` field.

### 2. Typecheck, lint, unit tests

No network, no AWS, no Docker — runs in a few seconds:

```bash
npm run typecheck
npm run lint
npm test
```

`npm test` drives a real headless Chromium against the HTML fixtures in `src/adapters/seek.fixtures/` (`tests/unit/seekAdapter.test.ts`) — it's testing the real scraping/parsing logic, just against saved pages instead of the live site.

### 3. Integration tests (needs Docker)

These exercise the actual Lambda handlers (`src/handlers/*.ts`) writing to real AWS SDK calls, against a local **LocalStack** container instead of a real account — no AWS credentials or cost involved:

```bash
docker compose -f docker-compose.localstack.yml up -d   # starts LocalStack on :4566
npm run test:integration
docker compose -f docker-compose.localstack.yml down     # tear it down when done
```

### 4. Running an actual scrape locally

```bash
npm run scrape:local
# or, to override search params (documented in specs/01-search-params-and-config.md):
SCRAPE_CITY_LABEL=Sydney SCRAPE_CITY_SLUG=Sydney-NSW-2000 npm run scrape:local
# and/or cap it for a quick manual check instead of a full run:
SCRAPE_LOCAL_MAX_JOBS=5 npm run scrape:local
```

`scripts/scrapeLocal.ts` drives `src/adapters/seek.ts` against the real `au.seek.com`, writing results to `seek-job-results.local.json` (gitignored) at the repo root. This is the self-contained replacement for the old `claude-job-search/seek-scrape-jobs.spec.ts` + `run-seek-scrape-jobs.sh` — this repo no longer depends on that sibling repo, which is slated for archiving.

Note it compiles via `tsc` rather than running the `.ts` directly (`tsc -p tsconfig.scripts.json && node dist-scripts/scripts/scrapeLocal.js`) — a esbuild-based runner (e.g. `tsx`) was tried first and broke `page.evaluate()` with a `ReferenceError: __name is not defined`, a known esbuild/Playwright interaction (esbuild's name-preservation helper doesn't exist inside the browser context Playwright serializes the function into).

### 5. Live smoke test (deliberately opt-in — hits the real site)

`npm run test:live-smoke` runs the real adapter against `au.seek.com` once. This is **not** part of the normal local dev loop (see `specs/10-cicd-pipeline.md`/`specs/11-testing-strategy.md`) — only run it deliberately, e.g. to check whether SEEK changed its markup.

---

See `AGENTS.md` for the full command list, conventions, and safety rules (in particular: no `terraform apply`/`destroy` or real AWS deploys without explicit human instruction in the moment), and [`NEXT-STEPS.md`](NEXT-STEPS.md) for the ordered path from "runs locally" to "deployed on AWS."
