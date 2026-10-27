#!/usr/bin/env node
/**
 * Verification scaffolding for the Minsky web app.
 * Starts one local Cloudflare Worker, a fresh D1 database, and one Chromium window.
 * This file is not part of the contest application.
 */
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { register } from 'node:module';
import { connect, createServer, type Server, type Socket } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, type Browser, type Locator, type Page } from '@playwright/test';
import { snapshotSchema, type Snapshot } from '../../../../src/connected/model.ts';
import type { D1Connection } from '../../../../src/server/adapters/d1/connection.ts';

const APP_PORT = 5199;
const CONTROL_PORT = 5198;
const CDP_PORT = 9223;
const INSPECTOR_PORT = 9239;
const ACTION_TIMEOUT_MS = 90_000;
// Longer than one action, so the client receives the action's own error.
const REPLY_TIMEOUT_MS = ACTION_TIMEOUT_MS + 30_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;
const SESSION_DIR = '.verify-minsky';
const EVIDENCE_DIR = path.join(SESSION_DIR, 'evidence');
const STATE_DIR = path.join(SESSION_DIR, 'state');
const DATABASE_NAME = 'minsky-verify-local-only';
const BUCKET_NAME = 'minsky-verify-local-only';
const EVENT_NAME = 'Jury verification';
const SESSION_NAME = 'Primary';
const PASSWORD = 'verification-only';
const LOOPBACK_IP = '198.51.100.17';
const DEVELOPMENT_SETTINGS = 'src/server/adapters/cloudflare/deploy/development.settings.json';

type Seed = 'empty' | 'jury';
type Role = Parameters<Page['getByRole']>[0];
type StaffRole = 'volunteer' | 'specialist' | 'jury';

interface SessionFile {
  sessionPid: number;
  wranglerPid: number;
  workerPid: number;
  browserPid: number;
  port: number;
  controlPort: number;
  cdpPort: number;
  origin: string;
  seed: Seed;
  viewport: { width: number; height: number };
  ready: boolean;
  sessionId: string;
  eventName: string;
  sessionName: string;
}

interface Command {
  op: string;
  role?: string | undefined;
  name?: string | undefined;
  exact?: boolean | undefined;
  label?: string | undefined;
  value?: string | undefined;
  text?: string | undefined;
  option?: string | undefined;
  withinRole?: string | undefined;
  withinName?: string | undefined;
  withinExact?: boolean | undefined;
  out?: string | undefined;
  user?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

interface Result {
  ok: boolean;
  error?: string | undefined;
  shuttingDown?: boolean;
  text?: string;
  path?: string;
  [key: string]: unknown;
}

interface Installation {
  sessionId: string;
  teamIds: string[];
  adminUsername: string;
  temporaryPassword: string;
}

interface LocalResponse {
  status: number;
  cookies: string[];
  text: string;
}

class LocalApi {
  private readonly jars = new Map<string, Map<string, string>>();
  private readonly origin: string;
  private readonly sessionId: string;

  constructor(origin: string, sessionId: string) {
    this.origin = origin;
    this.sessionId = sessionId;
  }

  async adopt(username: string, temporaryPassword: string): Promise<void> {
    await this.signIn(username, temporaryPassword);
    await this.post(username, '/api/auth/change-password', {
      currentPassword: temporaryPassword,
      newPassword: PASSWORD,
    });
    const status = await this.session(username);
    if (status.must_change) throw new Error(`Account ${username} still requires a password change.`);
  }

  async snapshot(username: string): Promise<Snapshot> {
    const body = await this.send(username, 'GET', `/api/snapshot?sessionId=${this.sessionId}`);
    return snapshotSchema.parse(body);
  }

  async post(username: string, apiPath: string, body: unknown): Promise<Record<string, unknown>> {
    const result = await this.send(username, 'POST', apiPath, body, true);
    return result && typeof result === 'object' ? result as Record<string, unknown> : {};
  }

  private async signIn(username: string, password: string): Promise<void> {
    const jar = new Map<string, string>();
    const body = await this.request('POST', '/api/auth/sign-in', jar, { username, password });
    if (body.status !== 200) throw new Error(failure('/api/auth/sign-in', body));
    this.jars.set(username, jar);
  }

  private async session(username: string): Promise<{ csrf: string; must_change: boolean }> {
    const body = await this.send(username, 'GET', '/api/auth/session');
    if (!body || typeof body !== 'object') throw new Error('The local session response was empty.');
    const record = body as { csrf?: unknown; status?: { must_change?: unknown } };
    if (typeof record.csrf !== 'string' || typeof record.status?.must_change !== 'boolean') {
      throw new Error('The local session response did not include a request token.');
    }
    return { csrf: record.csrf, must_change: record.status.must_change };
  }

  private async send(username: string, method: 'GET' | 'POST', apiPath: string, payload?: unknown, csrf = false): Promise<unknown> {
    const jar = this.jars.get(username);
    if (!jar) throw new Error(`Unknown account ${username}.`);
    const token = csrf ? (await this.session(username)).csrf : undefined;
    const response = await this.request(method, apiPath, jar, payload, token);
    if (response.status !== 200) throw new Error(failure(apiPath, response));
    if (!response.text) return {};
    return JSON.parse(response.text) as unknown;
  }

