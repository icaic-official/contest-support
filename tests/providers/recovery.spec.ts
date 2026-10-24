import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { providerDriver } from './drivers';

test('remove only the fixture identified by the recovery journal', async () => {
  const path = process.env.MINSKY_PROVIDER_JOURNAL;
  if (!path) {
    throw new Error('Supply the recovery journal through test:providers.');
  }
  await providerDriver(process.env.MINSKY_TEST_PROVIDER).cleanup(path);
  expect(existsSync(path)).toBe(false);
});
