import type { SearchParams } from '../adapters/types.js';
import type { JobSource } from '../types/job.js';

/**
 * Purpose: the two payload shapes that cross a process boundary in this
 * pipeline — EventBridge Scheduler → Lambda A, and Lambda A → SQS → Lambda B.
 * Exports: ListJobsEvent, JobScrapeMessage.
 * Used by: src/handlers/listJobs.ts (receives ListJobsEvent, constructs and
 * sends JobScrapeMessage), src/handlers/jobDetail.ts (receives JobScrapeMessage
 * via the SQS event body), src/lib/sqs.ts (typed against JobScrapeMessage).
 */

/** specs/04-lambda-list-jobs.md — Lambda A's EventBridge Scheduler input event. */
export interface ListJobsEvent {
  source: JobSource;
  searchParams: SearchParams;
}

/** specs/04-lambda-list-jobs.md / specs/07-queue-and-dlq.md — job-scrape-queue message body. */
export interface JobScrapeMessage {
  source: JobSource;
  jobId: string;
  url: string;
  cityLabel: string;
}