  private request(method: string, apiPath: string, jar: Map<string, string>, payload?: unknown, csrf?: string): Promise<LocalResponse> {
    const headers: Record<string, string> = { Origin: this.origin, 'CF-Connecting-IP': LOOPBACK_IP };
    const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    if (cookie) headers.Cookie = cookie;
    let body: string | undefined;
    if (payload !== undefined) {
      body = JSON.stringify(payload);
      headers['Content-Type'] = 'application/json';
      headers['X-Minsky-Request'] = '1';
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }
    const target = new URL(apiPath, this.origin);
    return new Promise((resolve, reject) => {
      const req = httpsRequest({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method,
        headers,
        rejectUnauthorized: false,
        servername: target.hostname,
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const cookies: string[] = [];
          const raw = res.rawHeaders;
          for (let index = 0; index < raw.length; index += 2) {
            if (raw[index]?.toLowerCase() === 'set-cookie') cookies.push(raw[index + 1] ?? '');
          }
          storeCookies(jar, cookies);
          resolve({ status: res.statusCode ?? 0, cookies, text: Buffer.concat(chunks).toString('utf8') });
        });
      });
      req.setTimeout(120_000, () => req.destroy(new Error(`${apiPath} did not answer within 120 seconds.`)));
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }
}

function failure(apiPath: string, response: LocalResponse): string {
  let message = '';
  try {
    const body = JSON.parse(response.text) as { error?: unknown; reason?: unknown };
    if (typeof body.error === 'string') message = body.error;
    else if (typeof body.reason === 'string') message = body.reason;
  } catch {
    message = '';
  }
  return `${apiPath} returned ${response.status}.${message ? ` ${message}` : ''}`;
}

function storeCookies(jar: Map<string, string>, lines: string[]): void {
  for (const line of lines) {
    const [pair, ...attrs] = line.split(';').map((part) => part.trim());
    const eq = pair?.indexOf('=') ?? -1;
    if (!pair || eq <= 0) continue;
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    const expired = attrs.some((attr) => /^max-age=0$/i.test(attr));
    if (expired || value === '') jar.delete(name);
    else jar.set(name, value);
  }
}

function repositoryRoot(): string {
  const root = process.cwd();
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { name?: string };
  if (manifest.name !== 'minsky') throw new Error('Run minsky-verify from the Minsky repository root.');
  return root;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errno(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

function exitStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined;
  const status = (error as { status: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

function alive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (error) {
    return errno(error) === 'EPERM';
  }
  return !zombie(pid);
}

/** An exited child that its new parent has not reaped yet. */
function zombie(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z');
  } catch {
    return false;
  }
}

function cmdline(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ').trim();
  } catch {
    return '';
  }
}

function parentPid(pid: number): number {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    const line = status.split('\n').find((item) => item.startsWith('PPid:'));
    return Number(line?.split(/\s+/)[1] ?? 0);
  } catch {
    return 0;
  }
}

function ancestor(pid: number, expected: number): boolean {
  let current = pid;
  for (let depth = 0; depth < 6; depth += 1) {
    if (current === expected) return true;
    const parent = parentPid(current);
    if (parent <= 1 || parent === current) return false;
    current = parent;
  }
  return false;
}

function listenPids(port: number): number[] {
  try {
    const output = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
    return [...new Set(output.split('\n').map((line) => Number(line.trim())).filter((pid) => pid > 0))];
  } catch (error) {
    if (exitStatus(error) === 1) return [];
    throw error;
  }
}

function sessionPath(root: string): string {
  return path.join(root, SESSION_DIR, 'session.json');
}

function stateDir(root: string): string {
  return path.join(root, STATE_DIR);
}

function readSession(root: string): SessionFile | undefined {
  try {
    return JSON.parse(readFileSync(sessionPath(root), 'utf8')) as SessionFile;
  } catch (error) {
    if (errno(error) === 'ENOENT') return undefined;
    throw error;
  }
}

function writeSession(root: string, session: SessionFile): void {
  const file = sessionPath(root);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(session, null, 2)}\n`);
}

function evidenceFile(root: string, out: string): string {
  const resolved = path.resolve(root, out);
  const allowed = [path.join(root, EVIDENCE_DIR), '/opt/cursor/artifacts'];
  const permitted = allowed.some((dir) => resolved === dir || resolved.startsWith(dir + path.sep));
  if (!permitted) {
    throw new Error(`Refusing to write outside the evidence directories: ${out}`);
  }
  mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

function flags(argv: string[]): Record<string, string | true> {
  const values: Record<string, string | true> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument ${arg}`);
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) values[key] = true;
    else {
      values[key] = next;
      index += 1;
    }
  }
  return values;
}

function flag(values: Record<string, string | true>, key: string): string | undefined {
  const value = values[key];
  return typeof value === 'string' ? value : undefined;
}

function enabled(values: Record<string, string | true>, key: string): boolean {
  return values[key] === true || values[key] === 'true';
}

function required(values: Record<string, string | true>, key: string): string {
  const value = flag(values, key);
  if (value === undefined) throw new Error(`Missing --${key}.`);
  return value;
}

function asRole(role: string): Role {
  return role as Role;
}

function scopeOf(page: Page, command: Command): Page | Locator {
  if (!command.withinRole) return page;
  return page.getByRole(asRole(command.withinRole), {
    ...(command.withinName === undefined ? {} : { name: command.withinName }),
    exact: command.withinExact ?? false,
  });
}

