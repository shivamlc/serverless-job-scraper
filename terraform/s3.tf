# specs/06-data-model.md

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "job_snapshots" {
  bucket = "job-snapshots-${var.environment}-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "job_snapshots" {
  bucket = aws_s3_bucket.job_snapshots.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "job_snapshots" {
  bucket = aws_s3_bucket.job_snapshots.id

  rule {
    id     = "transition-old-snapshots-to-glacier-ir"
    status = "Enabled"

    filter {
      prefix = "snapshots/"
    }

    transition {
      days          = 30
      storage_class = "GLACIER_IR"
    }
  }
}
