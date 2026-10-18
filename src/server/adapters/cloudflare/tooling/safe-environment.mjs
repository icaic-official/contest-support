import process from 'node:process';

const privateLogging = {
  WRANGLER_LOG_SANITIZE: 'true',
  WRANGLER_WRITE_LOGS: 'false',
  WRANGLER_SEND_METRICS: 'false',
};

/** Keep reviewed targets and private logging independent of the operator's shell. */
export function safeWranglerEnvironment(environment = process.env) {
  const safe = { ...environment, ...privateLogging };
  delete safe.CLOUDFLARE_ENV;
  return safe;
}

/** Apply before importing Wrangler when its API runs in the current process. */
export function enforceWranglerEnvironment() {
  Object.assign(process.env, privateLogging);
  delete process.env.CLOUDFLARE_ENV;
}
