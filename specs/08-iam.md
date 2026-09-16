# Spec 08 — IAM (Least Privilege)

Both roles are source-agnostic — adding a new adapter/source never requires an IAM change, since permissions are scoped to the shared table/queue/bucket, not to any one source.

## Lambda A role (`list-jobs`)

```jsonc
[
  { "Effect": "Allow", "Action": "sqs:SendMessage", "Resource": "arn:aws:sqs:<region>:<account-id>:job-scrape-queue" },
  { "Effect": "Allow", "Action": "dynamodb:Query", "Resource": "arn:aws:dynamodb:<region>:<account-id>:table/ScrapedJobs/index/listingUrl-index" }
]
```

## Lambda B role (`job-detail`)

```jsonc
[
  { "Effect": "Allow", "Action": ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], "Resource": "arn:aws:sqs:<region>:<account-id>:job-scrape-queue" },
  { "Effect": "Allow", "Action": "dynamodb:PutItem", "Resource": "arn:aws:dynamodb:<region>:<account-id>:table/ScrapedJobs" },
  { "Effect": "Allow", "Action": "s3:PutObject", "Resource": "arn:aws:s3:::job-snapshots-<account-id>/snapshots/*" }
]
```

Both roles also get `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents` scoped to `arn:aws:logs:<region>:<account-id>:*`.

## Explicitly forbidden on both roles

No `dynamodb:Scan`, no `s3:GetObject`/`s3:DeleteObject`, no `sqs:*` wildcard, no `dynamodb:*`/`s3:*` wildcard, no `Resource: "*"` on anything other than the CloudWatch Logs group-creation actions (which AWS requires to be unscoped for the initial `CreateLogGroup` call).

## GitHub Actions OIDC role (CI/CD, not a Lambda execution role)

A separate, third role assumed via GitHub's OIDC provider for `terraform plan`/`apply` (spec 10). Scope this to exactly the resource types this Terraform config manages (DynamoDB, S3, SQS, Lambda, ECR, EventBridge Scheduler, IAM role/policy management for the two roles above, CloudWatch/SNS) — this role is broader than either Lambda role by necessity (it provisions them), but should still never be `AdministratorAccess`.

## Acceptance criteria

- [ ] `terraform plan` shows exactly these two Lambda-role policy documents (no drift from copy-pasting a broader policy "to be safe").
- [ ] No IAM policy in `terraform/iam.tf` contains `"Resource": "*"` except the CloudWatch Logs group-creation statement.
- [ ] The GitHub OIDC role's trust policy is scoped to this specific repo (`repo:<org>/<repo>:*` or narrower), not any-repo.
