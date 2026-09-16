import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { JobSiteAdapter } from '../../src/adapters/types.js';
import type { JobScrapeMessage } from '../../src/lib/messages.js';
import { BUCKET_NAME, TABLE_NAME, configureAwsSdkForLocalstack, setUpLocalstackResources } from './localstackSetup.js';

vi.mock('../../src/adapters/index.js');
vi.mock('../../src/lib/browser.js');

import { getAdapter } from '../../src/adapters/index.js';
import { handler } from '../../src/handlers/jobDetail.js';
import { launchBrowser } from '../../src/lib/browser.js';

beforeAll(async () => {
  configureAwsSdkForLocalstack();
  await setUpLocalstackResources();
  process.env.JOB_SNAPSHOT_BUCKET_NAME = BUCKET_NAME;
}, 30_000);

const fakeBrowser = { newPage: async () => ({}) as never, close: async () => {} };

function fakeAdapter(): JobSiteAdapter {
  return {
    source: 'seek',
    buildSearchUrl: () => 'https://fixture.test/search',
    listJobLinks: async function* () {},
    scrapeJobDetail: async () => ({
      jobId: 'int-2',
      title: 'Integration Test Engineer',
      company: 'LocalStack Co',
      location: 'Melbourne VIC',
      salary: '$100,000',
      workType: 'Full time',
      listingUrl: 'https://fixture.test/job/int-2',
      postedDate: 'Posted today',
      sections: [{ heading: '(intro)', content: 'test content' }],
      fullText: 'test content',
      html: '<html><body>snapshot for int-2</body></html>',
    }),
  };
}

function makeSqsEvent(message: JobScrapeMessage) {
  return {
    Records: [
      {
        messageId: 'int-msg-1',
        receiptHandle: 'r1',
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
        eventSourceARN: 'arn:aws:sqs:ap-southeast-2:000000000000:job-scrape-queue-test',
        awsRegion: 'ap-southeast-2',
      },
    ],
  } as never;
}

/**
 * specs/11-testing-strategy.md: proves the real handler's S3-then-DynamoDB write
 * wiring against LocalStack. The adapter is faked (no browser/network).
 */
describe('jobDetail handler against LocalStack (specs/05, specs/11)', () => {
  it('writes a real S3 object and a matching DynamoDB item', async () => {
    vi.mocked(launchBrowser).mockResolvedValue(fakeBrowser as never);
    vi.mocked(getAdapter).mockReturnValue(fakeAdapter());

    const message: JobScrapeMessage = {
      source: 'seek',
      jobId: 'int-2',
      url: 'https://fixture.test/job/int-2',
      cityLabel: 'Melbourne',
    };

    await handler(makeSqsEvent(message), {} as never, () => {});

    // scrapedAt (part of the primary key) is generated at write time, so Query by
    // jobKey rather than GetItem with a guessed sort key value.
    const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
    const queried = await dynamo.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'jobKey = :jobKey',
        ExpressionAttributeValues: { ':jobKey': 'seek#int-2' },
      })
    );
    const item = queried.Items?.[0];
    expect(item).toBeTruthy();
    expect(item?.city).toBe('Melbourne');
    expect(item?.title).toBe('Integration Test Engineer');
    expect(item?.snapshotKey).toMatch(/^snapshots\/seek\/int-2\/.+\.html$/);

    const s3 = new S3Client({ forcePathStyle: true });
    const object = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET_NAME, Key: item?.snapshotKey })
    );
    const body = await object.Body?.transformToString();
    expect(body).toBe('<html><body>snapshot for int-2</body></html>');
  }, 30_000);
});
