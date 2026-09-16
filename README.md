# serverless-job-scraper

A serverless, cron-triggered pipeline that scrapes job listings (SEEK first; Indeed/LinkedIn designed-for) into DynamoDB + S3.

- **Why this shape**: [`../aws-roadmap/serverless-seek-scraper.md`](../aws-roadmap/serverless-seek-scraper.md)
- **What to build, precisely**: [`specs/`](specs/) — start at [`specs/00-overview.md`](specs/00-overview.md)
- **Agent/contributor instructions**: [`AGENTS.md`](AGENTS.md)

## Layout

```
specs/            spec-driven contracts — read before writing code
src/
  adapters/        JobSiteAdapter implementations (seek.ts) + interface + fixtures
  handlers/         Lambda entrypoints (listJobs.ts, jobDetail.ts)
  lib/               config loading, thin AWS SDK wrappers
  types/              shared data types (JobDetail, etc.)
tests/
  unit/              fixture-based, no network/AWS
  integration/        LocalStack-based, no real AWS
terraform/          IaC — DynamoDB, S3, SQS, Lambda, EventBridge Scheduler, IAM, SNS
.github/workflows/  CI (ci.yml) and CD (cd.yml) + a non-blocking live-smoke-test.yml
```

## Quick start

```bash
npm install
npx playwright install chromium
npm run typecheck && npm run lint && npm test
```

See `AGENTS.md` for the full command list, conventions, and safety rules (in particular: no `terraform apply`/`destroy` or real AWS deploys without explicit human instruction in the moment).
