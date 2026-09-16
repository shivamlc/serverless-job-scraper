import type { Page } from 'playwright-core';
import type { JobSection, JobSource } from '../types/job.js';

/**
 * Purpose: the site-agnostic contract this whole pipeline is built around — the
 * common search-config shape (SearchParams, specs/01) and the interface every
 * job-site scraper implements (JobSiteAdapter, specs/02). No implementation lives
 * here, only types.
 * Exports: SearchParams, JobLink, ScrapedJobDetail, JobSiteAdapter.
 * Used by: src/adapters/seek.ts (implements JobSiteAdapter), src/adapters/index.ts
 * (registry is typed against JobSiteAdapter), src/handlers/listJobs.ts and
 * src/handlers/jobDetail.ts (consume adapters via this interface, never a concrete class).
 */

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
