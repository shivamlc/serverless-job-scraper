# specs/07-queue-and-dlq.md

resource "aws_sns_topic" "job_scraper_alerts" {
  name = "job-scrape-alerts"
}

resource "aws_sns_topic_subscription" "job_scraper_alerts_email" {
  topic_arn = aws_sns_topic.job_scraper_alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_metric_alarm" "dlq_not_empty" {
  alarm_name          = "job-scrape-dlq-not-empty"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.job_scrape_dlq.name
  }

  alarm_actions = [aws_sns_topic.job_scraper_alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "list_jobs_errors" {
  alarm_name          = "list-jobs-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.list_jobs.function_name
  }

  alarm_actions = [aws_sns_topic.job_scraper_alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "job_detail_errors" {
  alarm_name          = "job-detail-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.job_detail.function_name
  }

  alarm_actions = [aws_sns_topic.job_scraper_alerts.arn]
}
