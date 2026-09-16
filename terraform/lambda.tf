# specs/09-terraform-infra.md — both functions reference the SAME container image,
# differing only in image_config.command and IAM role.

locals {
  # A placeholder image lets `terraform apply` create the functions before CD has
  # ever pushed a real image (first bootstrap only) — CD overwrites this on deploy.
  container_image_uri = coalesce(var.container_image_uri, "${aws_ecr_repository.job_scraper.repository_url}:bootstrap")
}

resource "aws_lambda_function" "list_jobs" {
  function_name = "list-jobs-${var.environment}"
  role          = aws_iam_role.list_jobs.arn
  package_type  = "Image"
  image_uri     = local.container_image_uri

  # specs/04: pagination + link extraction only, well under 15 min even for
  # dozens of pages.
  timeout     = 300
  memory_size = 1536

  reserved_concurrent_executions = var.list_jobs_reserved_concurrency

  image_config {
    command = ["handlers/listJobs.handler"]
  }

  environment {
    variables = {
      JOB_SCRAPE_QUEUE_URL         = aws_sqs_queue.job_scrape_queue.url
      SKIP_IF_SCRAPED_WITHIN_HOURS = tostring(var.skip_if_scraped_within_hours)
    }
  }
}

resource "aws_lambda_function" "job_detail" {
  function_name = "job-detail-${var.environment}"
  role          = aws_iam_role.job_detail.arn
  package_type  = "Image"
  image_uri     = local.container_image_uri

  # specs/05: one navigation + one extraction.
  timeout     = 120
  memory_size = 1536

  # specs/09 "Concurrency control" — a deliberate politeness/anti-bot-detection
  # throttle, not just a cost control.
  reserved_concurrent_executions = var.job_detail_reserved_concurrency

  image_config {
    command = ["handlers/jobDetail.handler"]
  }

  environment {
    variables = {
      JOB_SNAPSHOT_BUCKET_NAME = aws_s3_bucket.job_snapshots.bucket
    }
  }
}

resource "aws_lambda_event_source_mapping" "job_detail_from_queue" {
  event_source_arn = aws_sqs_queue.job_scrape_queue.arn
  function_name    = aws_lambda_function.job_detail.arn
  batch_size       = 1 # specs/05 — v1 stays at batch size 1
}

resource "aws_cloudwatch_log_group" "list_jobs" {
  name              = "/aws/lambda/${aws_lambda_function.list_jobs.function_name}"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "job_detail" {
  name              = "/aws/lambda/${aws_lambda_function.job_detail.function_name}"
  retention_in_days = 30
}
