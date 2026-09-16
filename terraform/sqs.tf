# specs/07-queue-and-dlq.md

resource "aws_sqs_queue" "job_scrape_dlq" {
  name = "job-scrape-dlq"
}

resource "aws_sqs_queue" "job_scrape_queue" {
  name = "job-scrape-queue"

  # Lambda B's timeout is 120s (specs/05) — 6x that, per AWS's own guidance, so an
  # in-flight message is never redelivered to a second concurrent worker while the
  # first is still processing it.
  visibility_timeout_seconds = 720

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.job_scrape_dlq.arn
    maxReceiveCount      = 3
  })
}
