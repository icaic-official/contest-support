import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { getPlatformProxy, unstable_splitSqlQuery as splitSqlQuery } from 'wrangler';
import { readStoreTarget, storeTarget } from './store-target.mjs';

/** Only fixed database errors can enter a failed assertion or test report. */
function queryFailure(status, body) {
  const messages = [
    ...(Array.isArray(body?.errors) ? body.errors.map((error) => error?.message) : []),
    ...(Array.isArray(body?.result) ? body.result.map((result) => result?.error) : []),
  ].filter((message) => typeof message === 'string');
  // WorkflowPersistence distinguishes these proven rollbacks from an unknown
  // write outcome. Keep their complete fixed identifiers before broader errors.
  for (const expected of ['CHECK constraint failed: valid = 1',
    'UNIQUE constraint failed: command_receipts.actor, command_receipts.request_id',
    'CHECK constraint failed', 'FOREIGN KEY constraint failed',
    'UNIQUE constraint failed', 'NOT NULL constraint failed', 'Issue versions must advance with each write']) {
    if (messages.some((message) => message.includes(expected))) return new Error(`D1_ERROR: ${expected}`);
  }
  return new Error(`The D1 API request failed (HTTP ${status}). Inspect the fixture journal before retrying. Provider details were withheld.`);
}

/**
 * Test-only transport for the isolated store database. A batch stays one API
 * request. Never replay a request: a lost response can follow a committed write.
 */
export function createD1ApiConnection(settings, dependencies = {}) {
  if (settings.accountId !== storeTarget.accountId || settings.databaseId !== storeTarget.databaseId ||
      typeof settings.token !== 'string' || !settings.token || ![300, 1200].includes(settings.intervalMs)) {
    throw new Error('Select the exact store CI target, private credential, and reviewed API request interval.');
  }
  const request = dependencies.fetch ?? globalThis.fetch;
  const now = dependencies.now ?? (() => performance.now());
  const wait = dependencies.wait ?? delay;
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${settings.accountId}/d1/database/${settings.databaseId}/query`;
  const queries = new WeakMap();
  let nextStart = 0;
  let precedingStart = Promise.resolve();

  async function send(batch) {
    if (batch.length === 0) return [];
    // At most four files run together. 1200ms per file, or 300ms for the single
    // workflow file, stays below the shared 1200 requests / five minutes limit.
    const start = precedingStart.then(async () => {
      const remaining = nextStart - now();
      if (remaining > 0) await wait(remaining);
      nextStart = now() + settings.intervalMs;
    });
    precedingStart = start;
    await start;
    let response;
    let body;
    try {
      response = await request(endpoint, {
        method: 'POST', redirect: 'error', signal: globalThis.AbortSignal.timeout(30_000),
        headers: { authorization: `Bearer ${settings.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ batch }),
      });
      body = await response.json();
    } catch {
      throw new Error('The D1 API request outcome is unknown. Inspect the fixture journal before retrying. Provider details were withheld.');
    }
    if (!response.ok || body?.success !== true || !Array.isArray(body.result) || body.result.length !== batch.length ||
        body.result.some((result) => result?.success !== true || !Array.isArray(result.results) ||
          !result.meta || typeof result.meta !== 'object')) {
      throw queryFailure(response.status, body);
    }
    return body.result;
  }

  function prepare(sql, params = []) {
    const statement = {
      bind(...values) {
        if (values.some((value) => value !== null && typeof value !== 'string' &&
            (typeof value !== 'number' || !Number.isFinite(value)))) {
          throw new Error('D1 parameters must be strings, finite numbers, or null.');
        }
        return prepare(sql, values);
      },
      async first() { return (await send([{ sql, params }]))[0].results[0] ?? null; },
      async all() { return (await send([{ sql, params }]))[0]; },
      async run() { return { ...(await send([{ sql, params }]))[0], results: [] }; },
    };
    queries.set(statement, { sql, params });
    return statement;
  }

  return {
    prepare,
    async batch(statements) {
      const batch = statements.map((statement) => {
        const query = queries.get(statement);
        if (!query) throw new Error('A D1 API batch requires statements from this connection.');
        return query;
      });
      return send(batch);
    },
    async exec(sql) {
      const batch = splitSqlQuery(sql).map((statement) => ({ sql: statement, params: [] }));
      const results = await send(batch);
      return { count: results.length, duration: results.reduce((sum, result) => sum + result.meta.duration, 0) };
    },
  };
}

