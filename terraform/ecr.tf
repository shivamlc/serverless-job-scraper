# specs/09-terraform-infra.md — one repository, shared by both Lambda functions
# (they differ only in image_config.command — see lambda.tf).

resource "aws_ecr_repository" "job_scraper" {
  name                 = "serverless-job-scraper"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "job_scraper" {
  repository = aws_ecr_repository.job_scraper.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep only the 10 most recent images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = { type = "expire" }
      }
    ]
  })
}
