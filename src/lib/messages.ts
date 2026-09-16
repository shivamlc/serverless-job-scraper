import type { SearchParams } from '../adapters/types.js';
import type { JobSource } from '../types/job.js';

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
