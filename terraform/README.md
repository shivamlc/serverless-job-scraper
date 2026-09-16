# AWS Setup — Before `terraform apply`

This is the prerequisite checklist referenced from `backend.tf` — what has to exist in AWS and on your machine *before* any command in this `terraform/` directory will work. Nothing in this document runs Terraform itself; it's all account setup and bootstrapping that Terraform can't do for itself (a `terraform apply` can't create the backend it's about to store its own state in, and can't authenticate itself with credentials that don't exist yet).

Do these in order. Each step says whether it's a one-time AWS Console action or a CLI command you can run once credentials exist.

This account/tooling setup is done **once**, regardless of how many environments you run — DEV, UAT, and PROD (`../specs/12-multi-environment-cicd.md`) all live in this same account, sharing the state bucket/lock table from step 7 (via separate state-file keys) and the CI/CD OIDC role, and differ only by resource naming and Terraform variables.

---

## 0. At a glance

| # | Step | Where |
|---|---|---|
| 1 | Create/access an AWS account | Console |
| 2 | Secure the root user (MFA), stop using it day-to-day | Console |
| 3 | Create an IAM user for yourself to run Terraform with | Console or CLI (bootstrap) |
| 4 | Install & configure the AWS CLI locally | Your machine |
| 5 | Set a billing alarm / budget | Console or CLI |
| 6 | Install Terraform | Your machine |
| 7 | Bootstrap the Terraform remote state backend (S3 bucket + DynamoDB lock table) | CLI |
| 8 | Gather the Terraform variables you'll need | — |
| 9 | What happens right after this (ECR/Lambda bootstrap order) | — |

---

## 1. Create/access an AWS account

If you don't already have one: [aws.amazon.com](https://aws.amazon.com) → create an account. This creates the **root user** — an account with unlimited access tied to the email/password you sign up with. You will stop using it directly after step 2.

## 2. Secure the root user

1. **Enable MFA on the root user** (AWS Console → Security Credentials → Assign MFA device). Do this before anything else — the root user has no permission boundary, so it's the highest-value target to protect.
2. Do not create access keys for the root user. It should only ever be used for the handful of account-level actions that genuinely require it (closing the account, changing support plan, etc.) — never for day-to-day work, never for Terraform.

## 3. Create an IAM user for yourself

Create a named IAM user (not root) that you'll use to run Terraform from your laptop.

**Console**: IAM → Users → Create user → attach a policy (see below) → Security credentials tab → Create access key ("Command Line Interface (CLI)" use case) → save the access key ID + secret **once**, it's not shown again.

**Which policy to attach** — two options:

- **Simplest (recommended to start)**: attach the AWS-managed `AdministratorAccess` policy, with MFA required on the user (Console → the user → Security credentials → require MFA for console sign-in; for CLI use, consider requiring MFA via an assumed role rather than on the long-lived user itself). This is broader than this project strictly needs, but for a solo personal project it avoids spending your first session debugging permission errors instead of building infrastructure. Tighten later once things work.
- **Tighter least-privilege**, if you'd rather start scoped: attach a custom policy covering exactly the services this repo's Terraform manages — DynamoDB, S3, SQS, Lambda, ECR, EventBridge Scheduler, CloudWatch, SNS, Logs, plus IAM actions scoped to this project's own role-name prefix (so it can create/manage the two Lambda execution roles and the scheduler role in `iam.tf`/`eventbridge.tf`, but nothing else in the account's IAM):

  ```jsonc
  {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Sid": "ProjectServices",
        "Effect": "Allow",
        "Action": [
          "dynamodb:*", "s3:*", "sqs:*", "lambda:*", "ecr:*",
          "scheduler:*", "cloudwatch:*", "sns:*", "logs:*",
          "sts:GetCallerIdentity"
        ],
        "Resource": "*"
      },
      {
        "Sid": "ProjectIamRoles",
        "Effect": "Allow",
        "Action": [
          "iam:CreateRole", "iam:DeleteRole", "iam:GetRole",
          "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:GetRolePolicy",
          "iam:TagRole", "iam:PassRole"
        ],
        "Resource": "arn:aws:iam::*:role/serverless-job-scraper-*"
      }
    ]
  }
  ```

  (`dynamodb:*`/`s3:*`/etc. with `Resource: "*"` is still broader than the individual Lambda execution-role policies in `specs/08-iam.md` — those stay narrow. This is *your* operator identity for running Terraform, which unavoidably needs to create/modify these resource types across the account; it is not what gets deployed.)

## 4. Install & configure the AWS CLI locally

```bash
brew install awscli   # macOS; see AWS docs for other platforms
aws configure
# AWS Access Key ID: <from step 3>
# AWS Secret Access Key: <from step 3>
# Default region: ap-southeast-2   (or your preferred region — must match terraform/variables.tf's aws_region)
# Default output format: json
```

