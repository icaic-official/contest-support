import type { Backend } from './contracts';
import { createCloudflareBackend } from './cloudflare/backend';

export const backend: Backend = createCloudflareBackend({ origin: location.origin });