function commandFrom(values: Record<string, string | true>, op: string): Command {
  return {
    op,
    role: flag(values, 'role'),
    name: flag(values, 'name'),
    exact: enabled(values, 'exact'),
    label: flag(values, 'label'),
    value: flag(values, 'value'),
    text: flag(values, 'text'),
    option: flag(values, 'option'),
    withinRole: flag(values, 'within-role'),
    withinName: flag(values, 'within-name'),
    withinExact: enabled(values, 'within-exact'),
    out: flag(values, 'out'),
    user: flag(values, 'user'),
    width: flag(values, 'width') === undefined ? undefined : Number(flag(values, 'width')),
    height: flag(values, 'height') === undefined ? undefined : Number(flag(values, 'height')),
  };
}

function printUsage(): void {
  console.error(`Usage:
  node .cursor/skills/verify-minsky/scripts/minsky-verify.ts serve --seed empty|jury [--viewport 1280x800]
  node .cursor/skills/verify-minsky/scripts/minsky-verify.ts doctor
  node .cursor/skills/verify-minsky/scripts/minsky-verify.ts click --role <role> --name <name> [--exact]
  node .cursor/skills/verify-minsky/scripts/minsky-verify.ts click-text --text <text> [--exact]
  node .cursor/skills/verify-minsky/scripts/minsky-verify.ts fill --label <label> --value <value> [--exact]
  node .cursor/skills/verify-minsky/scripts/minsky-verify.ts select --label <label> --option <option> [--exact]
  node .cursor/skills/verify-minsky/scripts/minsky-verify.ts wait --role <role> --name <name> [--exact]
  node .cursor/skills/verify-minsky/scripts/minsky-verify.ts absent --role <role> --name <name> [--exact]
  node .cursor/skills/verify-minsky/scripts/minsky-verify.ts wait-text --text <text>
  node .cursor/skills/verify-minsky/scripts/minsky-verify.ts text --role <role> --name <name> [--exact]
  node .cursor/skills/verify-minsky/scripts/minsky-verify.ts screenshot --out <path>
  node .cursor/skills/verify-minsky/scripts/minsky-verify.ts aria --out <path>
  node .cursor/skills/verify-minsky/scripts/minsky-verify.ts snapshot --user <account> --out <path>
  node .cursor/skills/verify-minsky/scripts/minsky-verify.ts viewport --width <px> --height <px>
  node .cursor/skills/verify-minsky/scripts/minsky-verify.ts cleanup`);
}

async function request(root: string, command: Command, timeoutMs = REPLY_TIMEOUT_MS): Promise<Result> {
  const session = readSession(root);
  const port = session?.controlPort ?? CONTROL_PORT;
  return new Promise((resolve, reject) => {
    const socket = createClient(port, timeoutMs, resolve, reject);
    socket.write(`${JSON.stringify(command)}\n`);
  });
}

function createClient(
  port: number,
  timeoutMs: number,
  resolve: (result: Result) => void,
  reject: (error: Error) => void,
): Socket {
  const socket = connect(port, '127.0.0.1');
  let buffer = '';
  const timer = setTimeout(() => {
    socket.destroy();
    reject(new Error(`The verification session did not answer within ${timeoutMs / 1000} seconds.`));
  }, timeoutMs);
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const end = buffer.indexOf('\n');
    if (end === -1) return;
    clearTimeout(timer);
    resolve(JSON.parse(buffer.slice(0, end)) as Result);
  });
  socket.on('error', (error) => {
    clearTimeout(timer);
    if (errno(error) === 'ECONNREFUSED') {
      reject(new Error(`No verification session is listening on 127.0.0.1:${port}. Start serve, then retry.`));
      return;
    }
    reject(error instanceof Error ? error : new Error(String(error)));
  });
  return socket;
}

async function waitForHttp(url: string): Promise<void> {
  const deadline = Date.now() + 180_000;
  let last = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await localGet(url);
      if (response.status === 200 && response.text.includes('id="root"')) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await delay(250);
  }
  throw new Error(`The local Worker did not serve the app shell: ${last}`);
}

function localGet(url: string): Promise<LocalResponse> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: 'GET',
      rejectUnauthorized: false,
      servername: target.hostname,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        cookies: [],
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.setTimeout(5_000, () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end();
  });
}

async function waitForPid(port: number): Promise<number> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const pids = listenPids(port);
    if (pids.length === 1) return pids[0]!;
    await delay(100);
  }
  throw new Error(`Could not find one listener on port ${port}.`);
}

function refuseIfBusy(port: number, label: string): void {
  const pids = listenPids(port);
  if (pids.length === 0) return;
  throw new Error(`Refusing to start. ${label} port ${port} is already in use by pid ${pids.join(', ')}. This skill does not take over a shared server.`);
}

function signalIfRecorded(pid: number, matches: (line: string) => boolean): void {
  if (!alive(pid)) return;
  const line = cmdline(pid);
  // An empty command line means the process exited after the alive check.
  if (line === '') return;
  if (!matches(line)) {
    throw new Error(`Refusing to signal pid ${pid}. Its command line is not the recorded verification process.`);
  }
  signalGroup(pid, 'SIGTERM');
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
    return;
  } catch {
    // The pid does not lead a process group, for example when serve started
    // from a shell without job control. Signal the pid alone.
  }
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (errno(error) !== 'ESRCH') throw error;
  }
}

