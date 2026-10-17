/** Only the D1 adapter and its fixture code use this binding surface. */
export interface D1Statement {
  bind(...values: Array<string | number | null>): D1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface D1Connection {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown[]>;
}
