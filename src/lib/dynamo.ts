import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { JobDetail } from '../types/job.js';

const TABLE_NAME = 'ScrapedJobs';
const LISTING_URL_INDEX = 'listingUrl-index';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** specs/05-lambda-job-detail.md — step 6 */
export async function putJobDetail(item: JobDetail): Promise<void> {
  await client.send(
    new PutCommand({
      TableName: TABLE_NAME,
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
      TableName: TABLE_NAME,
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
