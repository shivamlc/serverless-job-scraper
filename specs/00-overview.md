# Spec 00 — Overview & Scope

## Purpose

A serverless, cron-triggered pipeline that scrapes job listings from SEEK (and, in future, Indeed/LinkedIn) and stores structured data in DynamoDB plus a raw HTML snapshot of each job page in S3.

Full architectural rationale, cost analysis, and design tradeoffs live in [`docs/roadmap.md`](../docs/roadmap.md) (copied into this repo, not the sibling `claude-job-search` repo, so it survives that repo being archived — `serverless-job-scraper` is self-contained and is the project going forward). That document is the **why**; the specs in this directory are the **contract** — precise enough to implement and test against without re-reading the rationale. When the two disagree, the specs in this directory win for implementation details; the roadmap wins for "why this shape." Note `docs/roadmap.md` predates this repo's own local-runnable entrypoint (`scripts/scrapeLocal.ts`) — its "Refactor needed" section describes a plan that has since been carried out; see spec 03 for the current state.

## In scope (v1)

- One working adapter: **SEEK**.
- Two Lambda handlers (`list-jobs`, `job-detail`) connected by one SQS queue.
- DynamoDB table + GSI, S3 bucket, SQS queue + DLQ, IAM roles, EventBridge Scheduler — all via Terraform.
- CI (typecheck, lint, unit tests, integration tests, `terraform plan`) and CD (build/push image, `terraform apply`) via GitHub Actions.
- Unit tests (fixture-based, no network) and integration tests (LocalStack-based, no real AWS).

## Explicitly out of scope (v1)

- Indeed and LinkedIn adapters (the interface must support them; they are not implemented yet).
- Actually running `terraform apply` against a real AWS account, or pushing images to a real ECR repo — this repo provides everything needed to do so, but no agent should run either without a human explicitly asking for that specific action in that specific session.
- A UI for browsing scraped jobs. The sibling `claude-job-search/webapp` project did this against MongoDB, but that repo is slated for archiving — treat this pipeline as standalone rather than assuming `webapp` will exist to integrate with later.
- Batching multiple jobs per Lambda B invocation (SQS batch size stays at 1 for v1 — see spec 05).

## Definition of done for any feature in this repo

1. There is a spec for it in this directory before there is code for it.
2. The code matches the spec (or the spec was updated first, with the reason noted in the PR/commit).
3. Unit tests cover it; if it touches AWS service calls, an integration test (against LocalStack) covers it too.
4. `npm run typecheck`, `npm run lint`, and `npm test` all pass.
5. If it changes infrastructure shape, `terraform validate` (and ideally `terraform plan`) passes.

## Glossary

- **Adapter**: a `JobSiteAdapter` implementation for one job site (SEEK, Indeed, ...) — see spec 02.
- **Source**: the short adapter key (`"seek"`, `"indeed"`, `"linkedin"`), used throughout as a discriminator (DynamoDB `jobKey` prefix, S3 key prefix, SQS message field, Terraform `sources` map key).
- **SearchParams**: the typed, site-agnostic description of what to search for (city, date range, salary band, etc.) — see spec 01.
