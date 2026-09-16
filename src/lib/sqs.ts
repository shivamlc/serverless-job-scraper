import { SendMessageBatchCommand, SQSClient } from '@aws-sdk/client-sqs';
import { getRequiredEnv } from './env.js';
import type { JobScrapeMessage } from './messages.js';

// useQueueUrlAsEndpoint: false — don't let the SDK switch endpoints based on a
// QueueUrl's host (harmless against real AWS; avoids a LocalStack footgun where
// its returned QueueUrl host differs from the configured endpoint).
const client = new SQSClient({ useQueueUrlAsEndpoint: false });
const BATCH_SIZE = 10; // SQS's own per-call limit

/** Infra wiring (which queue to send to), set by Terraform — not site-search config. */
export function getJobScrapeQueueUrl(): string {
  return getRequiredEnv('JOB_SCRAPE_QUEUE_URL');
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** specs/04-lambda-list-jobs.md — step 4c, flushed in groups of 10. */
export async function sendJobScrapeMessages(
  queueUrl: string,
  messages: JobScrapeMessage[]
): Promise<void> {
  for (const batch of chunk(messages, BATCH_SIZE)) {
    const result = await client.send(
      new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: batch.map((message, index) => ({
          Id: `${message.jobId}-${index}`,
          MessageBody: JSON.stringify(message),
        })),
      })
    );
    if (result.Failed && result.Failed.length > 0) {
      throw new Error(
        `SendMessageBatch had ${result.Failed.length} failed entries: ${JSON.stringify(result.Failed)}`
      );
    }
  }
}