async function waitDead(pid: number): Promise<boolean> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (!alive(pid)) return true;
    await delay(100);
  }
  return !alive(pid);
}

async function stopRecorded(pid: number, matches: (line: string) => boolean): Promise<void> {
  if (!alive(pid)) return;
  signalIfRecorded(pid, matches);
  if (await waitDead(pid)) return;
  if (alive(pid) && matches(cmdline(pid))) signalGroup(pid, 'SIGKILL');
  if (!(await waitDead(pid))) throw new Error(`Pid ${pid} is still running after SIGKILL.`);
}

function wranglerMatches(configPath: string): (line: string) => boolean {
  return (line) => line.includes('wrangler.js') && line.includes(configPath);
}

function workerMatches(line: string): boolean {
  return line.includes('workerd') || line.includes('wrangler.js');
}

function browserMatches(cdpPort: number): (line: string) => boolean {
  return (line) => line.includes(`remote-debugging-port=${cdpPort}`);
}

function sessionMatches(line: string): boolean {
  return line.includes('minsky-verify.ts') && line.includes('serve');
}

function removeState(root: string): void {
  rmSync(stateDir(root), { recursive: true, force: true });
}

async function cleanup(root: string): Promise<void> {
  const session = readSession(root);
  if (!session) {
    const busy = [APP_PORT, CONTROL_PORT, CDP_PORT].flatMap((port) => listenPids(port).map((pid) => `${port}:${pid}`));
    if (busy.length > 0) {
      throw new Error(`No session file is present. Ports are in use (${busy.join(', ')}). This cleanup does not kill unrecorded processes.`);
    }
    removeState(root);
    console.log(JSON.stringify({ ok: true, stopped: false }));
    return;
  }
  try {
    await request(root, { op: 'shutdown' }, SHUTDOWN_TIMEOUT_MS);
  } catch {
    // A stopped, busy, or hung session cannot answer. The recorded pids are
    // still signalled below.
  }
  if (alive(session.sessionPid)) {
    signalIfRecorded(session.sessionPid, sessionMatches);
    await waitDead(session.sessionPid);
  }
  await stopRecorded(session.browserPid, browserMatches(session.cdpPort));
  const configPath = path.join(stateDir(root), 'wrangler.json');
  if (session.wranglerPid > 0) await stopRecorded(session.wranglerPid, wranglerMatches(configPath));
  if (session.workerPid > 0 && session.workerPid !== session.wranglerPid) {
    await stopRecorded(session.workerPid, workerMatches);
  }
  if (alive(session.sessionPid)) await stopRecorded(session.sessionPid, sessionMatches);
  rmSync(sessionPath(root), { force: true });
  removeState(root);
  console.log(JSON.stringify({ ok: true, stopped: true }));
}

function doctorLocal(root: string, session: SessionFile): string | undefined {
  if (!alive(session.sessionPid) || !sessionMatches(cmdline(session.sessionPid))) {
    return 'The recorded session process is not the running serve command.';
  }
  const configPath = path.join(stateDir(root), 'wrangler.json');
  if (!alive(session.wranglerPid) || !wranglerMatches(configPath)(cmdline(session.wranglerPid))) {
    return 'The recorded Wrangler process is not the local verification Worker.';
  }
  if (!alive(session.workerPid) || !workerMatches(cmdline(session.workerPid)) || !ancestor(session.workerPid, session.wranglerPid)) {
    return 'The recorded listener is not the local verification Worker.';
  }
  if (!alive(session.browserPid) || !browserMatches(session.cdpPort)(cmdline(session.browserPid))) {
    return 'The recorded Chromium process is not the session browser.';
  }
  const owners = [
    [session.port, session.workerPid, 'app'],
    [session.controlPort, session.sessionPid, 'control'],
    [session.cdpPort, session.browserPid, 'browser'],
  ] as const;
  for (const [port, pid, label] of owners) {
    const listeners = listenPids(port);
    if (listeners.length !== 1 || listeners[0] !== pid) {
      return `${label} port ${port} is owned by ${listeners.join(', ') || 'nobody'}, not recorded pid ${pid}.`;
    }
  }
  if (!session.ready) return 'The session file says the app is not ready.';
  return undefined;
}

function isolatedEnv(directory: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key.startsWith('CLOUDFLARE_') || key.startsWith('CF_') || key.startsWith('VITE_')) continue;
    env[key] = value;
  }
  env.CI = 'true';
  env.WRANGLER_SEND_METRICS = 'false';
  env.WRANGLER_LOG_SANITIZE = 'true';
  env.WRANGLER_LOG_PATH = path.join(directory, 'wrangler.log');
  env.HOME = directory;
  env.XDG_CONFIG_HOME = path.join(directory, 'config');
  env.XDG_CACHE_HOME = path.join(directory, 'cache');
  env.XDG_DATA_HOME = path.join(directory, 'data');
  env.MINSKY_VERIFY_ENV_DIR = directory;
  env.NODE_ENV = 'production';
  return env;
}

function runNode(root: string, args: string[], env: NodeJS.ProcessEnv, secret: string): void {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180_000,
  });
  if (result.error || result.status !== 0) {
    const detail = redact(`${result.stdout ?? ''}\n${result.stderr ?? ''}`, secret).slice(-2000);
    throw new Error(`Command failed (${result.status ?? result.error?.message ?? 'unknown'}). ${detail}`);
  }
}

