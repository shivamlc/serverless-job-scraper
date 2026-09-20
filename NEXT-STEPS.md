# Next Steps — Making This Runnable and Deployable

A single ordered checklist tying together everything already built (`specs/`, `terraform/README.md`, `AGENTS.md`) into one path from "code exists" to "actually scraping SEEK into DynamoDB/S3 on a schedule." Each step links to where the detail already lives rather than repeating it — this document's job is the **sequence**, not the commands.

## Current status (verified, not assumed)

| Area | Status |
|---|---|
| Specs (`specs/00`–`12`) | ✅ Written |
| Source (`src/adapters`, `src/handlers`, `src/lib`, `src/types`) | ✅ Built, documented (`src/README.md`) |
| Unit tests | ✅ 21/21 passing (`npm test`) |
| Integration tests | ✅ 3/3 passing against a real LocalStack container (`npm run test:integration`) |
| Terraform (`terraform/*.tf`) | ✅ `fmt`/`validate` clean, multi-env (`dev`/`uat`/`prod`) parameterized |
| GitHub Actions workflows | ✅ Written, action versions current (Node 24 majors) |
| Git repo | ✅ Committed and pushed — `origin` is `github.com/shivamlc/serverless-job-scraper`, `main` up to date |
| **Local runnable end-to-end scrape** | ⬜ **Not done** — see Track A below, this is the one real code gap left |
| AWS account bootstrap (IAM, billing alarm, OIDC role) | ⬜ Not done (or in progress on your end — `terraform/README.md`) |
| Terraform state backend bootstrap | ⬜ Not done |
| First `terraform apply` (any environment) | ⬜ Not done — nothing is deployed to AWS yet |
| GitHub Environments + repo/environment variables | ⬜ Not done |
| First CI run | ✅ Has run at least once (you pasted a real log) — but it errored/warned, not fully green end-to-end |

---

## Track A — Finish making it runnable locally

This is genuinely the one piece of code work still outstanding. Everything in `src/` was built and tested, but the **local entrypoint that actually drives a real SEEK scrape** — the thing `specs/03-seek-adapter.md` and `specs/09-terraform-infra.md` call "the refactor" — was never done. Right now, `src/adapters/seek.ts` is only exercised by tests (against fixtures) and by the Lambda handlers (which need AWS). There is no `npm run scrape` you can point at the real site yet.

1. **Replace `../seek-scrape-jobs.spec.ts`'s body** with a thin script that:
   ```ts
   import { chromium } from 'playwright-core'; // or '@playwright/test' locally
   import { seekAdapter } from './serverless-job-scraper/src/adapters/seek.js';
   import { loadSearchParamsFromEnv } from './serverless-job-scraper/src/lib/config.js';

   const params = loadSearchParamsFromEnv();
   const browser = await chromium.launch();
   const page = await browser.newPage();
   const searchUrl = seekAdapter.buildSearchUrl(params);

   const links = [];
   for await (const link of seekAdapter.listJobLinks(page, searchUrl)) links.push(link);

   const jobs = [];
   for (const { url } of links) jobs.push(await seekAdapter.scrapeJobDetail(page, url));

   // write jobs to seek-job-results.json, same as today — keeps run-seek-scrape-jobs.sh working
   ```
   This keeps `run-seek-scrape-jobs.sh` and `webapp`'s "run scraper now" button working unchanged (per spec 03), just no longer hardcoded to Melbourne/7-days — it now goes through `loadSearchParamsFromEnv()`'s `SCRAPE_*` env vars (`specs/01-search-params-and-config.md`), defaulting to the same values as before when unset.
2. **Run it**: `SCRAPE_CITY_LABEL=Melbourne ./run-seek-scrape-jobs.sh` (or with no env vars at all, for the defaults) from the repo root — confirm it produces the same shape of `seek-job-results.json` as before.
3. **Optional but worth doing while you're in there**: a small local script that invokes `handlers/listJobs.ts`/`handlers/jobDetail.ts` directly (not through a deployed Lambda) against LocalStack — useful for testing the full DynamoDB/S3 write path without waiting on a real deploy. The integration tests already do exactly this (`tests/integration/*.integration.test.ts`) — a standalone script would just be those minus the test assertions, handy for manual poking.

**Done when**: you can run one command locally and get real, fresh SEEK job data — either into `seek-job-results.json` (step 1–2) or into a LocalStack DynamoDB table/S3 bucket (step 3) — without touching real AWS.

---

## Track B — Make it deployable to AWS

Everything here already has detailed, copy-pasteable commands written down — this section is purely the **order** to do them in, since several steps have real dependencies on earlier ones.

