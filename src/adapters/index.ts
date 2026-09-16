import type { JobSiteAdapter } from './types.js';
import { seekAdapter } from './seek.js';

/**
 * Purpose: the adapter registry/factory — the single place that maps a source
 * string ("seek", later "indeed"/"linkedin") to its JobSiteAdapter implementation
 * (specs/02-adapter-interface.md). Adding a new site is registering one more entry
 * here, never touching the handlers.
 * Exports: getAdapter(source).
 * Used by: src/handlers/listJobs.ts and src/handlers/jobDetail.ts — both resolve
 * their adapter through this function, never by importing src/adapters/seek.ts directly.
 */

/** specs/02-adapter-interface.md — add one entry per new adapter, never edit existing ones. */
const adapters: Record<string, JobSiteAdapter> = {
  seek: seekAdapter,
  // indeed: indeedAdapter,     // added later
  // linkedin: linkedinAdapter, // added later
};

export function getAdapter(source: string): JobSiteAdapter {
  const adapter = adapters[source];
  if (!adapter) {
    throw new Error(`No adapter registered for source "${source}"`);
  }
  return adapter;
}
