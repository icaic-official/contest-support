/** Only the D1 adapter and its fixture code use this binding surface. */
export interface D1Statement {
  bind(...values: Array<string | number | null>): D1Statement;
  first<T>(): Promise<T | null>;
  /** `meta.rows_read` is the number of rows D1 read, which D1 bills. */
  all<T>(): Promise<{ results: T[]; meta?: { rows_read?: number } }>;
  run(): Promise<unknown>;
}

export interface D1Connection {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown[]>;
}
