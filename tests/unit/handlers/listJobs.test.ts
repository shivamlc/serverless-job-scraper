import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobSiteAdapter } from '../../../src/adapters/types.js';

vi.mock('../../../src/adapters/index.js');
vi.mock('../../../src/lib/browser.js');
vi.mock('../../../src/lib/config.js');
vi.mock('../../../src/lib/dynamo.js');
vi.mock('../../../src/lib/sqs.js');

import { getAdapter } from '../../../src/adapters/index.js';
import { handler } from '../../../src/handlers/listJobs.js';
import { launchBrowser } from '../../../src/lib/browser.js';
import { getSkipWindowHours } from '../../../src/lib/config.js';
import { findLastScrapedAt, isWithinFreshnessWindow } from '../../../src/lib/dynamo.js';
import { getJobScrapeQueueUrl, sendJobScrapeMessages } from '../../../src/lib/sqs.js';

const SEARCH_PARAMS = {
  keywords: 'software-engineer',
  cityLabel: 'Melbourne',
  citySlug: 'Melbourne-VIC-3000',
  dateRangeDays: 7,
  workType: 'full-time' as const,
};

function fakeAdapterYielding(count: number): JobSiteAdapter {
  return {
    source: 'seek',
    buildSearchUrl: () => 'https://fixture.test/search',
    listJobLinks: async function* () {
      for (let i = 1; i <= count; i++) {
        yield { jobId: String(i), url: `https://fixture.test/job/${i}` };
      }
    },
    scrapeJobDetail: async () => {
      throw new Error('not used by listJobs handler');
    },
  };
}

const fakeBrowser = {
  newPage: async () => ({}) as never,
  close: async () => {},
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(launchBrowser).mockResolvedValue(fakeBrowser as never);
  vi.mocked(getJobScrapeQueueUrl).mockReturnValue('https://sqs.example.test/queue');
  vi.mocked(getSkipWindowHours).mockReturnValue(24);
  vi.mocked(sendJobScrapeMessages).mockResolvedValue(undefined);
});

describe('handlers/listJobs (specs/04-lambda-list-jobs.md)', () => {
  it('batches enqueued jobs in groups of 10', async () => {
    vi.mocked(getAdapter).mockReturnValue(fakeAdapterYielding(25));
    vi.mocked(findLastScrapedAt).mockResolvedValue(null);

    const result = await handler({ source: 'seek', searchParams: SEARCH_PARAMS });

    expect(result).toEqual({ jobsFound: 25, jobsEnqueued: 25, jobsSkipped: 0 });
    expect(sendJobScrapeMessages).toHaveBeenCalledTimes(3);
    const [, firstBatch] = vi.mocked(sendJobScrapeMessages).mock.calls[0]!;
    expect(firstBatch).toHaveLength(10);
    const [, lastBatch] = vi.mocked(sendJobScrapeMessages).mock.calls[2]!;
    expect(lastBatch).toHaveLength(5);
    expect(firstBatch[0]).toEqual({
      source: 'seek',
      jobId: '1',
      url: 'https://fixture.test/job/1',
      cityLabel: 'Melbourne',
    });
  });

  it('skips jobs already scraped within the freshness window', async () => {
    vi.mocked(getAdapter).mockReturnValue(fakeAdapterYielding(4));
    vi.mocked(findLastScrapedAt).mockImplementation(async (url: string) =>
      url.endsWith('/2') || url.endsWith('/4') ? '2026-01-01T00:00:00.000Z' : null
    );
    vi.mocked(isWithinFreshnessWindow).mockImplementation((scrapedAt) => scrapedAt !== null);

    const result = await handler({ source: 'seek', searchParams: SEARCH_PARAMS });

    expect(result).toEqual({ jobsFound: 4, jobsEnqueued: 2, jobsSkipped: 2 });
    const [, batch] = vi.mocked(sendJobScrapeMessages).mock.calls[0]!;
    expect(batch.map((m) => m.jobId)).toEqual(['1', '3']);
  });

  it('throws on an unknown source before launching a browser', async () => {
    vi.mocked(getAdapter).mockImplementation(() => {
      throw new Error('No adapter registered for source "bogus"');
    });

    await expect(
      handler({ source: 'bogus' as never, searchParams: SEARCH_PARAMS })
    ).rejects.toThrow(/No adapter registered/);

    expect(launchBrowser).not.toHaveBeenCalled();
  });
});