### B1. AWS account bootstrap
`terraform/README.md`, steps 1–3a, in order:
1. Create/access an AWS account, enable root MFA (steps 1–2).
2. Create your own IAM user for running Terraform by hand (step 3).
3. Create the GitHub Actions OIDC role (step 3a) — the identity CI authenticates with. Needs your GitHub org/repo name (`shivamlc/serverless-job-scraper`) for the trust policy.
4. Install & configure the AWS CLI (step 4), set a billing alarm (step 5), install Terraform (step 6).

### B2. Bootstrap shared infrastructure (once, not per-environment)
1. **Terraform state backend** — `terraform/README.md` step 7: create the S3 state bucket + DynamoDB lock table via the AWS CLI commands given there.
2. **ECR repository** — the chicken-and-egg noted in `terraform/README.md` step 9 and `specs/09`: a Lambda function needs a real image to exist before Terraform can create it, so:
   ```bash
   cd terraform
   terraform init -backend-config="bucket=$STATE_BUCKET" -backend-config="dynamodb_table=$LOCK_TABLE" \
     -backend-config="region=$REGION" -backend-config="key=serverless-job-scraper/dev/terraform.tfstate"
   terraform apply -target=aws_ecr_repository.job_scraper -var-file="envs/dev.tfvars" -var="alert_email=you@example.com"
   ```
3. **Build and push the first image**:
   ```bash
   aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$(terraform output -raw ecr_repository_url | cut -d/ -f1)"
   docker build -t "$(terraform output -raw ecr_repository_url):bootstrap" .
   docker push "$(terraform output -raw ecr_repository_url):bootstrap"
   ```

### B3. First real `terraform apply` — DEV
```bash
terraform apply -var-file="envs/dev.tfvars" -var="alert_email=you@example.com" \
  -var="container_image_uri=$(terraform output -raw ecr_repository_url):bootstrap"
```
This creates the full DEV stack: DynamoDB table, S3 bucket, SQS queue+DLQ, both Lambdas, IAM roles, SNS topic (no EventBridge schedule yet — `dev.tfvars` has `enable_schedule = false`, per `specs/12`).

**Verify**: `aws lambda invoke --function-name list-jobs-dev --payload '{"source":"seek","searchParams":{...}}' out.json` and check `out.json` plus the DynamoDB table for real items. Confirm the SNS subscription email (check your inbox, click confirm).

### B4. GitHub-side setup (so CI/CD can take over from here)
`specs/12-multi-environment-cicd.md`'s "GitHub-side one-time setup" section:
1. Create three GitHub Environments (`dev`, `uat`, `prod`); `prod` gets a required reviewer.
2. Set repo-level variables: `AWS_TERRAFORM_ROLE_ARN` (from B1.3), `AWS_REGION`, `TF_STATE_BUCKET`, `TF_STATE_LOCK_TABLE`, `ECR_REPOSITORY_URL` (from `terraform output ecr_repository_url`, or predict it — see `terraform/README.md` step 8).
3. Set `ALERT_EMAIL` inside each of the three Environments.

### B5. Let CI/CD take over
1. Open a PR (even a trivial one) — confirms `ci.yml` runs clean: typecheck, lint, unit tests, integration tests, and a `terraform plan` against DEV. This is where you'd catch anything left over from the Node 20→24 action bump.
2. Merge to `main` — `build.yml` builds a real image (tagged `sha-<gitsha>`), pushes it, and auto-deploys to DEV. This *replaces* the manual bootstrap apply from B3 with a proper CI-driven one going forward.
3. **Promote to UAT**: Actions tab → "Promote to UAT or PROD" → `environment: uat`, `image_tag: sha-<the one just deployed to dev>`.
4. **Promote to PROD**: same workflow, `environment: prod` — requires clicking through the required-reviewer approval. `prod.tfvars` is the only environment with `enable_schedule = true`, so this is the first time the real daily cron actually starts running.

**Done when**: `list-jobs-prod` has a live EventBridge schedule, and within a day you see real items landing in `ScrapedJobs-prod` and real HTML snapshots in the prod S3 bucket, with zero manual `terraform apply` needed for the next deploy.

---

## Suggested order (merging both tracks)

1. Track A (local runnable) — independent of AWS, do it whenever, unblocks manual testing for everything after.
2. B1 → B2 → B3 (AWS bootstrap + first manual DEV apply) — proves the infrastructure shape actually works before handing it to CI.
3. B4 (GitHub setup) → B5 (let CI/CD take over) — from here on, `main` merges auto-deploy to DEV, and UAT/PROD are one `workflow_dispatch` away.

## Optional / later (not blocking "runnable and deployable")

- Wire `webapp`'s job-browsing UI to read from DynamoDB instead of MongoDB (currently out of scope — `webapp` and this pipeline are independent until you decide to connect them).
- Add the Indeed/LinkedIn adapters (`specs/02`/`specs/03`'s extensibility point) — one adapter module + one `sources` entry in `terraform/variables.tf`, no other changes.
- Raise Lambda B's SQS batch size once real volume justifies amortizing browser cold-starts (`specs/05`'s deferred optimization).
