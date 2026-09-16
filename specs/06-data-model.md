# Spec 06 — Data Model

## DynamoDB table `ScrapedJobs`

| Attribute | Type | Role |
|---|---|---|
| `jobKey` | String | **Partition key** — `${source}#${jobId}` |
| `scrapedAt` | String (ISO-8601) | **Sort key** |
| `source` | String | `"seek"` \| `"indeed"` \| `"linkedin"` |
| `jobId` | String | site's own job id, unprefixed |
| `title` | String | |
| `company` | String | |
| `location` | String | |
| `salary` | String | |
| `workType` | String | |
| `listingUrl` | String | |
| `postedDate` | String | |
| `sections` | List<Map<String,String>> | `{ heading, content }[]` |
| `fullText` | String | |
| `city` | String | from the originating search's `cityLabel`, not scraped from the job page |
| `snapshotKey` | String | S3 object key for this scrape's HTML snapshot |

- **GSI** `listingUrl-index`: partition key `listingUrl`, projection `KEYS_ONLY` plus `scrapedAt` (enough for Lambda A's skip-check — it only needs to know *whether and when* a URL was last scraped, not the full item).
- Billing mode: `PAY_PER_REQUEST`.
- No TTL in v1 (explicitly deferred — see spec 00 non-goals; add if/when scrape-history volume becomes a real storage cost).

## S3 bucket `job-snapshots-<account-id>`

- Key convention: `snapshots/{source}/{jobId}/{scrapedAt}.html` (`scrapedAt` is the same ISO string used as the DynamoDB sort key, so the two are trivially correlated).
- Lifecycle rule: transition to Glacier Instant Retrieval after 30 days.
- `aws_s3_bucket_public_access_block`: all four flags `true` (fully private).

## `buildJobKey` helper

```ts
// src/types/job.ts
export function buildJobKey(source: JobSource, jobId: string): string {
  return `${source}#${jobId}`;
}
```

Used by both Lambda B (to construct the item) and any future reader (to reconstruct the key from `source` + `jobId` without string-splitting `jobKey`).

## Acceptance criteria

- [ ] `buildJobKey('seek', '87654321')` returns `"seek#87654321"`.
- [ ] The Terraform `dynamodb.tf` resource's attribute/key schema matches this spec exactly (checked by `terraform validate` plus a manual read of the plan before first apply).
- [ ] No code outside `src/types/job.ts` constructs a `jobKey` by hand string-concatenation — always via `buildJobKey`.
