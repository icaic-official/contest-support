import {
  type Browser,
  type BrowserContext,
  expect,
  test,
} from '@playwright/test';
import {
  ImageRequestError,
  WorkflowRejectedError,
} from '../src/backend/errors';
import { createBrowserBackend } from './providers/browser-backend';

// Even a fixture failure must not write a DOM snapshot or call arguments.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

async function connection(
  browser: Browser,
  origin: string | undefined,
  configuration: unknown = {},
) {
  if (!origin) {
    throw new Error('The bridge tests require a configured base URL.');
  }
  const previous = new Set(browser.contexts());
  const client = await createBrowserBackend(browser, {
    origin,
    module: '/tests/providers/support/bridge-provider.ts',
    configuration,
  });
  const context = browser.contexts().find((candidate) =>
    !previous.has(candidate)
  );
  if (!context) {
    throw new Error('The bridge did not create an isolated context.');
  }
  await context.route('**/bridge-auth', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const username = encodeURIComponent(request.postData() ?? '');
      await route.fulfill({
        body: '',
        headers: {
          'Set-Cookie':
            `bridge_identity=${username}; Path=/; HttpOnly; SameSite=Strict`,
        },
      });
    } else if (request.method() === 'DELETE') {
      await route.fulfill({
        body: '',
        headers: {
          'Set-Cookie': 'bridge_identity=; Path=/; HttpOnly; Max-Age=0',
        },
      });
    } else {
      const cookies = await request.headerValue('cookie') ?? '';
      const identity = cookies.split(';').map((cookie) => cookie.trim())
        .find((cookie) => cookie.startsWith('bridge_identity='))?.slice(
          'bridge_identity='.length,
        );
      await route.fulfill({
        body: identity ? decodeURIComponent(identity) : '',
      });
    }
  });
  return { client, context };
}

async function statistics(context: BrowserContext) {
  return context.pages()[0].evaluate(async () => {
    // Vite adds this query when the browser dispatcher imports the fixture.
    const module = '/tests/providers/support/bridge-provider.ts?import';
    const provider = await import(/* @vite-ignore */ module) as {
      bridgeStatistics(): {
        authenticationStops: number;
        updateStops: number;
        closes: number;
      };
    };
    return provider.bridgeStatistics();
  });
}

const command = {
  type: 'submit' as const,
  category: 'Other',
  description: 'Fixture command.',
};

test('provider bridge isolates HttpOnly sessions for different actors', async ({ browser, baseURL }) => {
  const first = await connection(browser, baseURL);
  const second = await connection(browser, baseURL);
  try {
    await first.client.backend.auth.signIn('first-account', 'fixture-only');
    await second.client.backend.auth.signIn('second-account', 'fixture-only');
    expect(await first.client.backend.auth.currentUser()).toEqual({
      id: 'first-account',
    });
    expect(await second.client.backend.auth.currentUser()).toEqual({
      id: 'second-account',
    });
    expect(await first.context.pages()[0].evaluate(() => document.cookie)).toBe(
      '',
    );
    expect(
      (await first.context.cookies()).find((cookie) =>
        cookie.name === 'bridge_identity'
      )?.httpOnly,
    ).toBe(true);
    await first.client.backend.auth.signOut();
    expect(await first.client.backend.auth.currentUser()).toBeUndefined();
    expect(await second.client.backend.auth.currentUser()).toEqual({
      id: 'second-account',
    });
  } finally {
    await Promise.all([first.client.close(), second.client.close()]);
  }
});

test('provider bridge retains typed failures and uncertain write outcomes', async ({ browser, baseURL }) => {
  const { client } = await connection(browser, baseURL);
  try {
    await expect(client.backend.workflows.execute('session', 'request', {
      ...command,
      description: 'reject',
    })).rejects.toBeInstanceOf(WorkflowRejectedError);
    const imageError: unknown = await client.backend.images.finish(
      'session',
      'image',
    ).catch((error: unknown) => error);
    expect(imageError).toBeInstanceOf(ImageRequestError);
    expect(imageError).toMatchObject({
      validation: true,
      restart: true,
      incomplete: true,
    });
    client.discardNextWorkflowResponse();
    const failure: unknown = await client.backend.workflows.execute(
      'session',
      'request',
      command,
    )
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(WorkflowRejectedError);
    expect(failure).toMatchObject({ message: 'Fixture lost response.' });
    await expect(
      client.backend.workflows.execute('session', 'request', command),
    )
      .resolves.toBe('00000000-0000-4000-8000-000000000001');
  } finally {
    await client.close();
  }
});

