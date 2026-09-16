# Spec 07 — Queue & Dead-Letter Handling

## `job-scrape-queue`

- Type: Standard (not FIFO — order doesn't matter; writes are idempotent per spec 05).
- Consumer: Lambda B, batch size 1 (spec 05).
- Message body: `JobScrapeMessage` (spec 04), JSON-serialized.
- Visibility timeout: **≥ 6 × Lambda B's timeout** (spec 05: 2 min timeout → 12 min visibility timeout), so an in-flight message is never redelivered to a second concurrent worker while the first is still processing it.
- Redrive policy: `maxReceiveCount = 3` → `job-scrape-dlq`.

## `job-scrape-dlq`

- Type: Standard.
- No consumer — messages sit here until manually inspected/reprocessed or expire (default retention).
- CloudWatch Alarm: `ApproximateNumberOfMessagesVisible > 0` for 1 evaluation period → SNS topic `job-scrape-alerts` → email subscription.

## Acceptance criteria

- [ ] Terraform's `aws_sqs_queue.job_scrape_dlq` ARN is referenced in `job_scrape_queue`'s `redrive_policy` with `maxReceiveCount = 3`.
- [ ] The CloudWatch alarm's `treat_missing_data` is `notBreaching` (an empty DLQ producing no data points must not itself alarm).
- [ ] A message that fails processing 3 times in a LocalStack-based integration test lands in the DLQ, not silently disappears.
