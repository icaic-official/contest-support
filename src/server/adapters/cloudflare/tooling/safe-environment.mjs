import process from 'node:process';

const privateLogging = {
  WRANGLER_LOG_SANITIZE: 'true',
  WRANGLER_WRITE_LOGS: 'false',
  WRANGLER_SEND_METRICS: 'false',
};

/** Captured output does not stop Wrangler from writing its own debug files. */
export function safeWranglerEnvironment(environment = process.env) {
  return { ...environment, ...privateLogging };
}

/** Apply before importing Wrangler when its API runs in the current process. */
export function enforcePrivateWranglerLogging() {
  Object.assign(process.env, privateLogging);
}
