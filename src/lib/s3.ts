import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getRequiredEnv } from './env.js';

// Lazily constructed (not at module load) so that anything which sets env vars
// before first use — e.g. an integration test's beforeAll — takes effect. A
// module-load-time client would freeze `forcePathStyle` before such setup ran.
let client: S3Client | undefined;

function getClient(): S3Client {
  if (!client) {
    // AWS_S3_FORCE_PATH_STYLE: a conventional env var (used by SAM local,
    // LocalStack, MinIO, etc.) to switch off virtual-hosted-style bucket
    // addressing, which doesn't resolve correctly against a single local
    // endpoint. No-op against real AWS.
    client = new S3Client({
      forcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE === 'true',
    });
  }
  return client;
}

/** Infra wiring (which bucket to write snapshots to), set by Terraform — not site-search config. */
export function getSnapshotBucketName(): string {
  return getRequiredEnv('JOB_SNAPSHOT_BUCKET_NAME');
}

/** specs/05-lambda-job-detail.md — step 5, always before the DynamoDB write. */
export async function putSnapshot(bucket: string, key: string, html: string): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: html,
      ContentType: 'text/html; charset=utf-8',
    })
  );
}
