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
