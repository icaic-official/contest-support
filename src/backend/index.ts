import type { Backend } from './contracts';
import { createSupabaseBackend } from './supabase/backend';
import { createCloudflareBackend } from './cloudflare/backend';

// Only public connection settings belong in a browser build.
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const provider = import.meta.env.VITE_BACKEND ?? 'supabase';
if (!['supabase', 'cloudflare'].includes(provider)) throw new Error('Set VITE_BACKEND to supabase or cloudflare.');

export const backend: Backend | undefined = provider === 'cloudflare'
  ? createCloudflareBackend({ origin: location.origin })
  : url && key ? createSupabaseBackend(url, key) : undefined;

export const backendSetupMessage =
  'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local. See docs/cloud-onboarding.md.';

export function requireBackend(): Backend {
  if (!backend) throw new Error(backendSetupMessage);
  return backend;
}
