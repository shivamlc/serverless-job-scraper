import type { SQSEvent, SQSHandler } from 'aws-lambda';
import { getAdapter } from '../adapters/index.js';
import { launchBrowser } from '../lib/browser.js';
import { putJobDetail } from '../lib/dynamo.js';
import type { JobScrapeMessage } from '../lib/messages.js';
import { getSnapshotBucketName, putSnapshot } from '../lib/s3.js';
import { buildJobKey } from '../types/job.js';

/**
 * Purpose: Lambda B's entrypoint ("job-detail", specs/05-lambda-job-detail.md) —
 * resolves the adapter for the message's source, scrapes exactly one job's detail
 * page + raw HTML snapshot, writes the snapshot to S3, then the structured item to
 * DynamoDB (S3 always before DynamoDB — see the comment below).
 * Exports: handler (the Lambda entrypoint — terraform/lambda.tf points at it as
 * "handlers/jobDetail.handler").
 * Triggered by: the SQS event source mapping on job-scrape-queue, batch size 1
 * (terraform/lambda.tf) — each invocation processes exactly one JobScrapeMessage.
 */
export const handler: SQSHandler = async (event: SQSEvent) => {
  const bucketName = getSnapshotBucketName();

  for (const record of event.Records) {
    const message = JSON.parse(record.body) as JobScrapeMessage;
    await processMessage(message, bucketName);
  }
};

async function processMessage(message: JobScrapeMessage, bucketName: string): Promise<void> {
  const adapter = getAdapter(message.source);
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    const scraped = await adapter.scrapeJobDetail(page, message.url);

    const scrapedAt = new Date().toISOString();
    const jobKey = buildJobKey(message.source, scraped.jobId);
    const snapshotKey = `snapshots/${message.source}/${scraped.jobId}/${scrapedAt}.html`;

    // specs/05: S3 write always before the DynamoDB write — a DynamoDB item must
    // never reference a snapshot that doesn't exist.
    await putSnapshot(bucketName, snapshotKey, scraped.html);

    await putJobDetail({
      jobKey,
      scrapedAt,
      source: message.source,
      jobId: scraped.jobId,
      title: scraped.title,
      company: scraped.company,
      location: scraped.location,
      salary: scraped.salary,
      workType: scraped.workType,
      listingUrl: scraped.listingUrl,
      postedDate: scraped.postedDate,
      sections: scraped.sections,
      fullText: scraped.fullText,
      city: message.cityLabel, // from the originating search, not the job page
      snapshotKey,
    });
  } finally {
    await browser.close();
  }
}