/** A value that D1 binds as it is. Any other value goes to the native statement, which rejects or converts it. */
const bindable = (value) => value === null || typeof value === 'string' || typeof value === 'number';

/**
 * A statement that stays in the test process. A native statement blocks the test
 * process while the Wrangler proxy answers. The `prepare`, `bind`, and `all` of one
 * bound query block it five times. This statement does not block it once the runtime
 * is warm. It sends one batch call when it runs. `all` and `run` return the same
 * `results` and `meta` as the native ones, apart from the timing fields, and `first`
 * returns the first row of `results`. Three things differ from a native statement.
 * `first` takes no column name and throws when it gets one. There is no `raw`.
 * Reading `statement` or `params` gives `undefined`.
 */
class LocalStatement {
  #native;
  #sql;
  #params;

  constructor(native, sql, params = []) {
    this.#native = native;
    this.#sql = sql;
    this.#params = params;
  }

  bind(...values) {
    return values.every(bindable)
      ? new LocalStatement(this.#native, this.#sql, values)
      : this.#native.prepare(this.#sql).bind(...values);
  }

  /** The plain object that the D1 binding reads from a statement in `batch`. */
  get query() {
    return { statement: this.#sql, params: this.#params };
  }

  async all() {
    return (await this.#native.batch([this.query]))[0];
  }

  async run() {
    return this.all();
  }

  async first(column) {
    if (column !== undefined) {
      throw new Error('LocalStatement: first takes no column name. Read the column from the row that first returns.');
    }
    return (await this.all()).results[0] ?? null;
  }
}

/** The D1 binding of a local platform, with its statements kept in the test process. Exported for its test. */
export function localD1(native) {
  return {
    prepare: (sql) => new LocalStatement(native, sql),
    batch: (statements) => native.batch(statements.map((statement) => statement instanceof LocalStatement ? statement.query : statement)),
    exec: (sql) => native.exec(sql),
  };
}

/**
 * Local emulation of a Worker's bindings. `persist: false` keeps the state out of the
 * project, but Miniflare still writes its SQLite files to a `miniflare-*` directory under
 * the temp directory, and `dispose` removes it. The D1 binding batches statements as
 * `LocalStatement` does. Other bindings are the proxy's own.
 */
export async function openLocalPlatform(configPath) {
  const platform = await getPlatformProxy({ configPath, remoteBindings: false, persist: false, envFiles: [] });
  return { env: { ...platform.env, DB: localD1(platform.env.DB) }, dispose: platform.dispose };
}

/** Select only the requested hosted transport. Local checks open a local platform. */
export async function openStoreDatabase({ configPath, remoteBindings }, environment = process.env) {
  const transport = environment.MINSKY_CONNECTOR_D1_TRANSPORT ?? 'binding';
  if (!['binding', 'api'].includes(transport)) throw new Error('Select the binding or api store transport.');
  if (transport === 'binding') {
    const platform = remoteBindings
      ? await getPlatformProxy({ configPath, remoteBindings, persist: false, envFiles: [] })
      : await openLocalPlatform(configPath);
    return { db: platform.env.DB, dispose: platform.dispose };
  }
  if (!remoteBindings || configPath !== environment.MINSKY_CONNECTOR_D1_CONFIG) {
    throw new Error('The API transport requires the guarded hosted store runner.');
  }
  const settings = await readStoreTarget({ config: configPath,
    account: environment.CLOUDFLARE_ACCOUNT_ID, database: environment.MINSKY_CONNECTOR_D1_DATABASE_ID });
  const db = createD1ApiConnection({ ...settings, token: environment.MINSKY_CONNECTOR_D1_API_TOKEN,
    intervalMs: Number(environment.MINSKY_CONNECTOR_D1_API_INTERVAL_MS) });
  return { db, dispose: async () => {} };
}
