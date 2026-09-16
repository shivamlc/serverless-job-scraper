import { ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { JobSiteAdapter } from '../../src/adapters/types.js';
import { configureAwsSdkForLocalstack, setUpLocalstackResources } from './localstackSetup.js';

vi.mock('../../src/adapters/index.js');
vi.mock('../../src/lib/browser.js');

import { getAdapter } from '../../src/adapters/index.js';
import { handler } from '../../src/handlers/listJobs.js';
import { launchBrowser } from '../../src/lib/browser.js';

let queueUrl: string;

beforeAll(async () => {
  configureAwsSdkForLocalstack();
  const setup = await setUpLocalstackResources();
  queueUrl = setup.queueUrl;
  process.env.JOB_SCRAPE_QUEUE_URL = queueUrl;
}, 30_000);

const fakeBrowser = { newPage: async () => ({}) as never, close: async () => {} };

function fakeAdapterYielding(links: Array<{ jobId: string; url: string }>): JobSiteAdapter {
  return {
    source: 'seek',
    buildSearchUrl: () => 'https://fixture.test/search',
    listJobLinks: async function* () {
      for (const link of links) yield link;
    },
    scrapeJobDetail: async () => {
      throw new Error('not used by this test — see seekAdapterNavigation.integration.test.ts');
    },
  };
}

/**
 * specs/11-testing-strategy.md: proves the real handler's DynamoDB skip-check +
 * SQS enqueueing wiring against LocalStack. The adapter itself is faked (no
 * browser/network) — adapter navigation is covered separately.
 */
describe('listJobs handler against LocalStack (specs/04, specs/11)', () => {
  it('enqueues a real SQS message for a newly-found job', async () => {
    vi.mocked(launchBrowser).mockResolvedValue(fakeBrowser as never);
    vi.mocked(getAdapter).mockReturnValue(
      fakeAdapterYielding([{ jobId: 'int-1', url: 'https://fixture.test/job/int-1' }])
    );

    const result = await handler({
      source: 'seek',
      searchParams: {
        keywords: 'software-engineer',
        cityLabel: 'Melbourne',
        citySlug: 'Melbourne-VIC-3000',
        dateRangeDays: 7,
        workType: 'full-time',
      },
    });

    expect(result).toEqual({ jobsFound: 1, jobsEnqueued: 1, jobsSkipped: 0 });

    // useQueueUrlAsEndpoint: false — LocalStack's returned QueueUrl uses a
    // sqs.<region>.localhost.localstack.cloud host the SDK would otherwise
    // switch to; keep it pinned to AWS_ENDPOINT_URL instead.
    const sqs = new SQSClient({ useQueueUrlAsEndpoint: false });
    const received = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, WaitTimeSeconds: 2, MaxNumberOfMessages: 5 })
    );
    const bodies = (received.Messages ?? []).map((m) => JSON.parse(m.Body ?? '{}'));
    expect(bodies).toContainEqual({
      source: 'seek',
      jobId: 'int-1',
      url: 'https://fixture.test/job/int-1',
      cityLabel: 'Melbourne',
    });
  }, 30_000);
});
