export interface FixtureTarget {
  accountId: string;
  databaseId: string;
  databaseName: string;
  workerName: string;
  bucketName: string;
  origin: string;
  configPath: string;
}
export const connectorTarget: Omit<FixtureTarget, 'configPath'>;
export function readFixtureTarget(options: { account: string; database: string; origin: string; config: string }): Promise<FixtureTarget>;
export function confirmFixtureTarget(target: FixtureTarget, run?: (arguments_: string[]) => string | Promise<string>): Promise<void>;
export function checkCloudflareBackend(options: { account: string; database: string; origin: string; config: string }, dependencies?: {
  runWrangler?: (arguments_: string[]) => string | Promise<string>;
  request?: typeof fetch;
}): Promise<FixtureTarget>;
