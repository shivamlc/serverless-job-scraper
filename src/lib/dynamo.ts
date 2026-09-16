import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { JobDetail } from '../types/job.js';
import { getRequiredEnv } from './env.js';

/**
 * Purpose: thin DynamoDB wrapper — the only module that talks to the
 * ScrapedJobs table directly (specs/06-data-model.md).
 * Exports: putJobDetail() — writes one scraped job item; findLastScrapedAt() —
 * the skip-check query against the listingUrl-index GSI; isWithinFreshnessWindow()
 * — pure helper deciding whether a lastScrapedAt is "recent enough" to skip.
 * Used by: src/handlers/jobDetail.ts (putJobDetail), src/handlers/listJobs.ts
 * (findLastScrapedAt + isWithinFreshnessWindow, specs/04's skip-check step).
 */
const LISTING_URL_INDEX = 'listingUrl-index';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Table name is environment-scoped (ScrapedJobs-dev/-uat/-prod, specs/12-multi-
// environment-cicd.md), set by Terraform as SCRAPED_JOBS_TABLE_NAME — never
// hardcode "ScrapedJobs" here, it won't match any real environment's table.
function getTableName(): string {
  return getRequiredEnv('SCRAPED_JOBS_TABLE_NAME');
}

/** specs/05-lambda-job-detail.md — step 6 */
export async function putJobDetail(item: JobDetail): Promise<void> {
  await client.send(
    new PutCommand({
      TableName: getTableName(),
      Item: item,
    })
  );
}

/**
 * specs/04-lambda-list-jobs.md — skip-check. Returns the most recent scrapedAt
 * for this listingUrl, or null if it has never been scraped.
 */
export async function findLastScrapedAt(listingUrl: string): Promise<string | null> {
  const result = await client.send(
    new QueryCommand({
      TableName: getTableName(),
      IndexName: LISTING_URL_INDEX,
      KeyConditionExpression: 'listingUrl = :listingUrl',
      ExpressionAttributeValues: { ':listingUrl': listingUrl },
      ScanIndexForward: false,
      Limit: 1,
    })
  );
  const item = result.Items?.[0];
  return typeof item?.scrapedAt === 'string' ? item.scrapedAt : null;
}

export function isWithinFreshnessWindow(scrapedAt: string, windowHours: number): boolean {
  const ageMs = Date.now() - new Date(scrapedAt).getTime();
  return ageMs < windowHours * 60 * 60 * 1000;
}
