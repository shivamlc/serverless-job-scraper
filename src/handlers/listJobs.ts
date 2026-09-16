import { getAdapter } from '../adapters/index.js';
import { launchBrowser } from '../lib/browser.js';
import { getSkipWindowHours } from '../lib/config.js';
import { findLastScrapedAt, isWithinFreshnessWindow } from '../lib/dynamo.js';
import type { JobScrapeMessage, ListJobsEvent } from '../lib/messages.js';
import { getJobScrapeQueueUrl, sendJobScrapeMessages } from '../lib/sqs.js';

export interface ListJobsResult {
  jobsFound: number;
  jobsEnqueued: number;
  jobsSkipped: number;
}

/** specs/04-lambda-list-jobs.md */
export async function handler(event: ListJobsEvent): Promise<ListJobsResult> {
  const queueUrl = getJobScrapeQueueUrl();
  const skipWindowHours = getSkipWindowHours();
  const adapter = getAdapter(event.source); // throws on unknown source, before any browser launch

  const browser = await launchBrowser();
  let jobsFound = 0;
  let jobsSkipped = 0;
  let buffer: JobScrapeMessage[] = [];

  try {
    const page = await browser.newPage();
    const searchUrl = adapter.buildSearchUrl(event.searchParams);

    for await (const { jobId, url } of adapter.listJobLinks(page, searchUrl)) {
      jobsFound++;

      const lastScrapedAt = await findLastScrapedAt(url);
      if (lastScrapedAt && isWithinFreshnessWindow(lastScrapedAt, skipWindowHours)) {
        jobsSkipped++;
        continue;
      }

      buffer.push({
        source: event.source,
        jobId,
        url,
        cityLabel: event.searchParams.cityLabel,
      });

      if (buffer.length >= 10) {
        await sendJobScrapeMessages(queueUrl, buffer);
        buffer = [];
      }
    }

    if (buffer.length > 0) {
      await sendJobScrapeMessages(queueUrl, buffer);
    }
  } finally {
    await browser.close();
  }

  return { jobsFound, jobsEnqueued: jobsFound - jobsSkipped, jobsSkipped };
}
