# Agent instructions — serverless-job-scraper

## What this repo is

A serverless, source-agnostic job-scraping pipeline (SEEK first; Indeed/LinkedIn designed-for but not yet implemented). Two Lambdas connected by one SQS queue, DynamoDB + S3 storage, Terraform infra, GitHub Actions CI/CD. Full rationale: `../aws-roadmap/serverless-seek-scraper.md`. Precise, testable contracts: `specs/*.md`.

## Spec-driven workflow — read this before writing code

1. **Every feature has a spec in `specs/` before it has code in `src/`.** If you're about to implement something with no corresponding spec, stop and write the spec first (or point out the gap).
2. When code and spec disagree, that's a bug in one of them — fix whichever is wrong, and say which you changed and why. Don't silently let them drift apart.
3. Each spec ends with an **Acceptance criteria** checklist — treat these as the test plan. A feature isn't done until every checkbox in its spec has a corresponding passing test.

## Setup

```bash
npm install
npx playwright install chromium   # needed for local adapter tests, which drive a real headless browser
```

Node version: see `package.json` `engines`.

## Commands

```bash
npm run typecheck        # tsc --noEmit
npm run lint              # eslint
npm test                   # unit tests (Vitest) — no network, no AWS, no Docker
npm run test:integration    # integration tests — requires Docker (LocalStack)
npm run build                 # compile src/ for the Lambda container image
```

Run `typecheck`, `lint`, and `npm test` before considering any change finished. Integration tests require Docker; run them when touching anything under `src/handlers/` or `src/lib/`.

## Code conventions

- **`src/adapters/**` and `src/handlers/**` never read `process.env` directly, no exceptions.** All site-search config flows through the typed `SearchParams` object (spec 01); anything else needed from the environment (queue URLs, bucket names, operational thresholds) goes through a small getter under `src/lib/` (`getSkipWindowHours()`, `getJobScrapeQueueUrl()`, `getSnapshotBucketName()`, ...). This is enforced by an ESLint rule, not just convention — if you need a new piece of config inside an adapter, add it to `SearchParams` and thread it through as a parameter; if a handler needs a new env-backed value, add a getter to `src/lib/`, don't inline `process.env` in the handler.
- New adapters implement `JobSiteAdapter` (spec 02) and get registered in `src/adapters/index.ts` — never add site-specific branching (`if (source === 'indeed')`) inside the Lambda handlers themselves.
- Prefer editing existing files over creating new ones; no speculative abstractions beyond what the current spec set calls for (see the parent repo's general engineering conventions — three similar lines beat a premature abstraction).

## Safety rules for any agent working in this repo

- **Never run `terraform apply` or `terraform destroy`** without a human explicitly asking for that specific action in that specific session. `terraform plan`/`validate`/`fmt` are safe to run freely.
- **Never push a Docker image to a real ECR repository** or otherwise deploy without explicit, in-the-moment human instruction.
- **Never commit real AWS credentials, `.env` files with real values, or the Terraform state file** (`.gitignore` already covers the common cases — check before `git add` if unsure).
- Unit tests and `terraform validate`/`fmt`/`plan` are safe to run freely as part of normal development.

## Testing philosophy (see spec 11 for full detail)

- Unit tests: fixture-based, no network, no AWS.
- Integration tests: LocalStack-emulated AWS, fixture-served HTML — never the real live site.
- A separate, non-blocking `live-smoke-test.yml` workflow is the only thing that hits the real SEEK site, and only on a schedule, never as part of the PR merge gate.