function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join('[redacted]') : text;
}

function localSecret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) => value.toString(16).padStart(2, '0')).join('');
}

function writeWorkerConfig(root: string, directory: string, origin: string, secret: string): string {
  const databaseId = crypto.randomUUID();
  const config = {
    name: DATABASE_NAME,
    main: path.join(root, 'src/server/adapters/cloudflare/applicationWorker.ts'),
    compatibility_date: '2026-10-13',
    compatibility_flags: ['nodejs_compat'],
    workers_dev: false,
    preview_urls: false,
    vars: { AUTH_ORIGIN: origin, AUTH_SECRET: secret },
    assets: {
      directory: path.join(directory, 'assets'),
      binding: 'ASSETS',
      not_found_handling: 'single-page-application',
      run_worker_first: true,
    },
    d1_databases: [{
      binding: 'DB',
      database_name: DATABASE_NAME,
      database_id: databaseId,
      migrations_dir: path.join(root, 'src/server/adapters/d1/migrations'),
    }],
    r2_buckets: [{ binding: 'IMAGES', bucket_name: BUCKET_NAME }],
    durable_objects: { bindings: [{ name: 'LIVE_UPDATES', class_name: 'SessionLiveCoordinator' }] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['SessionLiveCoordinator'] }],
  };
  const encoded = JSON.stringify(config);
  const development = JSON.parse(readFileSync(path.join(root, DEVELOPMENT_SETTINGS), 'utf8')) as Record<string, unknown>;
  const remoteNames = [development.databaseName, development.databaseId, development.bucketName]
    .filter((value): value is string => typeof value === 'string' && value !== '');
  if (remoteNames.some((name) => encoded.includes(name)) || encoded.includes('"remote":true')) {
    throw new Error('Refusing to write a Worker config that names a remote resource.');
  }
  const file = path.join(directory, 'wrangler.json');
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  writeFileSync(path.join(directory, 'wrangler.env'), '', { mode: 0o600 });
  return file;
}

function installationFile(root: string): string {
  return path.join(stateDir(root), 'installation.json');
}

/**
 * Runs the bootstrap in a child process with the isolated environment, so the
 * platform proxy cannot read Cloudflare credentials or the user's Wrangler login.
 */
function bootstrapIsolated(root: string, env: NodeJS.ProcessEnv, secret: string): Installation {
  runNode(root, [fileURLToPath(import.meta.url), 'bootstrap'], env, secret);
  const file = installationFile(root);
  const installation = JSON.parse(readFileSync(file, 'utf8')) as Installation;
  rmSync(file, { force: true });
  return installation;
}

async function bootstrapLocal(root: string): Promise<void> {
  register(pathToFileURL(path.join(root, '.cursor/skills/verify-minsky/scripts/resolve-typescript.mjs')));
  const { getPlatformProxy } = await import('wrangler');
  const { bootstrapInstallation } = await import('../../../../src/server/adapters/cloudflare/installation.ts');
  const proxy = await getPlatformProxy<{ DB: D1Connection }>({
    configPath: path.join(stateDir(root), 'wrangler.json'),
    persist: { path: path.join(stateDir(root), 'persist', 'v3') },
    remoteBindings: false,
    envFiles: [],
  });
  try {
    const installation = await bootstrapInstallation(proxy.env.DB, {
      adminUsername: 'admin',
      adminName: 'Test admin',
      eventName: EVENT_NAME,
      sessionName: SESSION_NAME,
      categories: ['Problem statement', 'Devices', 'Backend', 'Other'],
      teams: [
        { name: 'Aurora', location: 'A12' },
        { name: 'Cedar', location: 'A18' },
      ],
    });
    writeFileSync(installationFile(root), JSON.stringify(installation), { mode: 0o600 });
  } finally {
    await proxy.dispose();
  }
}

async function seedAccounts(api: LocalApi, installation: Installation, seed: Seed): Promise<void> {
  await api.adopt(installation.adminUsername, installation.temporaryPassword);
  await api.post('admin', '/api/admin', { action: 'set_intake', sessionId: installation.sessionId, open: true });
  const aurora = installation.teamIds[0];
  if (!aurora) throw new Error('Bootstrap did not create the Aurora team.');
  const accounts: Array<{ username: string; name: string; teamId: string | null; roles: StaffRole[] }> = [
    { username: 'contestant', name: 'Test contestant', teamId: aurora, roles: [] },
    { username: 'volunteer', name: 'Test volunteer', teamId: null, roles: ['volunteer'] },
    { username: 'specialist', name: 'Test specialist', teamId: null, roles: ['specialist'] },
    { username: 'jury', name: 'Test jury', teamId: null, roles: ['jury'] },
    { username: 'combined', name: 'Test combined', teamId: null, roles: ['volunteer', 'specialist', 'jury'] },
  ];
  for (const account of accounts) {
    const created = await api.post('admin', '/api/accounts', {
      sessionId: installation.sessionId,
      command: {
        action: 'create_account',
        username: account.username,
        name: account.name,
        teamId: account.teamId,
        roles: account.roles,
        isAdmin: false,
      },
    });
    if (typeof created.temporaryPassword !== 'string') throw new Error(`Account ${account.username} did not return a temporary password.`);
    await api.adopt(account.username, created.temporaryPassword);
  }
  if (seed === 'jury') await seedJuryIssues(api, installation.sessionId);
}

