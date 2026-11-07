import type { D1Binding } from '../../d1/connection';

export function openStoreDatabase(options: {
  configPath: string;
  remoteBindings: boolean;
}): Promise<{ db: D1Binding; dispose: () => Promise<void> }>;

export function openLocalPlatform<Env extends object>(configPath: string): Promise<{
  env: Omit<Env, 'DB'> & { DB: D1Binding };
  dispose: () => Promise<void>;
}>;

export function localD1(native: D1Binding): D1Binding;