test('provider bridge transfers binary bytes and completes progress before upload resolves', async ({ browser, baseURL }) => {
  const { client } = await connection(browser, baseURL);
  try {
    const bytes = Uint8Array.from([0, 255, 128, 65, 13, 10]);
    const body = new Blob([bytes], { type: 'image/png' });
    const progress: number[] = [];
    await client.backend.images.upload(
      'fixture-image',
      body,
      body.type,
      (loaded) => progress.push(loaded),
    );
    expect(progress).toEqual([0, bytes.length]);
    const download = await client.backend.images.download('fixture-image');
    expect(download.type).toBe(body.type);
    expect([...new Uint8Array(await download.arrayBuffer())]).toEqual([
      ...bytes,
    ]);
  } finally {
    await client.close();
  }
});

test('provider bridge stops immediate subscriptions once and retains active callbacks', async ({ browser, baseURL }) => {
  const { client, context } = await connection(browser, baseURL);
  try {
    let authenticationChanges = 0;
    const stopAuthentication = client.backend.auth.subscribe(() => {
      authenticationChanges++;
    });
    stopAuthentication();
    stopAuthentication();
    await expect.poll(async () =>
      (await statistics(context)).authenticationStops
    ).toBe(1);
    await client.backend.auth.signIn('fixture-account', 'fixture-only');
    expect(authenticationChanges).toBe(0);

    let connected = false;
    let changes = 0;
    const stopUpdates = client.backend.updates.subscribe({
      sessionId: 'session',
      userId: 'fixture-account',
      onConnection: (value) => {
        connected = value;
      },
      onChange: () => {
        changes++;
      },
    });
    await expect.poll(() => connected).toBe(true);
    await client.backend.workflows.execute('session', 'request', command);
    expect(changes).toBe(1);
    stopUpdates();
    stopUpdates();
    await expect.poll(async () => (await statistics(context)).updateStops).toBe(
      1,
    );
    await client.backend.workflows.execute(
      'session',
      'another-request',
      command,
    );
    expect(changes).toBe(1);
  } finally {
    await client.close();
  }
});

test('provider bridge reports real adapter callbacks after unsubscribe', async ({ browser, baseURL }) => {
  const { client, context } = await connection(browser, baseURL, {
    callbackAfterStop: true,
  });
  const stop = client.backend.auth.subscribe(() => {});
  stop();
  await expect.poll(async () => (await statistics(context)).authenticationStops)
    .toBe(1);
  await expect(client.backend.auth.accountStatus()).rejects.toThrow(
    'callback after its unsubscribe returned',
  );
  await expect(client.close()).rejects.toThrow(
    'callback after its unsubscribe returned',
  );
  expect(browser.contexts()).not.toContain(context);
});

test('provider bridge closes its browser context when provider cleanup fails', async ({ browser, baseURL }) => {
  const { client, context } = await connection(browser, baseURL, {
    failClose: true,
  });
  await expect(client.close()).rejects.toThrow('Fixture close failure.');
  expect(browser.contexts()).not.toContain(context);
  await expect(client.close()).resolves.toBeUndefined();
});

