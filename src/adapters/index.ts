import type { JobSiteAdapter } from './types.js';
import { seekAdapter } from './seek.js';

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
