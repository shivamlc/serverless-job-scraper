# specs/06-data-model.md

resource "aws_dynamodb_table" "scraped_jobs" {
  name         = "ScrapedJobs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "jobKey"
  range_key    = "scrapedAt"

  attribute {
    name = "jobKey"
    type = "S"
  }

  attribute {
    name = "scrapedAt"
    type = "S"
  }

  attribute {
    name = "listingUrl"
    type = "S"
  }

  # specs/06: skip-check (Lambda A) only needs to know whether/when a URL was last
  # scraped, not the full item — INCLUDE keeps the index small and cheap.
  global_secondary_index {
    name               = "listingUrl-index"
    hash_key           = "listingUrl"
    projection_type    = "INCLUDE"
    non_key_attributes = ["scrapedAt"]
  }
}
