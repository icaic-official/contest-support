import { z } from 'zod';
import type { AccountIdentity, Backend } from '../../../src/backend/contracts';
import {
  ImageRequestError,
  WorkflowRejectedError,
} from '../../../src/backend/errors';
import type { BrowserProvider } from '../browser-protocol';

const configurationSchema = z.object({
  failClose: z.boolean().default(false),
  callbackAfterStop: z.boolean().default(false),
});

const statistics = { authenticationStops: 0, updateStops: 0, closes: 0 };

/** These observations test the browser bridge, not a hosted backend. */
export function bridgeStatistics() {
  return { ...statistics };
}

function unsupported(): never {
  throw new Error('This bridge fixture does not implement that operation.');
}

/** A synthetic provider with real browser cookie and binary behavior. */
export function createBrowserProvider(configuration: unknown): BrowserProvider {
  const options = configurationSchema.parse(configuration);
  const authentication = new Set<(user: AccountIdentity | undefined) => void>();
  const changes = new Set<() => void>();
  const images = new Map<string, Blob>();
  let discardResponse = false;

  async function currentUser(): Promise<AccountIdentity | undefined> {
    const response = await fetch('/bridge-auth');
    const id = await response.text();
    return id ? { id } : undefined;
  }

  const backend: Backend = {
    auth: {
      currentUser,
      async signIn(username) {
        await fetch('/bridge-auth', { method: 'POST', body: username });
        const user = await currentUser();
        for (const notify of authentication) notify(user);
      },
      async signOut() {
        await fetch('/bridge-auth', { method: 'DELETE' });
        for (const notify of authentication) notify(undefined);
      },
      async accountStatus() {
        return { username: null, must_change: false, session_valid: true };
      },
      changePassword: async () => unsupported(),
      subscribe(onChange) {
        authentication.add(onChange);
        onChange(undefined);
        return () => {
          statistics.authenticationStops++;
          authentication.delete(onChange);
          if (options.callbackAfterStop) {
            queueMicrotask(() => onChange({ id: 'late-callback' }));
          }
        };
      },
    },
    workflows: {
      sessions: async () => [],
      snapshot: async () => unsupported(),
      async execute(_sessionId, _requestId, command) {
        if (command.type === 'submit' && command.description === 'reject') {
          throw new WorkflowRejectedError('Fixture rejection.');
        }
        for (const notify of changes) notify();
        if (discardResponse) {
          discardResponse = false;
          throw new TypeError('Fixture lost response.');
        }
        return '00000000-0000-4000-8000-000000000001';
      },
    },
    admin: {
      account: async () => unsupported(),
      setIntake: async () => unsupported(),
      setImageLimits: async () => unsupported(),
      saveMember: async () => unsupported(),
      removeMember: async () => unsupported(),
    },
    images: {
      begin: async () => unsupported(),
      async upload(path, body, _contentType, onProgress) {
        onProgress(0);
        images.set(path, body);
        onProgress(body.size);
      },
      async finish() {
        throw new ImageRequestError('Fixture image failure.', {
          validation: true,
          restart: true,
          incomplete: true,
        });
      },
      remove: async () => unsupported(),
      abandon: async () => unsupported(),
      async download(path) {
        const image = images.get(path);
        if (!image) throw new Error('Fixture image is missing.');
        return image;
      },
    },
    announcements: {
      snapshot: async () => unsupported(),
      execute: async () => unsupported(),
      uploadImage: async () => unsupported(),
      removeImage: async () => unsupported(),
      downloadImage: async () => unsupported(),
    },
    updates: {
      subscribe(input) {
        changes.add(input.onChange);
        input.onConnection(true);
        return () => {
          statistics.updateStops++;
          changes.delete(input.onChange);
        };
      },
    },
  };

  return {
    backend,
    discardNextWorkflowResponse() {
      discardResponse = true;
    },
    discardNextAccountResponse() { unsupported(); },
    async close() {
      statistics.closes++;
      if (options.failClose) throw new Error('Fixture close failure.');
    },
  };
}
