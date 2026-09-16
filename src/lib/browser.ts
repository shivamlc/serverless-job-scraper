import type { Browser } from 'playwright-core';

/**
 * Purpose: environment-aware Playwright browser launcher — one function both
 * handlers call so neither has to know whether it's running in Lambda or locally.
 * Exports: launchBrowser().
 * Used by: src/handlers/listJobs.ts and src/handlers/jobDetail.ts (each launches
 * one browser per invocation and closes it in a `finally`).
 *
 * specs/09-terraform-infra.md (Packaging Playwright for Lambda).
 *
 * In the Lambda container image, launches the @sparticuz/chromium binary built for
 * Lambda's execution environment. Outside Lambda (local dev, tests), launches a normal
 * local Chromium via playwright-core, which requires `npx playwright install chromium`
 * once. This module — not src/adapters or src/handlers — is the one place allowed to
 * branch on the runtime environment, since it's a packaging concern, not search config.
 */
export async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import('playwright-core');

  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const sparticuzChromium = (await import('@sparticuz/chromium')).default;
    return chromium.launch({
      args: sparticuzChromium.args,
      executablePath: await sparticuzChromium.executablePath(),
      headless: true,
    });
  }

  return chromium.launch({ headless: true });
}