async function seedJuryIssues(api: LocalApi, sessionId: string): Promise<void> {
  for (let number = 1; number <= 6; number += 1) {
    const description = `Issue ${number} verification`;
    const issueId = await workflow(api, sessionId, 'contestant', {
      type: 'submit', category: 'Backend', description,
    });
    await workflow(api, sessionId, 'volunteer', {
      type: 'claim', issue_id: issueId, revision: await revisionOf(api, issueId),
    });
    await workflow(api, sessionId, 'volunteer', {
      type: 'resolve', issue_id: issueId, revision: await revisionOf(api, issueId),
      summary: `Resolution ${number}: service restored`,
    });
    if (number >= 3 && number <= 5) {
      await workflow(api, sessionId, 'jury', {
        type: 'award', issue_id: issueId, revision: await revisionOf(api, issueId),
        minutes: number === 3 ? 0 : 5, explanation: `Decision ${number} explanation`,
      });
    }
    if (number === 5) {
      await workflow(api, sessionId, 'jury', {
        type: 'apply', issue_id: issueId, revision: await revisionOf(api, issueId),
      });
    }
    if (number === 4 || number === 6) {
      await workflow(api, sessionId, 'volunteer', {
        type: 'reopen', issue_id: issueId, revision: await revisionOf(api, issueId), reason: 'Still failing',
      });
    }
  }
}

async function revisionOf(api: LocalApi, issueId: string): Promise<number> {
  const snap = await api.snapshot('volunteer');
  const issue = snap.issues.find((item) => item.id === issueId);
  if (!issue) throw new Error('The seeded issue is not visible to the volunteer.');
  return issue.revision;
}

async function workflow(api: LocalApi, sessionId: string, username: string, command: Record<string, unknown>): Promise<string> {
  const result = await api.post(username, '/api/workflow', { sessionId, requestId: crypto.randomUUID(), command });
  if (result.outcome !== 'committed' || typeof result.issueId !== 'string') {
    throw new Error(`Workflow ${String(command.type)} was ${String(result.outcome ?? 'unanswered')} (${String(result.reason ?? 'no reason')}).`);
  }
  return result.issueId;
}

