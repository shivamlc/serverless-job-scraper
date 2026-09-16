# specs/09-terraform-infra.md
#
# Remote state backend. The bucket + lock table referenced here must be created
# once, out-of-band, BEFORE this backend block can be used (a classic bootstrapping
# chicken-and-egg problem — Terraform can't create the backend it's about to store
# its own state in). Bootstrap manually or via a tiny separate `bootstrap/` config
# with local state, then switch this repo's state to it.
#
# terraform init -backend-config="bucket=<state-bucket-name>" \
#                 -backend-config="dynamodb_table=<lock-table-name>" \
#                 -backend-config="region=<aws-region>"

terraform {
  backend "s3" {
    key     = "serverless-job-scraper/terraform.tfstate"
    encrypt = true
    # bucket, dynamodb_table, region intentionally omitted here — pass via
    # -backend-config at `terraform init` time (or a backend.hcl file, gitignored
    # if it contains anything environment-specific) so this file has no
    # environment-specific values hardcoded into version control.
  }
}
