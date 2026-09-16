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
