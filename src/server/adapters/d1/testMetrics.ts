import type { D1Connection, D1Statement } from './connection';

/** Test transport measurements. SQL, bound values, rows, and errors stay private. */
// Generic so a measured binding keeps exec() and the other members that the proxy forwards.
export function measureD1<Connection extends D1Connection>(db: Connection, report: (line: string) => void, source = 0) {
  const statements = new WeakMap<D1Statement, D1Statement>();
  const totals = { calls: 0, statements: 0, wallMs: 0, sqlMs: 0, inFlight: 0 };
  let lastReport = -Infinity;

  function flush() {
    report(`MINSKY_D1_METRICS ${JSON.stringify({ source, ...totals,
      wallMs: Math.round(totals.wallMs), sqlMs: Math.round(totals.sqlMs * 1000) / 1000 })}`);
    lastReport = performance.now();
  }

  function duration(result: unknown): number {
    if (typeof result !== 'object' || result === null || !('meta' in result)) return 0;
    const meta = result.meta;
    if (typeof meta !== 'object' || meta === null || !('duration' in meta)) return 0;
    return typeof meta.duration === 'number' && Number.isFinite(meta.duration) && meta.duration >= 0
      ? meta.duration : 0;
  }

  async function run<T>(count: number, operation: () => Promise<T>, metadata = true): Promise<T> {
    totals.calls++;
    totals.statements += count;
    totals.inFlight++;
    const start = performance.now();
    if (start - lastReport >= 1000) flush();
    try {
      const result = await operation();
      // first() returns a row without provider metadata. Do not inspect that row.
      if (metadata) totals.sqlMs += Array.isArray(result)
        ? result.reduce<number>((sum, item) => sum + duration(item), 0) : duration(result);
      return result;
    } finally {
      totals.wallMs += performance.now() - start;
      totals.inFlight--;
      if (performance.now() - lastReport >= 1000) flush();
    }
  }

  function wrap(statement: D1Statement): D1Statement {
    const methods: D1Statement = {
      bind: (...values) => wrap(statement.bind(...values)),
      first: <T>() => run(1, () => statement.first<T>(), false),
      all: <T>() => run(1, () => statement.all<T>()),
      run: () => run(1, () => statement.run()),
    };
    const measured = forward(statement, methods);
    statements.set(measured, statement);
    return measured;
  }

  function forward<T extends M, M extends object>(target: T, methods: M): T {
    return new Proxy(target, {
      get(original, key) {
        if (Object.hasOwn(methods, key)) return Reflect.get(methods, key);
        const value: unknown = Reflect.get(original, key, original);
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(original) : value;
      },
    });
  }

  return {
    db: forward(db, {
      prepare: (sql: string) => wrap(db.prepare(sql)),
      batch: (batch: D1Statement[]) => run(batch.length, () =>
        db.batch(batch.map((statement) => statements.get(statement) ?? statement))),
    }),
    flush,
  };
}
