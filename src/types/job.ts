/**
 * Purpose: shared data types for a scraped job record, plus the one function
 * allowed to build a DynamoDB partition key from them (specs/06-data-model.md).
 * Exports: JobSource, JobSection, JobDetail, buildJobKey.
 * Used by: src/adapters/types.ts (JobSection in ScrapedJobDetail), src/handlers/jobDetail.ts
 * (constructs the JobDetail item), src/lib/dynamo.ts (item shape written to DynamoDB).
 */

export type JobSource = 'seek' | 'indeed' | 'linkedin';

export interface JobSection {
  heading: string;
  content: string;
}

/** DynamoDB `ScrapedJobs` item shape — see specs/06-data-model.md */
export interface JobDetail {
  jobKey: string; // partition key: `${source}#${jobId}`
  scrapedAt: string; // sort key, ISO-8601
  source: JobSource;
  jobId: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  workType: string;
  listingUrl: string;
  postedDate: string;
  sections: JobSection[];
  fullText: string;
  city: string;
  snapshotKey: string;
}

/** specs/06-data-model.md — the only place a jobKey should be constructed. */
export function buildJobKey(source: JobSource, jobId: string): string {
  return `${source}#${jobId}`;
}
