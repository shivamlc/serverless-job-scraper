import {
  CreateTableCommand,
  DynamoDBClient,
  ResourceInUseException,
} from '@aws-sdk/client-dynamodb';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { CreateQueueCommand, GetQueueUrlCommand, SQSClient } from '@aws-sdk/client-sqs';

const ENDPOINT = process.env.LOCALSTACK_ENDPOINT ?? 'http://localhost:4566';
const REGION = 'ap-southeast-2';

const clientConfig = {
  endpoint: ENDPOINT,
  region: REGION,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
};

const s3ClientConfig = { ...clientConfig, forcePathStyle: true };

export const TABLE_NAME = 'ScrapedJobs';
export const BUCKET_NAME = 'job-snapshots-test';
export const QUEUE_NAME = 'job-scrape-queue-test';

/**
 * specs/11-testing-strategy.md — provisions the same shapes as terraform/dynamodb.tf,
 * s3.tf, sqs.tf (spec 09), but against LocalStack, so integration tests exercise real
 * AWS SDK calls without touching a real account.
 */
export async function setUpLocalstackResources(): Promise<{ queueUrl: string }> {
  const dynamo = new DynamoDBClient(clientConfig);
  const s3 = new S3Client(s3ClientConfig);
  const sqs = new SQSClient(clientConfig);

  try {
    await dynamo.send(
      new CreateTableCommand({
        TableName: TABLE_NAME,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
          { AttributeName: 'jobKey', AttributeType: 'S' },
          { AttributeName: 'scrapedAt', AttributeType: 'S' },
          { AttributeName: 'listingUrl', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'jobKey', KeyType: 'HASH' },
          { AttributeName: 'scrapedAt', KeyType: 'RANGE' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'listingUrl-index',
            KeySchema: [{ AttributeName: 'listingUrl', KeyType: 'HASH' }],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
      })
    );
  } catch (err) {
    if (!(err instanceof ResourceInUseException)) throw err;
  }

  try {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }));
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw err;
  }

  let queueUrl: string;
  try {
    const created = await sqs.send(new CreateQueueCommand({ QueueName: QUEUE_NAME }));
    queueUrl = created.QueueUrl!;
  } catch {
    const existing = await sqs.send(new GetQueueUrlCommand({ QueueName: QUEUE_NAME }));
    queueUrl = existing.QueueUrl!;
  }

  return { queueUrl };
}

export function configureAwsSdkForLocalstack(): void {
  process.env.AWS_ENDPOINT_URL = ENDPOINT;
  process.env.AWS_REGION = REGION;
  process.env.AWS_ACCESS_KEY_ID = 'test';
  process.env.AWS_SECRET_ACCESS_KEY = 'test';
  process.env.AWS_S3_FORCE_PATH_STYLE = 'true';
}
