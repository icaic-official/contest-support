#!/usr/bin/env node
/**
 * Verification scaffolding for the Minsky web app.
 * Starts Vite, an in-memory database, and one Chromium window.
 * This file is not part of the contest application.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect, createServer, type Server, type Socket } from 'node:net';
import path from 'node:path';
import { chromium, type Browser, type Locator, type Page } from '@playwright/test';
import { createJuryFixture } from '../../../../tests/jury-fixture.ts';

const APP_PORT = 5199;
const CONTROL_PORT = 5198;
const CDP_PORT = 9223;
const ACTION_TIMEOUT_MS = 45_000;
const SESSION_DIR = '.verify-minsky';
const EVIDENCE_DIR = path.join(SESSION_DIR, 'evidence');

type Seed = 'empty' | 'jury';
type Fixture = Awaited<ReturnType<typeof createJuryFixture>>;
type Role = Parameters<Page['getByRole']>[0];

interface SessionFile {
  sessionPid: number;
  vitePid: number;
  browserPid: number;
  port: number;
  controlPort: number;
  cdpPort: number;
  origin: string;
  seed: Seed;
  viewport: { width: number; height: number };
  ready: boolean;
}

interface Command {
  op: string;
  role?: string;
  name?: string;
  exact?: boolean;
  label?: string;
  value?: string;
  text?: string;
  option?: string;
  withinRole?: string;
  withinName?: string;
  withinExact?: boolean;
  out?: string;
  user?: string;
  width?: number;
  height?: number;
}

interface Result {
  ok: boolean;
  error?: string;
  shuttingDown?: boolean;
  text?: string;
  path?: string;
  [key: string]: unknown;
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
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errno(error) === 'EPERM';
  }
}

function cmdline(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ').trim();
  } catch {
    return '';
  }
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

function flags(argv: string[]): { command: string; values: Record<string, string | true> } {
  const script = process.argv.findIndex((arg) => arg.endsWith('minsky-verify.ts'));
  const start = script === -1 ? 2 : script + 1;
  const command = process.argv[start] ?? '';
  const values: Record<string, string | true> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument ${arg}`);
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) values[key] = true;
    else {
      values[key] = next;
      index += 1;
    }
  }
  return { command, values };
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
    name: command.withinName,
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
  node .cursor/skills/verify-minsky/scripts/minsky-verify.ts cleanup

Optional scope flags: --within-role <role> --within-name <name> [--within-exact]`);
}

async function request(root: string, command: Command): Promise<Result> {
  const session = readSession(root);
  const port = session?.controlPort ?? CONTROL_PORT;
  return new Promise((resolve, reject) => {
    const socket = createClient(port, resolve, reject);
    socket.write(`${JSON.stringify(command)}\n`);
  });
}

function createClient(
  port: number,
  resolve: (result: Result) => void,
  reject: (error: Error) => void,
): Socket {
  const socket = connect(port, '127.0.0.1');
  let buffer = '';
  const timer = setTimeout(() => {
    socket.destroy();
    reject(new Error('The verification session did not answer within 60 seconds.'));
  }, 60_000);
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
  const deadline = Date.now() + 60_000;
  let last = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const body = await response.text();
      if (response.status === 200 && body.includes('id="root"')) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await delay(250);
  }
  throw new Error(`Vite did not serve the app shell: ${last}`);
}

async function waitForPid(port: number): Promise<number> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const pids = listenPids(port);
    if (pids.length === 1) return pids[0];
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
  if (!matches(line)) {
    throw new Error(`Refusing to signal pid ${pid}. Its command line is not the recorded verification process.`);
  }
  process.kill(pid, 'SIGTERM');
}

async function waitDead(pid: number): Promise<boolean> {
  const deadline = Date.now() + 5_000;
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
  if (alive(pid) && matches(cmdline(pid))) process.kill(pid, 'SIGKILL');
  if (!(await waitDead(pid))) throw new Error(`Pid ${pid} is still running after SIGKILL.`);
}

function viteMatches(port: number): (line: string) => boolean {
  return (line) => line.includes('vite.js') && line.includes(String(port));
}

function browserMatches(cdpPort: number): (line: string) => boolean {
  return (line) => line.includes(`remote-debugging-port=${cdpPort}`);
}

function sessionMatches(line: string): boolean {
  return line.includes('minsky-verify.ts') && line.includes('serve');
}

async function cleanup(root: string): Promise<void> {
  const session = readSession(root);
  if (!session) {
    const busy = [APP_PORT, CONTROL_PORT, CDP_PORT].flatMap((port) => listenPids(port).map((pid) => `${port}:${pid}`));
    if (busy.length > 0) {
      throw new Error(`No session file is present. Ports are in use (${busy.join(', ')}). This cleanup does not kill unrecorded processes.`);
    }
    console.log(JSON.stringify({ ok: true, stopped: false }));
    return;
  }
  try {
    await request(root, { op: 'shutdown' });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('No verification session')) throw error;
  }
  if (alive(session.sessionPid)) {
    signalIfRecorded(session.sessionPid, sessionMatches);
    await waitDead(session.sessionPid);
  }
  await stopRecorded(session.browserPid, browserMatches(session.cdpPort));
  await stopRecorded(session.vitePid, viteMatches(session.port));
  if (alive(session.sessionPid)) await stopRecorded(session.sessionPid, sessionMatches);
  rmSync(sessionPath(root), { force: true });
  console.log(JSON.stringify({ ok: true, stopped: true }));
}

function doctorLocal(session: SessionFile): string | undefined {
  if (!alive(session.sessionPid) || !sessionMatches(cmdline(session.sessionPid))) {
    return 'The recorded session process is not the running serve command.';
  }
  if (!alive(session.vitePid) || !viteMatches(session.port)(cmdline(session.vitePid))) {
    return 'The recorded Vite process is not listening for this session.';
  }
  if (!alive(session.browserPid) || !browserMatches(session.cdpPort)(cmdline(session.browserPid))) {
    return 'The recorded Chromium process is not the session browser.';
  }
  const owners = [
    [session.port, session.vitePid, 'app'],
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

async function serve(root: string, seed: Seed, viewport: { width: number; height: number }): Promise<void> {
  const existing = readSession(root);
  if (existing && (alive(existing.sessionPid) || alive(existing.vitePid) || alive(existing.browserPid))) {
    throw new Error('Refusing to start. A verification session already owns this slot. Run cleanup on that session before you start another. Do not drive a second browser against it.');
  }
  if (existing) rmSync(sessionPath(root), { force: true });
  refuseIfBusy(APP_PORT, 'App');
  refuseIfBusy(CONTROL_PORT, 'Control');
  refuseIfBusy(CDP_PORT, 'Browser');

  mkdirSync(path.join(root, EVIDENCE_DIR), { recursive: true });
  const log = path.join(root, SESSION_DIR, 'vite.log');
  mkdirSync(path.dirname(log), { recursive: true });
  writeFileSync(log, '');
  const logFd = openSync(log, 'a');
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'development' };
  env.VITE_SUPABASE_URL = 'https://example.supabase.co';
  env.VITE_SUPABASE_PUBLISHABLE_KEY = 'public-test-key';
  env.VITE_BACKEND = 'supabase';
  env.VITE_ENVIRONMENT = 'development';
  const vite = spawn(process.execPath, [
    'node_modules/vite/bin/vite.js',
    '--host', '127.0.0.1',
    '--port', String(APP_PORT),
    '--strictPort',
  ], { cwd: root, env, stdio: ['ignore', logFd, logFd] });
  if (!vite.pid) throw new Error('Vite did not start.');

  let browser: Browser | undefined;
  let fixture: Fixture | undefined;
  let control: Server | undefined;
  let page: Page | undefined;
  let browserPid = 0;
  let shuttingDown = false;
  const origin = `http://127.0.0.1:${APP_PORT}`;
  const session = (): SessionFile => ({
    sessionPid: process.pid,
    vitePid: vite.pid ?? 0,
    browserPid,
    port: APP_PORT,
    controlPort: CONTROL_PORT,
    cdpPort: CDP_PORT,
    origin,
    seed,
    viewport,
    ready: false,
  });
  writeSession(root, session());

  const stop = async (code: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    control?.close();
    await browser?.close().catch(() => undefined);
    await fixture?.close().catch(() => undefined);
    if (vite.pid && alive(vite.pid)) {
      vite.kill('SIGTERM');
      if (!(await waitDead(vite.pid))) vite.kill('SIGKILL');
    }
    rmSync(sessionPath(root), { force: true });
    process.exit(code);
  };

  process.on('SIGTERM', () => void stop(0));
  process.on('SIGINT', () => void stop(0));
  vite.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`Vite exited (${code ?? 'signal'}).`);
      void stop(1);
    }
  });

  try {
    const database = createJuryFixture({ seedIssues: seed === 'jury' });
    await waitForHttp(origin);
    fixture = await database;
    browser = await chromium.launch({
      headless: true,
      args: [`--remote-debugging-port=${CDP_PORT}`, '--remote-debugging-address=127.0.0.1'],
    });
    browserPid = await waitForPid(CDP_PORT);
    writeSession(root, session());
    const context = await browser.newContext({ viewport, colorScheme: 'light', baseURL: origin });
    await fixture.attach(context);
    page = await context.newPage();
    page.setDefaultTimeout(ACTION_TIMEOUT_MS);
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.goto('/');
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
    const current = session();
    current.ready = true;
    writeSession(root, current);

    let queue: Promise<void> = Promise.resolve();
    const enqueue = (work: () => Promise<Result>): Promise<Result> => {
      const run = queue.then(work, work);
      queue = run.then(() => undefined, () => undefined);
      return run;
    };

    control = createServer((socket) => {
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
    console.error(error instanceof Error ? error.message : error);
    await stop(1);
  }

  async function perform(command: Command): Promise<Result> {
    if (!page || !fixture) throw new Error('The browser is not ready.');
    const target = scopeOf(page, command);
    if (command.op === 'shutdown') return { ok: true, shuttingDown: true };
    if (command.op === 'doctor') return doctorLive(fixture, page);
    if (command.op === 'click') {
      await target.getByRole(asRole(requiredRole(command)), { name: command.name, exact: command.exact }).click();
      return { ok: true };
    }
    if (command.op === 'click-text') {
      await target.getByText(requiredText(command), { exact: command.exact }).click();
      return { ok: true };
    }
    if (command.op === 'fill') {
      await target.getByLabel(requiredLabel(command), { exact: command.exact }).fill(command.value ?? '');
      return { ok: true };
    }
    if (command.op === 'select') {
      await target.getByLabel(requiredLabel(command), { exact: command.exact }).selectOption({ label: command.option ?? '' });
      return { ok: true };
    }
    if (command.op === 'absent') {
      const locator = target.getByRole(asRole(requiredRole(command)), {
        name: command.name,
        exact: command.exact,
      });
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
      await target.getByRole(asRole(requiredRole(command)), { name: command.name, exact: command.exact }).waitFor({ state: 'visible' });
      return { ok: true };
    }
    if (command.op === 'wait-text') {
      await target.getByText(requiredText(command), { exact: command.exact }).first().waitFor({ state: 'visible' });
      return { ok: true };
    }
    if (command.op === 'text') {
      const text = await target.getByRole(asRole(requiredRole(command)), { name: command.name, exact: command.exact }).innerText();
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
      const user = fixture.users[name];
      if (!user) throw new Error(`Unknown account ${name}.`);
      const snap = await fixture.snapshot(user);
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

function requiredRole(command: Command): string {
  if (!command.role || command.name === undefined) throw new Error('This action needs --role and --name.');
  return command.role;
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

async function doctorLive(fixture: Fixture, page: Page): Promise<Result> {
  const signIn = page.getByRole('heading', { name: 'Sign in', exact: true });
  const signInVisible = await signIn.isVisible();
  const uiLocator = page.locator('[data-ui]');
  const ui = (await uiLocator.count()) > 0 ? await uiLocator.first().getAttribute('data-ui') : null;
  const snap = await fixture.snapshot(fixture.users.admin);
  const usable = signInVisible || ui !== null;
  return {
    ok: usable && snap.session?.name === 'Primary' && snap.event?.name === 'Jury verification',
    signInVisible,
    ui,
    adminSession: snap.session?.name ?? null,
    event: snap.event?.name ?? null,
    error: usable ? undefined : 'The page is neither the sign-in screen nor a signed-in workspace.',
  };
}

async function main(): Promise<void> {
  const root = repositoryRoot();
  const argv = process.argv.slice(process.argv.findIndex((arg) => arg.endsWith('minsky-verify.ts')) + 2);
  const { command, values } = flags(argv);
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
  if (command === 'cleanup') {
    await cleanup(root);
    return;
  }
  if (command === 'doctor') {
    const session = readSession(root);
    if (!session) throw new Error('No session file. Start serve first.');
    const local = doctorLocal(session);
    const live = await request(root, { op: 'doctor' });
    const result = {
      ...live,
      ok: local === undefined && live.ok === true,
      origin: session.origin,
      seed: session.seed,
      viewport: session.viewport,
      sessionPid: session.sessionPid,
      vitePid: session.vitePid,
      browserPid: session.browserPid,
      error: local ?? live.error,
    };
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const op = command;
  const result = await request(root, commandFrom(values, op));
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
