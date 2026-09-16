# specs/09-terraform-infra.md — one schedule per var.sources entry. Adding a new
# source is a one-entry diff here; no other file changes.

resource "aws_scheduler_schedule_group" "job_scraper" {
  name = "serverless-job-scraper-${var.environment}"
}

data "aws_iam_policy_document" "scheduler_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler_invoke_list_jobs" {
  name               = "serverless-job-scraper-${var.environment}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume_role.json
}

resource "aws_iam_role_policy" "scheduler_invoke_list_jobs" {
  name = "invoke-list-jobs"
  role = aws_iam_role.scheduler_invoke_list_jobs.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = aws_lambda_function.list_jobs.arn
      }
    ]
  })
}

resource "aws_scheduler_schedule" "list_jobs" {
  # specs/12-multi-environment-cicd.md — DEV/UAT default enable_schedule = false:
  # the Lambdas/queue/table/bucket all still exist for manual testing, but only an
  # environment with enable_schedule = true actually runs the recurring scrape.
  for_each = var.enable_schedule ? var.sources : {}

  name                         = "list-jobs-${var.environment}-${each.key}"
  group_name                   = aws_scheduler_schedule_group.job_scraper.name
  schedule_expression          = each.value.schedule_expression
  schedule_expression_timezone = "Australia/Melbourne"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.list_jobs.arn
    role_arn = aws_iam_role.scheduler_invoke_list_jobs.arn

    input = jsonencode({
      source = each.key
      searchParams = {
        keywords        = each.value.search_params.keywords
        cityLabel       = each.value.search_params.city_label
        citySlug        = each.value.search_params.city_slug
        dateRangeDays   = each.value.search_params.date_range_days
        workType        = each.value.search_params.work_type
        salaryMin       = each.value.search_params.salary_min
        salaryMax       = each.value.search_params.salary_max
        salaryType      = each.value.search_params.salary_type
        workArrangement = each.value.search_params.work_arrangement
      }
    })

    retry_policy {
      maximum_retry_attempts       = 2
      maximum_event_age_in_seconds = 3600
    }
  }
}
