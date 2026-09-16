# Spec 09 — Terraform Infrastructure

## File layout

```
terraform/
  main.tf          # provider + version constraints
  backend.tf        # S3 backend + DynamoDB lock table for remote state
  variables.tf        # project_name, aws_region, sources (map)
  dynamodb.tf           # ScrapedJobs table + listingUrl-index GSI (spec 06)
  s3.tf                   # snapshot bucket + lifecycle + public-access-block (spec 06)
  sqs.tf                    # job-scrape-queue + job-scrape-dlq (spec 07)
  ecr.tf                      # one repository for the shared container image
  lambda.tf                     # 2 aws_lambda_function (image-based), reserved concurrency on B
  eventbridge.tf                  # for_each over var.sources → one schedule per source, invoking Lambda A
  iam.tf                             # 2 roles + policies (spec 08)
  sns.tf                                # alarm topic + email subscription (spec 07)
  outputs.tf                             # table name, queue URL, ECR repo URL, bucket name
```

## `variables.tf` — `sources`

```hcl
variable "sources" {
  type = map(object({
    schedule_expression = string
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
  }
}
```

Every field that's hardcoded in today's script (city, date range, salary band, work arrangement) is a plain Terraform value here — changing any of them is a `tfvars`/default edit, not a code change.

## `eventbridge.tf`

`for_each = var.sources`, one `aws_scheduler_schedule` per entry:
- `name = "list-jobs-${each.key}"`
- `schedule_expression = each.value.schedule_expression`
- Target: Lambda A's ARN, with input `jsonencode({ source = each.key, searchParams = each.value.search_params })`.
- Retry policy on the target: a small number of retries (e.g. 2) with a reasonable max age, so a transient EventBridge→Lambda invoke failure doesn't just vanish.

## `lambda.tf`

- Two `aws_lambda_function` resources, both `package_type = "Image"`, both referencing the **same** `aws_ecr_repository` image URI, differing only in `image_config { command = [...] }` (`handlers/listJobs.handler` vs `handlers/jobDetail.handler`) and their IAM role (spec 08).
- Lambda A: timeout 300s (5 min, per spec 04), memory 1536MB.
- Lambda B: timeout 120s (2 min, per spec 05), memory 1536MB, `reserved_concurrent_executions = 3` (politeness throttle — see roadmap's "Concurrency control").
- Lambda B has an `aws_lambda_event_source_mapping` from `job-scrape-queue`, `batch_size = 1`.

## `backend.tf`

S3 bucket for state + a small `PAY_PER_REQUEST` DynamoDB table for the lock — both provisioned once, out-of-band, before the rest of this config can be applied (a small bootstrap step; document the exact commands in `terraform/README.md` when this is built, not duplicated here).

## Guardrails for whoever (human or agent) runs Terraform in this repo

- **Never run `terraform apply` or `terraform destroy` without a human explicitly asking for that specific action in that specific session.** `terraform plan` is safe to run freely (read-only against real AWS state, given credentials) — `apply`/`destroy` touch real, billed, hard-to-reverse infrastructure.
- Always run `terraform plan` and read it before any `apply` — never `apply` blind, even when CD does it via CI (the CD pipeline's required-reviewer gate exists specifically so a human reads the plan first — see spec 10).

## Acceptance criteria

- [ ] `terraform fmt -check` and `terraform validate` both pass with no AWS credentials present (pure syntax/type checking).
- [ ] `terraform plan` (against a real or LocalStack-backed provider) shows exactly the resources enumerated above — no surprises, no `Resource: "*"` IAM statements (cross-check against spec 08).
- [ ] Adding a second entry to `var.sources` and re-running `plan` shows exactly one new `aws_scheduler_schedule` resource and no changes to any Lambda, queue, table, or bucket resource.