async function serve(root: string, seed: Seed, viewport: { width: number; height: number }): Promise<void> {
  const existing = readSession(root);
  if (existing && (alive(existing.sessionPid) || alive(existing.wranglerPid) || alive(existing.workerPid) || alive(existing.browserPid))) {
    throw new Error('Refusing to start. A verification session already owns this slot. Run cleanup on that session before you start another. Do not drive a second browser against it.');
  }
  if (existing) rmSync(sessionPath(root), { force: true });
  refuseIfBusy(APP_PORT, 'App');
  refuseIfBusy(CONTROL_PORT, 'Control');
  refuseIfBusy(CDP_PORT, 'Browser');
  refuseIfBusy(INSPECTOR_PORT, 'Inspector');

  const directory = stateDir(root);
  removeState(root);
  mkdirSync(directory, { recursive: true });
  mkdirSync(path.join(root, EVIDENCE_DIR), { recursive: true });
  const log = path.join(root, SESSION_DIR, 'worker.log');
  writeFileSync(log, '');
  const logFd = openSync(log, 'a');
  const origin = `https://127.0.0.1:${APP_PORT}`;
  const secret = localSecret();
  const env = isolatedEnv(directory);
  const wranglerBin = path.join(root, 'node_modules/wrangler/bin/wrangler.js');
  const configPath = writeWorkerConfig(root, directory, origin, secret);
  const persistDir = path.join(directory, 'persist');
  mkdirSync(persistDir, { recursive: true });

  let wrangler: ChildProcess | undefined;
  let browser: Browser | undefined;
  let api: LocalApi | undefined;
  let control: Server | undefined;
  let page: Page | undefined;
  let browserPid = 0;
  let workerPid = 0;
  let shuttingDown = false;
  const session = (): SessionFile => ({
    sessionPid: process.pid,
    wranglerPid: wrangler?.pid ?? 0,
    workerPid,
    browserPid,
    port: APP_PORT,
    controlPort: CONTROL_PORT,
    cdpPort: CDP_PORT,
    origin,
    seed,
    viewport,
    ready: false,
    sessionId: '',
    eventName: EVENT_NAME,
    sessionName: SESSION_NAME,
  });

  const stop = async (code: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    control?.close();
    await browser?.close().catch(() => undefined);
    const wranglerPid = wrangler?.pid ?? 0;
    if (wranglerPid > 0 && alive(wranglerPid)) {
      signalIfRecorded(wranglerPid, wranglerMatches(configPath));
      if (!(await waitDead(wranglerPid))) {
        try { process.kill(-wranglerPid, 'SIGKILL'); } catch { wrangler?.kill('SIGKILL'); }
      }
    }
    rmSync(sessionPath(root), { force: true });
    removeState(root);
    process.exit(code);
  };

  process.on('SIGTERM', () => void stop(0));
  process.on('SIGINT', () => void stop(0));

  try {
    console.error('Building the Cloudflare frontend.');
    runNode(root, [
      path.join(root, 'node_modules/vite/bin/vite.js'), 'build',
      '--outDir', path.join(directory, 'assets'), '--emptyOutDir',
    ], env, secret);
    console.error('Applying local D1 migrations.');
    runNode(root, [
      wranglerBin, 'd1', 'migrations', 'apply', DATABASE_NAME, '--local',
      '--config', configPath, '--persist-to', persistDir,
      '--env-file', path.join(directory, 'wrangler.env'),
      '--cwd', directory,
    ], env, secret);
    console.error('Bootstrapping the local installation.');
    const installation = bootstrapIsolated(root, env, secret);
    const current = session();
    current.sessionId = installation.sessionId;
    writeSession(root, current);
    console.error('Starting the local Worker.');
    wrangler = spawn(process.execPath, [
      wranglerBin, 'dev', '--local', '--ip', '127.0.0.1', '--port', String(APP_PORT),
      '--inspector-port', String(INSPECTOR_PORT), '--local-protocol', 'https',
      '--config', configPath, '--persist-to', persistDir,
      '--env-file', path.join(directory, 'wrangler.env'),
      '--cwd', directory, '--log-level', 'error', '--show-interactive-dev-session', 'false',
      '--no-experimental-provision',
    ], { cwd: root, env, detached: true, stdio: ['ignore', logFd, logFd] });
    if (!wrangler.pid) throw new Error('Wrangler did not start.');
    writeSession(root, { ...session(), sessionId: installation.sessionId });
    wrangler.on('exit', (code) => {
      if (!shuttingDown) {
        console.error(`Wrangler exited (${code ?? 'signal'}).`);
        void stop(1);
      }
    });
    await waitForHttp(origin);
    workerPid = await waitForPid(APP_PORT);
    writeSession(root, { ...session(), sessionId: installation.sessionId });
    console.error('Seeding accounts through the local account API.');
    api = new LocalApi(origin, installation.sessionId);
    await seedAccounts(api, installation, seed);
    browser = await chromium.launch({
      headless: true,
      args: [`--remote-debugging-port=${CDP_PORT}`, '--remote-debugging-address=127.0.0.1'],
    });
    browserPid = await waitForPid(CDP_PORT);
    writeSession(root, { ...session(), sessionId: installation.sessionId });
    const context = await browser.newContext({
      viewport, colorScheme: 'light', baseURL: origin, ignoreHTTPSErrors: true,
    });
    page = await context.newPage();
    page.setDefaultTimeout(ACTION_TIMEOUT_MS);
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.goto('/sign-in');
    try {
      await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor({
        state: 'visible',
        timeout: 60_000,
      });
    } catch (error) {
      const body = await page.locator('body').innerText().catch(() => '');
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${detail} Body: ${body.slice(0, 400)} Console: ${consoleErrors.slice(-5).join(' | ')}`,
        { cause: error },
      );
    }
    const ready = session();
    ready.sessionId = installation.sessionId;
    ready.ready = true;
    writeSession(root, ready);

    let queue: Promise<void> = Promise.resolve();
    const enqueue = (work: () => Promise<Result>): Promise<Result> => {
      const run = queue.then(work, work);
      queue = run.then(() => undefined, () => undefined);
      return run;
    };

    control = createServer((socket) => {
      // A client that resets the connection must not crash serve. Its reply is dropped.
      socket.on('error', () => undefined);
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const end = buffer.indexOf('\n');
        if (end === -1) return;
        const line = buffer.slice(0, end);
        buffer = '';
        void enqueue(async () => {
          let parsed: Command;
          try {
            parsed = JSON.parse(line) as Command;
          } catch {
            return { ok: false, error: 'The command was not JSON.' };
          }
          try {
            return await perform(parsed);
          } catch (error) {
            if (page && parsed.op !== 'doctor') {
              await page.screenshot({
                path: evidenceFile(root, path.join(EVIDENCE_DIR, 'last-failure.png')),
              }).catch(() => undefined);
            }
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
          }
        }).then((result) => {
          if (socket.destroyed) {
            if (result.shuttingDown) void stop(0);
            return;
          }
          socket.end(`${JSON.stringify(result)}\n`, () => {
            if (result.shuttingDown) void stop(0);
          });
        });
      });
    });
    await new Promise<void>((resolve, reject) => {
      control?.once('error', reject);
      control?.listen(CONTROL_PORT, '127.0.0.1', () => resolve());
    });
    process.stdout.write(`ready ${origin}\n`);
  } catch (error) {
    console.error(redact(error instanceof Error ? error.message : String(error), secret));
    await stop(1);
  }

  async function perform(command: Command): Promise<Result> {
    if (!page || !api) throw new Error('The browser is not ready.');
    const target = scopeOf(page, command);
    if (command.op === 'shutdown') return { ok: true, shuttingDown: true };
    if (command.op === 'doctor') return doctorLive(api, page);
    if (command.op === 'click') {
      await target.getByRole(...roleQuery(command)).click();
      return { ok: true };
    }
    if (command.op === 'click-text') {
      await target.getByText(requiredText(command), { exact: command.exact ?? false }).click();
      return { ok: true };
    }
    if (command.op === 'fill') {
      await target.getByLabel(requiredLabel(command), { exact: command.exact ?? false }).fill(command.value ?? '');
      return { ok: true };
    }
    if (command.op === 'select') {
      await target.getByLabel(requiredLabel(command), { exact: command.exact ?? false }).selectOption({ label: command.option ?? '' });
      return { ok: true };
    }
    if (command.op === 'absent') {
      const locator = target.getByRole(...roleQuery(command));
      const deadline = Date.now() + ACTION_TIMEOUT_MS;
      let count = await locator.count();
      while (count !== 0 && Date.now() < deadline) {
        await delay(100);
        count = await locator.count();
      }
      if (count !== 0) throw new Error(`Expected no matching control, found ${count}.`);
      return { ok: true, count: 0 };
    }
    if (command.op === 'wait') {
      await target.getByRole(...roleQuery(command)).waitFor({ state: 'visible' });
      return { ok: true };
    }
    if (command.op === 'wait-text') {
      await target.getByText(requiredText(command), { exact: command.exact ?? false }).first().waitFor({ state: 'visible' });
      return { ok: true };
    }
    if (command.op === 'text') {
      const text = await target.getByRole(...roleQuery(command)).innerText();
      return { ok: true, text };
    }
    if (command.op === 'screenshot') {
      const file = evidenceFile(root, command.out ?? '');
      await page.screenshot({ path: file });
      return { ok: true, path: file };
    }
    if (command.op === 'aria') {
      const file = evidenceFile(root, command.out ?? '');
      writeFileSync(file, await page.locator('body').ariaSnapshot());
      return { ok: true, path: file };
    }
    if (command.op === 'snapshot') {
      const name = command.user ?? '';
      const snap = await api.snapshot(name);
      const file = evidenceFile(root, command.out ?? '');
      writeFileSync(file, `${JSON.stringify(snap, null, 2)}\n`);
      return {
        ok: true,
        path: file,
        issues: snap.issues.map((issue) => ({
          number: issue.number,
          status: issue.status,
          category: issue.category,
          description: issue.description,
          owner: issue.owner,
          first_assigned_at: issue.first_assigned_at,
        })),
      };
    }
    if (command.op === 'viewport') {
      const width = command.width ?? 0;
      const height = command.height ?? 0;
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || height < 320) {
        throw new Error('Viewport width and height must be integers of at least 320.');
      }
      await page.setViewportSize({ width, height });
      viewport.width = width;
      viewport.height = height;
      const current = readSession(root);
      if (current) writeSession(root, { ...current, viewport: { width, height } });
      return { ok: true, width, height };
    }
    throw new Error(`Unknown operation ${command.op}.`);
  }
}

/** The role and accessible name of a control. Playwright's exact match defaults to false. */
function roleQuery(command: Command): [Role, { name: string; exact: boolean }] {
  if (!command.role || command.name === undefined) throw new Error('This action needs --role and --name.');
  return [asRole(command.role), { name: command.name, exact: command.exact ?? false }];
}

function requiredLabel(command: Command): string {
  if (!command.label || command.value === undefined && command.option === undefined) {
    throw new Error('This action needs --label and --value or --option.');
  }
  return command.label;
}

function requiredText(command: Command): string {
  if (!command.text) throw new Error('This action needs --text.');
  return command.text;
}

async function doctorLive(api: LocalApi, page: Page): Promise<Result> {
  const signIn = page.getByRole('heading', { name: 'Sign in', exact: true });
  const signInVisible = await signIn.isVisible();
  const uiLocator = page.locator('[data-ui]');
  const ui = (await uiLocator.count()) > 0 ? await uiLocator.first().getAttribute('data-ui') : null;
  const snap = await api.snapshot('admin');
  const usable = signInVisible || ui !== null;
  return {
    ok: usable && snap.session?.name === SESSION_NAME && snap.event?.name === EVENT_NAME,
    signInVisible,
    ui,
    adminSession: snap.session?.name ?? null,
    event: snap.event?.name ?? null,
    error: usable ? undefined : 'The page is neither the sign-in screen nor a signed-in workspace.',
  };
}

async function main(): Promise<void> {
  const root = repositoryRoot();
  // Node puts its own options in execArgv, so argv[1] is always this script.
  const [command = '', ...rest] = process.argv.slice(2);
  const values = flags(rest);
  if (command === '' || command === 'help' || values.help === true) {
    printUsage();
    return;
  }
  if (command === 'serve') {
    const seed = required(values, 'seed');
    if (seed !== 'empty' && seed !== 'jury') throw new Error('--seed must be empty or jury.');
    const viewport = flag(values, 'viewport') ?? '1280x800';
    const match = /^(\d+)x(\d+)$/.exec(viewport);
    if (!match) throw new Error('--viewport must look like 1280x800.');
    await serve(root, seed, { width: Number(match[1]), height: Number(match[2]) });
    return;
  }
  // Internal: serve runs this in a child process. See bootstrapIsolated.
  if (command === 'bootstrap') {
    await bootstrapLocal(root);
    return;
  }
  if (command === 'cleanup') {
    await cleanup(root);
    return;
  }
  if (command === 'doctor') {
    const session = readSession(root);
    if (!session) throw new Error('No session file. Start serve first.');
    const local = doctorLocal(root, session);
    const live = await request(root, { op: 'doctor' });
    const result = {
      ...live,
      ok: local === undefined && live.ok === true,
      origin: session.origin,
      seed: session.seed,
      provider: 'cloudflare',
      viewport: session.viewport,
      sessionPid: session.sessionPid,
      wranglerPid: session.wranglerPid,
      workerPid: session.workerPid,
      browserPid: session.browserPid,
      error: local ?? live.error,
    };
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const result = await request(root, commandFrom(values, command));
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