Verify it worked:

```bash
aws sts get-caller-identity
```

You should see your account ID and the IAM user ARN from step 3 — not `root`.

## 5. Set a billing alarm / budget

Cheap insurance before touching anything billed. Either:

- **Console**: Billing and Cost Management → Budgets → Create budget → a simple cost budget (e.g. $10/month threshold) with an email alert.
- **CLI**:
  ```bash
  aws budgets create-budget \
    --account-id "$(aws sts get-caller-identity --query Account --output text)" \
    --budget '{"BudgetName":"monthly-guardrail","BudgetLimit":{"Amount":"10","Unit":"USD"},"TimeUnit":"MONTHLY","BudgetType":"COST"}' \
    --notifications-with-subscribers '[{"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":80},"Subscribers":[{"SubscriptionType":"EMAIL","Address":"<your-email>"}]}]'
  ```

Given this project's own cost estimate (`../aws-roadmap/serverless-seek-scraper.md`) is effectively $0–1/month, a $10 threshold firing at all is itself a useful early signal that something's misconfigured (e.g. reserved concurrency not applied, a retry loop gone wrong).

## 6. Install Terraform

```bash
brew install terraform   # macOS
terraform version        # must satisfy >= 1.7.0 (terraform/main.tf)
```

## 7. Bootstrap the Terraform remote state backend

`backend.tf` needs an S3 bucket (state storage) and a DynamoDB table (state locking) to already exist — Terraform can't create the backend it's about to store its own state in. Create both manually, once, with the AWS CLI (names must be globally-unique for the bucket):

```bash
STATE_BUCKET="serverless-job-scraper-tfstate-$(aws sts get-caller-identity --query Account --output text)"
LOCK_TABLE="serverless-job-scraper-tflock"
REGION="ap-southeast-2"   # match terraform/variables.tf's aws_region

aws s3api create-bucket \
  --bucket "$STATE_BUCKET" \
  --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION"

aws s3api put-bucket-versioning \
  --bucket "$STATE_BUCKET" \
  --versioning-configuration Status=Enabled

aws s3api put-public-access-block \
  --bucket "$STATE_BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws dynamodb create-table \
  --table-name "$LOCK_TABLE" \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region "$REGION"
```

This bucket/table is **shared across every environment** (dev/uat/prod) — see `../specs/12-multi-environment-cicd.md`. Each environment gets its own state file *key* within it, so `terraform init` also needs a `key`, and every `apply`/`plan` needs `-var-file="envs/<environment>.tfvars"`:

```bash
cd terraform
ENVIRONMENT="dev"   # or uat / prod

terraform init \
  -backend-config="bucket=$STATE_BUCKET" \
  -backend-config="dynamodb_table=$LOCK_TABLE" \
  -backend-config="region=$REGION" \
  -backend-config="key=serverless-job-scraper/${ENVIRONMENT}/terraform.tfstate"
```

Running this locally for a second environment later (e.g. `uat` after `dev`) needs `terraform init -reconfigure` with that environment's `key` — each environment is a separate state file, so switching between them means re-pointing `init` at the right key, the same way `deploy.yml` does per-environment in CI.

## 8. Gather the Terraform variables you'll need

- `alert_email` — **required, no default** (`variables.tf`). The email that receives DLQ/Lambda-error alarms (spec 07) — you'll get an SNS confirmation email after the first `apply` that you must click to activate the subscription. Not in the committed `envs/*.tfvars` files (spec 12) — pass it explicitly, e.g. `TF_VAR_alert_email=you@example.com terraform apply ...` or `-var="alert_email=..."`.
- `environment` / `enable_schedule` — **required, no default** (spec 12). Use one of the committed `-var-file="envs/dev.tfvars"` / `envs/uat.tfvars` / `envs/prod.tfvars` rather than setting these by hand — only `prod`'s has `enable_schedule = true` (dev/uat provision the same infra but never run the real cron, to avoid tripling scrape traffic against the job site for no benefit).
- `container_image_uri` — leave unset for the very first `apply` (see step 9); a Lambda function needs a real image to exist in ECR before it can be created, so the full stack can't be applied in one shot on a brand-new account.
- Everything else (`sources`, `aws_region`, concurrency limits) has a sensible default matching today's SEEK/Melbourne behavior — override via `-var` only if you want to change something.

## 9. What happens right after this

Once steps 1–8 are done, the next thing is a **two-phase first apply** (not covered here, since it's a Terraform *usage* step rather than AWS *setup*): create the ECR repository first, push an initial image to it, then apply everything else with `container_image_uri` pointing at that image. `terraform/lambda.tf` and `terraform/ecr.tf` have the details; ask if you want this written up as its own doc when you get there.
