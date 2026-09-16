# specs/09-terraform-infra.md, specs/12-multi-environment-cicd.md
#
# Remote state backend. The bucket + lock table referenced here must be created
# once, out-of-band, BEFORE this backend block can be used (a classic bootstrapping
# chicken-and-egg problem — Terraform can't create the backend it's about to store
# its own state in). See terraform/README.md step 7 for the exact bootstrap commands.
#
# One bucket/lock table is shared across ALL environments — each environment gets
# its own state file *key* within it (specs/12), so `key` is passed via
# -backend-config too, not hardcoded here:
#
# terraform init -backend-config="bucket=<state-bucket-name>" \
#                 -backend-config="dynamodb_table=<lock-table-name>" \
#                 -backend-config="region=<aws-region>" \
#                 -backend-config="key=serverless-job-scraper/<dev|uat|prod>/terraform.tfstate"

terraform {
  backend "s3" {
    encrypt = true
    # bucket, dynamodb_table, region, key intentionally omitted here — all passed
    # via -backend-config at `terraform init` time so this file has no
    # environment-specific values hardcoded into version control.
  }
}
