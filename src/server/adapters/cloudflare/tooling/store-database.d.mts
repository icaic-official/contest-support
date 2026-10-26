import type { D1Binding } from '../../d1/connection';

export function openStoreDatabase(options: {
  configPath: string;
  remoteBindings: boolean;
}): Promise<{ db: D1Binding; dispose: () => Promise<void> }>;
