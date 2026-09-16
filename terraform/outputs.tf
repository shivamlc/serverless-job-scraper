output "scraped_jobs_table_name" {
  value = aws_dynamodb_table.scraped_jobs.name
}

output "job_snapshots_bucket_name" {
  value = aws_s3_bucket.job_snapshots.bucket
}

output "job_scrape_queue_url" {
  value = aws_sqs_queue.job_scrape_queue.url
}

output "job_scrape_dlq_url" {
  value = aws_sqs_queue.job_scrape_dlq.url
}

output "ecr_repository_url" {
  value = aws_ecr_repository.job_scraper.repository_url
}

output "list_jobs_function_name" {
  value = aws_lambda_function.list_jobs.function_name
}

output "job_detail_function_name" {
  value = aws_lambda_function.job_detail.function_name
}
