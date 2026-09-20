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
| Git repo | ⚠️ `origin` is `github.com/shivamlc/serverless-job-scraper`, last push (`main`) is up to date — but Track A's work (below) is done locally and **not yet committed/pushed**. `git status` will show it. |
| **Local runnable end-to-end scrape** | ✅ **Done** — `npm run scrape:local` (Track A below), verified against the real live site, including two real bugs found and fixed by actually running it |
| `docs/roadmap.md` + self-containment | ✅ Roadmap copied in from the sibling repo, every cross-reference to that repo's soon-to-be-archived files reworded, so this repo no longer depends on it |
| GitHub Actions action versions (Node 20 deprecation) | ✅ Fixed — bumped `checkout`/`setup-node`/`github-script`/`configure-aws-credentials`/`setup-terraform` to their Node 24 majors. Not yet re-verified against a fresh CI run (nothing pushed since). |
| AWS account bootstrap (IAM, billing alarm, OIDC role) | ⬜ Not done (or in progress on your end — `terraform/README.md`) |
| Terraform state backend bootstrap | ⬜ Not done |
| First `terraform apply` (any environment) | ⬜ Not done — nothing is deployed to AWS yet |
| GitHub Environments + repo/environment variables | ⬜ Not done |
| First CI run since the Node 24 action fix | ⬜ Not verified — push Track A's changes and watch `ci.yml` to confirm |

---

## Track A — Runnable locally ✅ Done

`claude-job-search` (the sibling repo housing `seek-scrape-jobs.spec.ts`, `run-seek-scrape-jobs.sh`, and `webapp`) is slated for archiving, so this was rebuilt as a **self-contained** entrypoint inside this repo rather than by refactoring that sibling repo's files:

- **`scripts/scrapeLocal.ts`** — loads `SearchParams` via `loadSearchParamsFromEnv()`, drives `src/adapters/seek.ts` (`buildSearchUrl` → `listJobLinks` → `scrapeJobDetail`) against the real live site, writes to `seek-job-results.local.json` (gitignored).
- Run it: `npm run scrape:local` (override search params via `SCRAPE_*` env vars, cap the run with `SCRAPE_LOCAL_MAX_JOBS=N`).
- Compiles via `tsc -p tsconfig.scripts.json` rather than an esbuild-based runner (`tsx`) — esbuild's function-name-preservation helper broke `page.evaluate()` with `ReferenceError: __name is not defined`. See `README.md` "Running locally" step 4.
- `docs/roadmap.md` — the original design-rationale doc, copied in from `claude-job-search/aws-roadmap/` so it survives that repo's archiving; `specs/00-overview.md` now points here instead.

**Two real bugs found and fixed by actually running this against the live site** (fixtures alone couldn't have caught either):
1. Root `package.json` had `"type": "module"`, but both this script and the Lambda build (`tsconfig.build.json`) compile to CommonJS — the compiled output would `ReferenceError: exports is not defined` at runtime. This would have **crashed the deployed Lambda on cold start**, undetected until a real deploy. Fixed: `"type": "commonjs"`.
2. SEEK's real job URLs are `https://au.seek.com/job/94683535?type=promoted...` — the id is the **path segment** after `/job/`, not a `jobId=` query param. The original script's `/jobId=(\d+)/` regex (ported faithfully into `src/adapters/seek.ts`) silently matched nothing against the real site, producing an empty `jobId` on every job. Fixed in `src/adapters/seek.ts`'s `extractJobId` and the job-card extraction in `listJobLinks`; fixtures and tests updated to match.

**Optional, not yet done**: a small local script invoking `handlers/listJobs.ts`/`handlers/jobDetail.ts` directly against LocalStack (not through a deployed Lambda) for manual DynamoDB/S3 write-path testing — `tests/integration/*.integration.test.ts` already does exactly this, minus the assertions.

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

1. ~~Track A (local runnable)~~ — done, but still sitting uncommitted. Commit and push it before anything else below — `ci.yml` running on that push is the real (first) check that the Node 24 action-version fix actually works, and it's the cheapest way to confirm the `package.json` `"type": "commonjs"` change didn't break anything else.
2. B1 → B2 → B3 (AWS bootstrap + first manual DEV apply) — proves the infrastructure shape actually works before handing it to CI.
3. B4 (GitHub setup) → B5 (let CI/CD take over) — from here on, `main` merges auto-deploy to DEV, and UAT/PROD are one `workflow_dispatch` away.

## Optional / later (not blocking "runnable and deployable")

- A job-browsing UI reading from DynamoDB — the sibling `webapp` did this against MongoDB, but that repo is being archived; treat this as a from-scratch future project, not a migration.
- Add the Indeed/LinkedIn adapters (`specs/02`/`specs/03`'s extensibility point) — one adapter module + one `sources` entry in `terraform/variables.tf`, no other changes.
- Raise Lambda B's SQS batch size once real volume justifies amortizing browser cold-starts (`specs/05`'s deferred optimization).
