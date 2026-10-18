import type { Browser, BrowserContext } from '@playwright/test';
import type { Backend, Unsubscribe } from '../../src/backend/contracts';
import {
  ImageRequestError,
  WorkflowRejectedError,
} from '../../src/backend/errors';
import type { BrowserEvent, Request, Response } from './browser-protocol';

export interface BrowserBackend {
  backend: Backend;
  discardNextWorkflowResponse(): void;
  close(): Promise<void>;
}

interface Options {
  origin: string;
  module: string;
  configuration: unknown;
}

/** Each connection has its own cookie jar, storage, and real browser adapter. */
export async function createBrowserBackend(
  browser: Browser,
  options: Options,
): Promise<BrowserBackend> {
  const context: BrowserContext = await browser.newContext({
    baseURL: options.origin,
  });
  const page = await context.newPage();
  const callbacks = new Map<string, (event: BrowserEvent) => void>();
  const pending = new Set<Promise<void>>();
  let callbackFailure: unknown;
  let preparation = Promise.resolve();
  let closed = false;

  async function send<T>(request: Request): Promise<T> {
    const response = await page.evaluate(async (request) => {
      const module = '/tests/providers/browser-dispatch.ts';
      const dispatcher = await import(/* @vite-ignore */ module) as {
        dispatch(request: Request): Promise<Response>;
      };
      return dispatcher.dispatch(request);
    }, request);
    if (!response.ok) {
      const error = response.error;
      if (error.kind === 'rejected') {
        throw new WorkflowRejectedError(error.message);
      }
      if (error.kind === 'image') {
        throw new ImageRequestError(error.message, error);
      }
      throw new Error(error.message);
    }
    if (callbackFailure) throw callbackFailure;
    // The dispatcher returns the result of this exact typed Backend operation.
    return response.value as T;
  }

  async function call<T>(request: Request): Promise<T> {
    await preparation;
    return send<T>(request);
  }

  function track(operation: Promise<void>): void {
    pending.add(operation);
    void operation.catch((error: unknown) => {
      callbackFailure ??= error;
    }).finally(() => pending.delete(operation));
  }

  function subscribe(
    request: Request & { id: string },
    callback: (event: BrowserEvent) => void,
  ): Unsubscribe {
    const id = request.id;
    let active = true;
    callbacks.set(id, (event) => {
      if (active) callback(event);
    });
    const registered = call<void>(request);
    track(registered);
    return () => {
      if (!active) return;
      active = false;
      callbacks.delete(id);
      // Registration can still be in flight. The local guard takes effect now.
      track(registered.then(() => call<void>({ type: 'stop', id })));
    };
  }

  try {
    await page.exposeBinding(
      'minskyProviderEvent',
      (_source, event: BrowserEvent) => {
        try {
          callbacks.get(event.id)?.(event);
        } catch (error) {
          callbackFailure ??= error;
        }
      },
    );
    await page.goto('/tests/providers/browser.html');
    await page.evaluate(async (options) => {
      const module = '/tests/providers/browser-dispatch.ts';
      const dispatcher = await import(/* @vite-ignore */ module) as {
        initialize(module: string, configuration: unknown): Promise<void>;
      };
      await dispatcher.initialize(options.module, options.configuration);
    }, { module: options.module, configuration: options.configuration });
  } catch (error) {
    await context.close();
    throw error;
  }

  const backend: Backend = {
    auth: {
      currentUser: () => call({ type: 'currentUser' }),
      signIn: (username, password) =>
        call({ type: 'signIn', username, password }),
      signOut: () => call({ type: 'signOut' }),
      accountStatus: () => call({ type: 'accountStatus' }),
      changePassword: (currentPassword, newPassword) =>
        call({ type: 'changePassword', currentPassword, newPassword }),
      subscribe: (onChange) =>
        subscribe(
          { type: 'authSubscribe', id: crypto.randomUUID() },
          (event) => {
            if (event.type === 'auth') onChange(event.user);
          },
        ),
    },
    workflows: {
      sessions: (userId) => call({ type: 'sessions', userId }),
      snapshot: (sessionId) => call({ type: 'snapshot', sessionId }),
      execute: (sessionId, requestId, command) =>
        call({ type: 'execute', sessionId, requestId, command }),
    },
    admin: {
      account: (sessionId, command) =>
        call({ type: 'account', sessionId, command }),
      setIntake: (sessionId, open) =>
        call({ type: 'setIntake', sessionId, open }),
      setImageLimits: (sessionId, limits) =>
        call({ type: 'setImageLimits', sessionId, limits }),
      saveMember: (sessionId, userId, member) =>
        call({ type: 'saveMember', sessionId, userId, member }),
      removeMember: (sessionId, userId) =>
        call({ type: 'removeMember', sessionId, userId }),
    },
    images: {
      begin: (input) => call({ type: 'beginImage', input }),
      async upload(path, body, contentType, onProgress) {
        const id = crypto.randomUUID();
        callbacks.set(id, (event) => {
          if (event.type === 'progress') onProgress(event.loaded);
        });
        try {
          await call<void>({
            type: 'uploadImage',
            path,
            bytes: [...new Uint8Array(await body.arrayBuffer())],
            contentType,
            id,
          });
        } finally {
          callbacks.delete(id);
        }
      },
      finish: (sessionId, attachmentId) =>
        call({ type: 'finishImage', sessionId, attachmentId }),
      remove: (sessionId, attachmentId) =>
        call({ type: 'removeImage', sessionId, attachmentId }),
      abandon: (sessionId, attachmentId) =>
        call({ type: 'abandonImage', sessionId, attachmentId }),
      async download(path) {
        const result = await call<{ bytes: number[]; contentType: string }>({
          type: 'downloadImage',
          path,
        });
        return new Blob([Uint8Array.from(result.bytes)], {
          type: result.contentType,
        });
      },
    },
    updates: {
      subscribe: (input) =>
        subscribe({
          type: 'updatesSubscribe',
          id: crypto.randomUUID(),
          sessionId: input.sessionId,
          userId: input.userId,
        }, (event) => {
          if (event.type === 'connection') input.onConnection(event.connected);
          if (event.type === 'change') {
            const changed: (...args: unknown[]) => void = input.onChange;
            changed(...event.arguments);
          }
        }),
    },
  };
  return {
    backend,
    discardNextWorkflowResponse() {
      preparation = preparation.then(() =>
        send<void>({ type: 'discardNextWorkflowResponse' })
      );
      track(preparation);
    },
    async close() {
      if (closed) return;
      closed = true;
      callbacks.clear();
      try {
        await Promise.allSettled([...pending]);
        await send<void>({ type: 'close' });
      } finally {
        await context.close();
      }
    },
  };
}
