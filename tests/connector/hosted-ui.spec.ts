import { test } from '@playwright/test';
import { createFixture, cleanupFixture } from '../providers/cloudflare/fixture';
import { checkCloudflareBackend } from '../providers/cloudflare/target.mjs';
import { runUiJourney } from './ui-journey';

/** Only the guarded runner can select and mutate the exact hosted CI target. */
test('complete hosted Cloudflare UI journey preserves shared workflow, images, and access', async ({ browser }) => {
  const options = {
    account: process.env.MINSKY_CF_TEST_ACCOUNT ?? '', database: process.env.MINSKY_CF_TEST_DATABASE ?? '',
    config: process.env.MINSKY_CF_TEST_CONFIG ?? '', origin: process.env.MINSKY_CF_TEST_ORIGIN ?? '',
  };
  const journal = process.env.MINSKY_CF_UI_JOURNAL;
  if (!journal || process.env.PLAYWRIGHT_NO_COPY_PROMPT !== '1') {
    throw new Error('Use the guarded hosted UI runner. Fixture journal and credential-safe output settings are required.');
  }
  await checkCloudflareBackend(options);
  const fixture = await createFixture(journal);
  try { await runUiJourney(browser, fixture); }
  finally { await cleanupFixture(journal); }
});
