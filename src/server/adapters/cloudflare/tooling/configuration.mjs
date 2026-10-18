import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

export const repositoryRoot = fileURLToPath(new URL('../../../../..', import.meta.url));
const fields = ['accountId', 'workerName', 'databaseName', 'databaseId', 'bucketName', 'origin'];
const placementRegion = /^(?:aws|gcp|azure):[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const name = /^[a-z][a-z0-9-]{1,61}[a-z0-9]$/;
const placeholder = /replace|your[-_]|placeholder|<|>/i;

function loopback(hostname) {
  return hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

/** Public settings only. Credentials have no field in this format. */
export function validateProviderConfiguration(input, { allowLocal = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some((key) => !fields.includes(key) && key !== 'placementRegion') ||
      fields.some((key) => !Object.hasOwn(input, key) || typeof input[key] !== 'string')) {
    throw new Error('Provide exactly the documented public Cloudflare settings.');
  }
  const optional = Object.hasOwn(input, 'placementRegion') ? ['placementRegion'] : [];
  if (optional.length && (typeof input.placementRegion !== 'string' || !placementRegion.test(input.placementRegion))) {
    throw new Error('Set placementRegion to a documented aws, gcp, or azure region identifier.');
  }
  if (!/^[a-f0-9]{32}$/.test(input.accountId) || !uuid.test(input.databaseId)) {
    throw new Error('Set the Cloudflare account ID and D1 database UUID.');
  }
  const names = [input.workerName, input.databaseName, input.bucketName];
  if (names.some((value) => !name.test(value) || placeholder.test(value))) {
    throw new Error('Set explicit resource names with 3 to 63 lowercase letters, digits, or hyphens.');
  }
  let origin;
  try {
    origin = new URL(input.origin);
  } catch {
    throw new Error('Set an exact HTTPS origin. Local HTTP requires explicit local mode.');
  }
  const local = loopback(origin.hostname);
  const validHostname = origin.hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
  if (origin.origin !== input.origin || origin.username || origin.password || origin.search || origin.hash ||
      origin.pathname !== '/' || placeholder.test(origin.hostname) ||
      (!local && !validHostname) ||
      (local ? !allowLocal || !['http:', 'https:'].includes(origin.protocol) : origin.protocol !== 'https:')) {
    throw new Error('Set an exact HTTPS origin. Local HTTP requires explicit local mode.');
  }
  if (origin.hostname.endsWith('.workers.dev') &&
      (origin.hostname.split('.').length !== 4 || origin.hostname.split('.')[0] !== input.workerName)) {
    throw new Error('The workers.dev origin must identify the configured Worker name.');
  }
  return Object.fromEntries([...fields, ...optional].map((key) => [key, input[key]]));
}

function relativePath(configPath, target) {
  const path = relative(dirname(resolve(configPath)), target).replaceAll('\\', '/');
  return path || '.';
}

/** All provider bindings stay in this Cloudflare configuration generator. */
export function renderWranglerConfiguration(input, configPath, { allowLocal = false } = {}) {
  const settings = validateProviderConfiguration(input, { allowLocal });
  const origin = new URL(settings.origin);
  const local = loopback(origin.hostname);
  const config = {
    $schema: relativePath(configPath, resolve(repositoryRoot, 'node_modules/wrangler/config-schema.json')),
    name: settings.workerName,
    main: relativePath(configPath, resolve(repositoryRoot, 'src/server/adapters/cloudflare/applicationWorker.ts')),
    account_id: settings.accountId,
    compatibility_date: '2026-10-13',
    compatibility_flags: ['nodejs_compat'],
    workers_dev: true,
    preview_urls: false,
    placement: settings.placementRegion ? { region: settings.placementRegion } : { mode: 'smart' },
    limits: { cpu_ms: 1000 },
    observability: { enabled: false },
    triggers: { crons: ['* * * * *'] },
    vars: { AUTH_ORIGIN: settings.origin },
    assets: {
      directory: relativePath(configPath, resolve(repositoryRoot, 'dist')),
      binding: 'ASSETS',
      not_found_handling: 'single-page-application',
      run_worker_first: true,
    },
    d1_databases: [{
      binding: 'DB', database_name: settings.databaseName, database_id: settings.databaseId,
      migrations_dir: relativePath(configPath, resolve(repositoryRoot, 'src/server/adapters/d1/migrations')),
      remote: true,
    }],
    r2_buckets: [{ binding: 'IMAGES', bucket_name: settings.bucketName, remote: true }],
    durable_objects: { bindings: [{ name: 'LIVE_UPDATES', class_name: 'SessionLiveCoordinator' }] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['SessionLiveCoordinator'] }],
  };
  if (!local && !origin.hostname.endsWith('.workers.dev')) {
    config.routes = [{ pattern: origin.hostname, custom_domain: true }];
  }
  return config;
}

export async function readPublicJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error('The selected public JSON file could not be read. Check its path and syntax.');
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

/** Reject extra bindings, environment overrides, secret variables, or changed entries. */
export async function readInstallationTarget(configPath) {
  const config = await readPublicJson(configPath);
  let settings;
  try {
    settings = validateProviderConfiguration({
      accountId: config.account_id, workerName: config.name,
      databaseName: config.d1_databases[0].database_name, databaseId: config.d1_databases[0].database_id,
      bucketName: config.r2_buckets[0].bucket_name, origin: config.vars.AUTH_ORIGIN,
      ...(config.placement && Object.hasOwn(config.placement, 'region')
        ? { placementRegion: config.placement.region } : {}),
    });
  } catch {
    throw new Error('The installation configuration is invalid. Regenerate it from public settings.');
  }
  const expected = renderWranglerConfiguration(settings, configPath);
  if (JSON.stringify(canonical(config)) !== JSON.stringify(canonical(expected))) {
    throw new Error('The installation configuration changed. Regenerate it before any hosted operation.');
  }
  return settings;
}

/** Parse public arguments without echoing rejected values or accepting credentials. */
export function parseArguments(arguments_) {
  const [command, ...argumentsRest] = arguments_;
  const required = {
    plan: ['settings', 'config'],
    configure: ['settings', 'config'],
    bootstrap: ['config', 'account', 'database', 'competition', 'credentials'],
    recover: ['config', 'account', 'database', 'installation', 'owner', 'credentials'],
    secret: ['config', 'account', 'database'],
    migrate: ['config', 'account', 'database'],
  };
  if (!Object.hasOwn(required, command)) {
    throw new Error('Choose plan, configure, bootstrap, recover, secret, or migrate.');
  }
  const result = { command };
  for (const argument of argumentsRest) {
    if (argument === '--local' && ['plan', 'configure'].includes(command) && !result.local) {
      result.local = true;
      continue;
    }
    const match = /^--([a-z]+)=(.+)$/.exec(argument);
    if (!match || !required[command].includes(match[1]) || Object.hasOwn(result, match[1])) {
      throw new Error('Use each documented public option once. Password and token arguments are forbidden.');
    }
    result[match[1]] = match[2];
  }
  if (required[command].some((key) => !result[key])) throw new Error('Supply every required public option for the selected command.');
  if (result.installation && (!uuid.test(result.installation) || !uuid.test(result.owner))) {
    throw new Error('Select the installation and owner by UUID.');
  }
  for (const field of ['config', 'settings', 'competition', 'credentials']) {
    if (result[field]) result[field] = resolve(result[field]);
  }
  return result;
}
