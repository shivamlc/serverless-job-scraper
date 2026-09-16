# Spec 10 — CI/CD Pipeline (GitHub Actions)

## `ci.yml` — every PR, required check

1. Checkout, setup Node (version pinned in `package.json` `engines`), `npm ci`.
2. `npm run typecheck` (`tsc --noEmit`).
3. `npm run lint`.
4. `npm test -- --coverage` (unit tests, spec 11) — no network, no AWS, no Docker required.
5. `npm run test:integration` (spec 11) — spins up LocalStack as a GitHub Actions service container; fails the job if LocalStack isn't healthy within a short startup timeout rather than hanging.
6. `terraform fmt -check` + `terraform validate` (no AWS credentials needed for these two).
7. `terraform plan` via **GitHub OIDC → the scoped AWS IAM role** (spec 08) — post the plan output as a PR comment. This step needs real AWS credentials (via OIDC, not stored secrets) and read access to the Terraform state backend; it does not need write access.

## `cd.yml` — on merge to `main`

1. Build the shared Docker image (spec 09's Dockerfile), tag with the git SHA, push to ECR.
2. `terraform apply` via the same OIDC role (a narrower, `apply`-capable identity than a human operator would use day-to-day) — updates the two Lambda functions' image tag plus any other changed infra.
3. This job runs inside a GitHub **Environment** (e.g. `production`) configured with a **required reviewer** — `apply` does not proceed without a human approval click. This is the one place in the whole pipeline where a human is required in the loop by construction, not by convention.

## `live-smoke-test.yml` — scheduled weekly + manually triggerable, NOT a required check

- Runs each registered adapter's `listJobLinks`/`scrapeJobDetail` against the real live site once (small scope — e.g. 1 page, 1 job), reports pass/fail.
- On failure, notify (SNS topic reuse, or a GitHub issue comment) — this is the early-warning signal for "the site changed its markup," deliberately isolated from `ci.yml` so an external site hiccup can never block an unrelated PR merge.

## Secrets & credentials

- **No long-lived AWS access keys stored as GitHub secrets, anywhere.** Both `ci.yml`'s `plan` step and `cd.yml`'s `apply` step authenticate via GitHub's OIDC provider assuming a role (spec 08) — this repo's CI should fail loudly if `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` ever appear as configured secrets, since their presence would mean someone bypassed the OIDC setup.
- The only other secret needed is the SNS-alert email / notification target, which isn't sensitive enough to need OIDC (it's a Terraform variable/tfvars value, not a credential).

## Acceptance criteria

- [ ] A PR that fails any of typecheck/lint/unit/integration/`terraform validate` cannot be merged (branch protection requires `ci.yml` to pass).
- [ ] `cd.yml` cannot run to completion without a reviewer approving the `production` Environment gate.
- [ ] `live-smoke-test.yml` failing does not affect `ci.yml`'s status on any PR.
- [ ] Repo secrets contain no raw AWS access key/secret pair.
