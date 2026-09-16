variable "project_name" {
  type    = string
  default = "serverless-job-scraper"
}

variable "aws_region" {
  type    = string
  default = "ap-southeast-2"
}

# specs/12-multi-environment-cicd.md
variable "environment" {
  description = "dev | uat | prod — suffixed onto every environment-scoped resource name. The ECR repository is the one deliberate exception (shared across environments, see spec 12)."
  type        = string

  validation {
    condition     = contains(["dev", "uat", "prod"], var.environment)
    error_message = "environment must be one of: dev, uat, prod"
  }
}

variable "enable_schedule" {
  description = "specs/12 — whether to create the real EventBridge cron schedules. DEV/UAT default false: the infra exists and can be invoked manually, but only PROD should actually run the recurring scrape (running the same cron 3x across environments would triple real traffic against the job site for no benefit)."
  type        = bool
  default     = false
}

variable "alert_email" {
  description = "Email address subscribed to the DLQ / Lambda-error SNS alarm topic."
  type        = string
}

variable "container_image_uri" {
  description = "ECR image URI (with tag) to deploy for both Lambda functions. Set by CD after building/pushing (spec 10); a placeholder tag is fine for the first `terraform apply` that only needs to create the ECR repo."
  type        = string
  default     = null
  nullable    = true
}

# specs/01-search-params-and-config.md / specs/09-terraform-infra.md
#
# Every dimension that's hardcoded in today's script (city, date range, salary
# band, work arrangement) is a plain value here — changing any of them is a
# tfvars/default edit, not a code change. Adding a new source (Indeed, LinkedIn)
# is one more map entry, once its adapter (specs/02, specs/03) exists.
variable "sources" {
  description = "One entry per job-site source. Each gets its own EventBridge schedule invoking Lambda A with { source = <key>, searchParams = <search_params> }."
  type = map(object({
    schedule_expression = string
    search_params = object({
      keywords         = string
      city_label       = string
      city_slug        = string
      date_range_days  = number
      work_type        = string
      salary_min       = optional(number)
      salary_max       = optional(number)
      salary_type      = optional(string)
      work_arrangement = optional(list(string))
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

variable "skip_if_scraped_within_hours" {
  description = "specs/04 — how long a job is considered fresh enough to skip re-scraping."
  type        = number
  default     = 24
}

variable "list_jobs_reserved_concurrency" {
  type    = number
  default = -1 # unreserved — Lambda A runs once per source per cron trigger, no throttle needed
}

variable "job_detail_reserved_concurrency" {
  description = "specs/09 — politeness/anti-bot-detection throttle on Lambda B, not just a cost control."
  type        = number
  default     = 3
}
