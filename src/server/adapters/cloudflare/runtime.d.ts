/** The small built-in surface used by the internal maintenance entrypoint. */
declare module 'cloudflare:workers' {
  export class WorkerEntrypoint<Environment = unknown> {
    protected env: Environment;
    constructor(context: unknown, environment: Environment);
  }
}
