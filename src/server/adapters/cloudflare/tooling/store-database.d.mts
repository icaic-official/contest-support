import type { D1Connection } from '../../d1/connection';

export function openStoreDatabase(options: {
  configPath: string;
  remoteBindings: boolean;
}): Promise<{ db: D1Connection; dispose: () => Promise<void> }>;
