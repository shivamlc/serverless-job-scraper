import type { Page } from 'playwright-core';
import type { JobSection, JobSource } from '../types/job.js';

/** specs/01-search-params-and-config.md */
export interface SearchParams {
  keywords: string;
  cityLabel: string;
  citySlug: string;
  dateRangeDays: number;
  workType: 'full-time' | 'part-time' | 'contract' | 'casual';
  salaryMin?: number;
  salaryMax?: number;
  salaryType?: 'annual' | 'hourly';
  workArrangement?: Array<'onsite' | 'hybrid' | 'remote'>;
}

export interface JobLink {
  jobId: string;
  url: string;
}

export interface ScrapedJobDetail {
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
  /** raw page.content() snapshot, captured at scrape time */
  html: string;
}

/** specs/02-adapter-interface.md */
export interface JobSiteAdapter {
  readonly source: JobSource;

  buildSearchUrl(params: SearchParams): string;

  listJobLinks(page: Page, searchUrl: string): AsyncGenerator<JobLink>;

  scrapeJobDetail(page: Page, url: string): Promise<ScrapedJobDetail>;
}
