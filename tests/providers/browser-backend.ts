import type { Browser, BrowserContext, Request as BrowserRequest, WebSocketRoute } from '@playwright/test';
import type { Backend, Unsubscribe } from '../../src/backend/contracts';
import {
  ImageRequestError,
  WorkflowRejectedError,
} from '../../src/backend/errors';
import type { BrowserEvent, Request, Response } from './browser-protocol';

export interface BrowserBackend {
  backend: Backend;
  discardNextWorkflowResponse(): void;
  discardNextAccountResponse(): void;
  setLiveUpdatesPaused(paused: boolean): Promise<void>;
  close(): Promise<void>;
}

interface Options {
  origin: string;
  assetOrigin?: string;
  module: string;
  configuration: unknown;
  diagnostics?: BrowserDiagnostics;
}

export interface BrowserDiagnostics {
  observe(input: { method: string; url: string; status: number;
    durationMilliseconds: number; hasSessionCookie: boolean }): Promise<void>;
  flush(): Promise<void>;
  summary(): unknown;
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
  const diagnosticTasks = new Set<Promise<void>>();
  if (options.diagnostics) {
    const started = new WeakMap<BrowserRequest, number>();
    page.on('request', (request) => { started.set(request, performance.now()); });
    const observe = (request: BrowserRequest, status: number) => {
      const url = new URL(request.url());
      if (url.origin !== options.origin || !url.pathname.startsWith('/api/')) return;
      const start = started.get(request);
      const operation = (async () => {
        if (start === undefined) throw new Error('The provider request start was not recorded.');
        const cookie = await request.headerValue('cookie');
        await options.diagnostics!.observe({ method: request.method(), url: url.href, status,
          durationMilliseconds: performance.now() - start,
          hasSessionCookie: /(?:^|;\s*)(?:__Host-)?minsky-session=/.test(cookie ?? '') });
      })();
      diagnosticTasks.add(operation);
      // Keep rejected tasks until teardown. They must remain visible failures.
      void operation.then(() => diagnosticTasks.delete(operation), () => undefined);
    };
    page.on('response', (response) => { observe(response.request(), response.status()); });
    page.on('requestfailed', (request) => { observe(request, 0); });
  }
  const assetOrigin = options.assetOrigin ?? options.origin;
  let livePaused = false;
  const sockets = new Map<WebSocketRoute, WebSocketRoute>();
  // Exclude Vite's root socket. Provider sockets still use the real network.
  await context.routeWebSocket((url) => url.host !== new URL(assetOrigin).host || url.pathname !== '/', (socket) => {
    if (livePaused) {
      void socket.close({ code: 1013, reason: 'Fixture connection paused' });
      return;
    }
    const server = socket.connectToServer();
    sockets.set(socket, server);
    // A close listener replaces Playwright's automatic close forwarding.
    const closed = (peer: WebSocketRoute, code: number | undefined, reason: string | undefined) => {
      sockets.delete(socket);
      // Native browser sockets accept only 1000 or application close codes.
      track(peer.close({ code: code === 1000 || (code !== undefined && code >= 3000 && code <= 4999) ? code : 4000, reason }));
    };
    socket.onClose((code, reason) => closed(server, code, reason));
    server.onClose((code, reason) => closed(socket, code, reason));
  });
  if (new URL(assetOrigin).origin !== new URL(options.origin).origin) {
    // Only test and source assets come from Vite. API requests, WebSockets,
    // cookies, and request-forgery protection retain the hosted browser origin.
    // Vite's injected dynamic-import helper loads its client runtime from
    // node_modules/vite, outside the optimized .vite dependency directory.
    await context.route((url) => url.origin === new URL(options.origin).origin &&
      /^\/(?:tests\/providers\/|src\/|@vite\/|@id\/|@fs\/|@react-refresh$|node_modules\/(?:\.vite\/|vite\/dist\/client\/))/.test(url.pathname), async (route) => {
      const incoming = new URL(route.request().url());
      const target = new URL(incoming.pathname + incoming.search, assetOrigin);
      const response = await fetch(target, { redirect: 'error', headers: { Accept: route.request().headers().accept ?? '*/*' } });
      let body = Buffer.from(await response.arrayBuffer());
      if (incoming.pathname.endsWith('.html')) {
        // The bridge does not use hot reload. Avoid a development WebSocket on
        // the hosted origin when Vite inserts its optional client into HTML.
        body = Buffer.from(body.toString().replace(/<script\b[^>]*src=["']\/@vite\/client["'][^>]*><\/script>/g, ''));
      }
      await route.fulfill({ status: response.status, contentType: response.headers.get('Content-Type') ?? 'application/octet-stream', body });
    });
  }
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
    discardNextAccountResponse() {
      preparation = preparation.then(() => send<void>({ type: 'discardNextAccountResponse' }));
      track(preparation);
    },
    async setLiveUpdatesPaused(paused) {
      livePaused = paused;
      if (paused) {
        await Promise.all([...sockets].map(async ([socket, server]) => {
          await server.close({ code: 4000, reason: 'Fixture connection interrupted' });
          await socket.close({ code: 4000, reason: 'Fixture connection interrupted' });
        }));
        sockets.clear();
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      callbacks.clear();
      try {
        const diagnosticResults = await Promise.allSettled([...diagnosticTasks]);
        await options.diagnostics?.flush();
        if (options.diagnostics) console.log('Provider HTTP diagnostics: ' + JSON.stringify(options.diagnostics.summary()));
        if (diagnosticResults.some((result) => result.status === 'rejected')) {
          throw new Error('Provider HTTP diagnostics failed. Private details were withheld.');
        }
        await Promise.allSettled([...pending]);
        await send<void>({ type: 'close' });
      } finally {
        await context.close();
      }
    },
  };
}