test('provider bridge loads real adapters through Vite at a remote HTTPS browser origin without credentials', async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error('The bridge regression requires local Vite assets.');
  const origin = 'https://provider-bridge.invalid';
  const failures: Array<{ path: string; kind: string }> = [];
  const apiRequests: Array<{ origin: string; path: string }> = [];
  const responses: Array<{ path: string; status: number; mime: string | undefined }> = [];
  const consoleKinds: string[] = [];
  const assetRequests: string[] = [];
  const updateSockets: string[] = [];
  let preferenceCookieReceived = false;
  const previous = new Set(browser.contexts());
  // Observe the actual context before the bridge's first navigation. This
  // wrapper changes no response for the Vite module graph under test.
  const observedBrowser = Object.create(browser) as Browser;
  observedBrowser.newContext = async (options) => {
    const context = await browser.newContext(options);
    context.on('page', (page) => {
      page.on('response', (response) => { responses.push({ path: new URL(response.url()).pathname,
        status: response.status(), mime: response.headers()['content-type'] }); });
      page.on('console', (message) => { if (message.type() === 'error') consoleKinds.push(
        message.text().includes('MIME') ? 'mime' : message.text().includes('CORS') ? 'cors' : 'other'); });
      page.on('requestfailed', (request) => {
        failures.push({ path: new URL(request.url()).pathname, kind: request.failure()?.errorText ?? 'unknown' });
      });
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname.startsWith('/api/')) apiRequests.push({ origin: url.origin, path: url.pathname });
        else assetRequests.push(url.pathname);
      });
    });
    // This harmless preference tests same-origin cookie transport. It grants
    // no identity or session access and is never sent to a real provider.
    await context.addCookies([{ name: 'bridge_preference', value: 'compact', url: origin,
      secure: true, httpOnly: true, sameSite: 'Strict' }]);
    // No account or credentials are used. API/socket responses are test probes;
    // every JavaScript module comes from the real local Vite server.
    await context.route(`${origin}/api/auth/session`, async (route) => {
      preferenceCookieReceived = (await route.request().headerValue('cookie') ?? '').includes('bridge_preference=compact');
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
    });
    await context.routeWebSocket((url) => url.origin === origin.replace('https:', 'wss:') && url.pathname === '/api/updates', (socket) => {
      updateSockets.push(socket.url());
      socket.send('{"type":"ready"}');
    });
    return context;
  };
  let client;
  try {
    client = await createBrowserBackend(observedBrowser, {
      origin, assetOrigin: baseURL, module: '/tests/providers/cloudflare/browser.ts', configuration: { origin },
    });
  } catch (error) {
    console.log(JSON.stringify({ failures, responses, consoleKinds }));
    throw error;
  }
  const context = browser.contexts().find((candidate) => !previous.has(candidate));
  if (!context) throw new Error('The remote bridge context was not created.');
  try {
    expect(await client.backend.auth.currentUser()).toBeUndefined();
    expect(context.pages()[0].url()).toBe(`${origin}/tests/providers/browser.html`);
    expect(await context.pages()[0].evaluate(() => location.origin)).toBe(origin);
    expect(apiRequests.length).toBeGreaterThan(0);
    expect(apiRequests.every((request) => request.origin === origin && request.path === '/api/auth/session')).toBe(true);
    expect(assetRequests).toContain('/tests/providers/browser-dispatch.ts');
    expect(assetRequests).toContain('/src/backend/cloudflare/backend.ts');
    expect(assetRequests.some((path) => path.startsWith('/node_modules/.vite/'))).toBe(true);
    expect(assetRequests).toContain('/node_modules/vite/dist/client/env.mjs');
    expect(preferenceCookieReceived).toBe(true);
    expect(await context.pages()[0].evaluate(() => document.cookie)).toBe('');
    expect((await context.cookies()).map((cookie) => ({ name: cookie.name, domain: cookie.domain, httpOnly: cookie.httpOnly })))
      .toEqual([{ name: 'bridge_preference', domain: 'provider-bridge.invalid', httpOnly: true }]);
    let connected = false;
    const sessionId = crypto.randomUUID();
    const stop = client.backend.updates.subscribe({ sessionId, userId: crypto.randomUUID(),
      onChange: () => {}, onConnection: (value) => { connected = value; } });
    try {
      await expect.poll(() => connected).toBe(true);
      expect(updateSockets).toEqual([`${origin.replace('https:', 'wss:')}/api/updates?sessionId=${sessionId}`]);
    } finally { stop(); }
    expect(failures).toEqual([]);
  } finally { await client.close(); }
});
