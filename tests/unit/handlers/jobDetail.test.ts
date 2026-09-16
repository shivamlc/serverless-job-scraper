import type { SQSEvent, SQSRecord } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobSiteAdapter, ScrapedJobDetail } from '../../../src/adapters/types.js';
import type { JobScrapeMessage } from '../../../src/lib/messages.js';

vi.mock('../../../src/adapters/index.js');
vi.mock('../../../src/lib/browser.js');
vi.mock('../../../src/lib/dynamo.js');
vi.mock('../../../src/lib/s3.js');

import { getAdapter } from '../../../src/adapters/index.js';
import { handler } from '../../../src/handlers/jobDetail.js';
import { launchBrowser } from '../../../src/lib/browser.js';
import { putJobDetail } from '../../../src/lib/dynamo.js';
import { getSnapshotBucketName, putSnapshot } from '../../../src/lib/s3.js';

function makeSqsEvent(message: JobScrapeMessage): SQSEvent {
  const record: SQSRecord = {
    messageId: 'msg-1',
    receiptHandle: 'receipt-1',
    body: JSON.stringify(message),
    attributes: {
      ApproximateReceiveCount: '1',
      SentTimestamp: '0',
      SenderId: 'test',
      ApproximateFirstReceiveTimestamp: '0',
    },
    messageAttributes: {},
    md5OfBody: 'irrelevant',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:ap-southeast-2:000000000000:job-scrape-queue',
    awsRegion: 'ap-southeast-2',
  };
  return { Records: [record] };
}

const SCRAPED: ScrapedJobDetail = {
  jobId: '99999999',
  title: 'Senior Software Engineer',
  company: 'Example Pty Ltd',
  location: 'Melbourne VIC',
  salary: '$120,000 - $140,000',
  workType: 'Full time',
  listingUrl: 'https://fixture.test/job?jobId=99999999',
  postedDate: 'Posted 2d ago',
  sections: [{ heading: 'Requirements', content: '5+ years experience' }],
  fullText: 'full text',
  html: '<html>snapshot</html>',
};

function fakeAdapter(scraped: ScrapedJobDetail = SCRAPED): JobSiteAdapter {
  return {
    source: 'seek',
    buildSearchUrl: () => 'https://fixture.test/search',
    listJobLinks: async function* () {},
    scrapeJobDetail: async () => scraped,
  };
}

const fakeBrowser = {
  newPage: async () => ({}) as never,
  close: async () => {},
};

let callOrder: string[];

beforeEach(() => {
  vi.clearAllMocks();
  callOrder = [];
  vi.mocked(launchBrowser).mockResolvedValue(fakeBrowser as never);
  vi.mocked(getSnapshotBucketName).mockReturnValue('job-snapshots-test');
  vi.mocked(putSnapshot).mockImplementation(async () => {
    callOrder.push('putSnapshot');
  });
  vi.mocked(putJobDetail).mockImplementation(async () => {
    callOrder.push('putJobDetail');
  });
});

describe('handlers/jobDetail (specs/05-lambda-job-detail.md)', () => {
  it('writes the S3 snapshot before the DynamoDB item, with matching snapshotKey', async () => {
    vi.mocked(getAdapter).mockReturnValue(fakeAdapter());

    const message: JobScrapeMessage = {
      source: 'seek',
      jobId: '99999999',
      url: 'https://fixture.test/job?jobId=99999999',
      cityLabel: 'Melbourne',
    };

    await handler(makeSqsEvent(message), {} as never, () => {});

    expect(callOrder).toEqual(['putSnapshot', 'putJobDetail']);

    const [, snapshotKeyArg] = vi.mocked(putSnapshot).mock.calls[0]!;
    const [item] = vi.mocked(putJobDetail).mock.calls[0]!;

    expect(item.jobKey).toBe('seek#99999999');
    expect(item.snapshotKey).toBe(snapshotKeyArg);
    expect(item.snapshotKey).toMatch(/^snapshots\/seek\/99999999\/.+\.html$/);
    expect(item.city).toBe('Melbourne'); // from the message, not the scraped page
    expect(item.source).toBe('seek');
  });

  it('never writes to S3 or DynamoDB if scrapeJobDetail throws', async () => {
    vi.mocked(getAdapter).mockReturnValue({
      ...fakeAdapter(),
      scrapeJobDetail: async () => {
        throw new Error('navigation failed');
      },
    });

    const message: JobScrapeMessage = {
      source: 'seek',
      jobId: '1',
      url: 'https://fixture.test/job?jobId=1',
      cityLabel: 'Melbourne',
    };

    await expect(handler(makeSqsEvent(message), {} as never, () => {})).rejects.toThrow(
      'navigation failed'
    );

    expect(putSnapshot).not.toHaveBeenCalled();
    expect(putJobDetail).not.toHaveBeenCalled();
  });

  it('never writes to DynamoDB if the S3 write fails', async () => {
    vi.mocked(getAdapter).mockReturnValue(fakeAdapter());
    vi.mocked(putSnapshot).mockRejectedValue(new Error('S3 unavailable'));

    const message: JobScrapeMessage = {
      source: 'seek',
      jobId: '1',
      url: 'https://fixture.test/job?jobId=1',
      cityLabel: 'Melbourne',
    };

    await expect(handler(makeSqsEvent(message), {} as never, () => {})).rejects.toThrow(
      'S3 unavailable'
    );

    expect(putJobDetail).not.toHaveBeenCalled();
  });
});
