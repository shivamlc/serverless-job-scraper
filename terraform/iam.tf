# specs/08-iam.md — least privilege, source-agnostic (scoped to shared resources,
# never to any one adapter/source, so adding a site never requires an IAM change).

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# ---- Lambda A: list-jobs ----

resource "aws_iam_role" "list_jobs" {
  name               = "serverless-job-scraper-${var.environment}-list-jobs"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "list_jobs" {
  statement {
    sid       = "SendToJobScrapeQueue"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.job_scrape_queue.arn]
  }

  statement {
    sid       = "QuerySkipCheckIndex"
    actions   = ["dynamodb:Query"]
    resources = ["${aws_dynamodb_table.scraped_jobs.arn}/index/listingUrl-index"]
  }

  statement {
    sid       = "WriteLogs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:*"]
  }
}

resource "aws_iam_role_policy" "list_jobs" {
  name   = "list-jobs-policy"
  role   = aws_iam_role.list_jobs.id
  policy = data.aws_iam_policy_document.list_jobs.json
}

# ---- Lambda B: job-detail ----

resource "aws_iam_role" "job_detail" {
  name               = "serverless-job-scraper-${var.environment}-job-detail"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "job_detail" {
  statement {
    sid       = "ConsumeJobScrapeQueue"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [aws_sqs_queue.job_scrape_queue.arn]
  }

  statement {
    sid       = "WriteScrapedJobs"
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.scraped_jobs.arn]
  }

  statement {
    sid       = "WriteSnapshots"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.job_snapshots.arn}/snapshots/*"]
  }

  statement {
    sid       = "WriteLogs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:*"]
  }
}

resource "aws_iam_role_policy" "job_detail" {
  name   = "job-detail-policy"
  role   = aws_iam_role.job_detail.id
  policy = data.aws_iam_policy_document.job_detail.json
}
