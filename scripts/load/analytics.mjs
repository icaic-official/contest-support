// Server-side cost from the Cloudflare GraphQL Analytics API. Each section is a
// separate query, so a token without one dataset still returns the others.
// Series are per minute. A step uses only the minutes that lie wholly inside it.

const { AbortSignal, fetch } = globalThis;

const minuteSeries = {
  d1: `d1AnalyticsAdaptiveGroups(limit: 500, orderBy: [datetimeMinute_ASC],
    filter: {databaseId: $database, datetimeMinute_geq: $from, datetimeMinute_lt: $to}) {
    dimensions { minute: datetimeMinute }
    sum { readQueries writeQueries rowsRead rowsWritten }
    quantiles { queryBatchTimeMsP50 queryBatchTimeMsP99 } }`,
  worker: `workersInvocationsAdaptive(limit: 500, orderBy: [datetimeMinute_ASC],
    filter: {scriptName: $worker, datetime_geq: $from, datetime_lt: $to}) {
    dimensions { minute: datetimeMinute }
    sum { requests errors subrequests cpuTimeUs }
    quantiles { cpuTimeP50 cpuTimeP99 wallTimeP99 } }`,
  durableObjects: `durableObjectsPeriodicGroups(limit: 500, orderBy: [datetimeMinute_ASC],
    filter: {namespaceId: $namespace, datetimeMinute_geq: $from, datetimeMinute_lt: $to}) {
    dimensions { minute: datetimeMinute }
    sum { cpuTime activeTime outboundWebsocketMsgCount exceededCpuErrors exceededMemoryErrors subrequests } }`,
};

const topQueries = `d1QueriesAdaptiveGroups(limit: 10, orderBy: [sum_queryDurationMs_DESC],
  filter: {databaseId: $database, datetime_geq: $from, datetime_lt: $to}) {
  count sum { queryDurationMs rowsRead rowsWritten } dimensions { query } }`;

// GraphQL rejects declared variables that a query does not use.
async function query(token, accountId, body, variables) {
  const used = Object.entries(variables).filter(([name]) => body.includes(`$${name}`));
  const declared = used.map(([name]) => `, $${name}: ${['from', 'to'].includes(name) ? 'Time' : 'String'}!`).join('');
  const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query($account: String!${declared}) {
        viewer { accounts(filter: {accountTag: $account}) { result: ${body} } } }`,
      variables: { account: accountId, ...Object.fromEntries(used) },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.errors?.length || !result.data) {
    return { error: result.errors?.map((error) => error.message).join('; ') || `HTTP ${response.status}` };
  }
  return result.data.viewer.accounts[0].result;
}

/** Durable Object time is reported per namespace, not per Worker. */
async function liveNamespace(token, accountId, workerName) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/durable_objects/namespaces?per_page=100`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => ({}));
  const namespace = body.result?.find((entry) => entry.script === workerName && entry.class === 'SessionLiveCoordinator');
  return namespace?.id ?? 'unknown';
}

const minute = 60_000;
const iso = (ms) => new Date(ms).toISOString();

/** Adds every numeric field of the whole minutes inside [from, to) and divides by the minute count. */
export function perMinute(series, from, to) {
  if (!Array.isArray(series)) return series;
  const inside = series.filter((group) => {
    const start = Date.parse(group.dimensions.minute);
    return start >= from && start + minute <= to;
  });
  const total = {};
  for (const group of inside) {
    for (const [section, values] of Object.entries(group)) {
      if (section === 'dimensions') continue;
      for (const [field, value] of Object.entries(values)) {
        const key = `${section}.${field}`;
        total[key] = section === 'quantiles' ? Math.max(total[key] ?? 0, value) : (total[key] ?? 0) + value;
      }
    }
  }
  for (const key of Object.keys(total)) if (!key.startsWith('quantiles.')) total[key] /= inside.length || 1;
  return { minutes: inside.length, ...total };
}

/** Per-minute averages for each step, and the slowest D1 statements for the whole run. */
export async function fetchAnalytics({ token, accountId, databaseId, workerName, steps }) {
  const from = Math.floor(Math.min(...steps.map((step) => step.startedAt)) / minute) * minute;
  const to = Math.ceil(Math.max(...steps.map((step) => step.endedAt)) / minute) * minute;
  const variables = { database: databaseId, worker: workerName, namespace: await liveNamespace(token, accountId, workerName),
    from: iso(from), to: iso(to) };
  const series = {};
  for (const [name, body] of Object.entries(minuteSeries)) series[name] = await query(token, accountId, body, variables);
  return {
    window: { from: iso(from), to: iso(to) },
    steps: steps.map((step) => Object.fromEntries(Object.entries(series).map(([name, value]) =>
      [name, perMinute(value, step.startedAt, step.endedAt)]))),
    topQueries: await query(token, accountId, topQueries, variables),
  };
}
