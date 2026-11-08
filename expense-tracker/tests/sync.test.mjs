import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { webcrypto } from 'node:crypto';

const root = new URL('../', import.meta.url);
const core = readFileSync(new URL('sync-core.js', root), 'utf8');
const client = readFileSync(new URL('cloud-sync.js', root), 'utf8');
const workerSource = readFileSync(new URL('sync-worker/src/index.js', root), 'utf8');
const { default: worker, validEntries } = await import('data:text/javascript;base64,' + Buffer.from(workerSource).toString('base64'));
const key = 'a-test-only-sync-key-with-more-than-24-characters';
const record = id => ({ id, date: '2026-11-08', largeCat: 'B-食', smallCat: '饮食', amount: 20 });
function backend() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('sync-worker/schema.sql', root), 'utf8'));
  return { SYNC_KEY: key, DB: { prepare(sql) {
    let args = [];
    return { bind(...values) { args = values; return this; },
      async first() { return db.prepare(sql).get(...args) || null; },
      async run() { const result = db.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } }; } };
  } } };
}
function device(env, initial = {}) {
  const data = new Map(Object.entries(initial));
  data.set('spendex_sync_config_v1', JSON.stringify({ url: 'https://sync.example', key }));
  const elements = new Map();
  const ctx = vm.createContext({
    console, crypto: webcrypto, URL, AbortSignal, Date, JSON, Math,
    navigator: { onLine: false },
    localStorage: { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k) },
    setTimeout: () => 1, clearTimeout() {}, setInterval() {},
    addEventListener() {},
    document: { hidden: false, addEventListener() {}, getElementById(id) {
      if (!elements.has(id)) elements.set(id, { classList: { contains: () => false } });
      return elements.get(id);
    } },
    getRecords: () => JSON.parse(data.get('expense_records') || '[]'),
    getTrips: () => JSON.parse(data.get('travel_trips') || '[]'),
    fetch: (url, options) => worker.fetch(new Request(url, options), env)
  });
  ctx.window = ctx;
  vm.runInContext(core, ctx); vm.runInContext(client, ctx);
  return {
    ctx, data,
    async sync() { ctx.navigator.onLine = true; await ctx.CloudSync.sync(); },
    write(k, v) { data.set(k, JSON.stringify(v)); ctx.CloudSync.changed(); },
    records: () => JSON.parse(data.get('expense_records') || '[]'),
    trips: () => JSON.parse(data.get('travel_trips') || '[]')
  };
}

test('two offline devices merge additions, edits and deletion without resurrection', async () => {
  const env = backend(), a = device(env), b = device(env);
  a.write('expense_records', [record(1)]); b.write('expense_records', [record(2)]);
  await Promise.all([a.sync(), b.sync()]); await a.sync(); await b.sync();
  assert.deepEqual(a.records(), b.records()); assert.equal(a.records().length, 2);
  b.ctx.navigator.onLine = false;
  a.write('expense_records', [record(2)]); await a.sync();
  b.write('expense_records', [record(1), { ...record(2), amount: 99 }]);
  await b.sync(); await a.sync();
  assert.deepEqual(a.records(), [{ ...record(2), amount: 99 }]);
  assert.deepEqual(a.records(), b.records());
});

test('travel expenses merge independently and deleted trips stay deleted', async () => {
  const env = backend();
  const trip = { id: 10, name: '旅行', status: 'active', records: [] };
  const a = device(env, { travel_trips: JSON.stringify([trip]) });
  await a.sync(); const b = device(env); await b.sync();
  a.write('travel_trips', [{ ...trip, records: [{ id: 11, date: '2026-11-08', category: '餐饮', amount: 5 }] }]);
  b.write('travel_trips', [{ ...trip, records: [{ id: 12, date: '2026-11-08', category: '出行', amount: 7 }] }]);
  await Promise.all([a.sync(), b.sync()]); await a.sync(); await b.sync();
  assert.equal(a.trips()[0].records.length, 2); assert.deepEqual(a.trips(), b.trips());
  a.write('travel_trips', []); await a.sync(); await b.sync();
  assert.deepEqual(b.trips(), []);
});

test('new device seeds do not overwrite cloud edits or weekly budget', async () => {
  const env = backend(), a = device(env);
  a.write('expense_records', [{ ...record(1), amount: 40 }]);
  a.write('weekly_food_budget', 500); await a.sync();
  const b = device(env, { expense_records: JSON.stringify([record(1), record(2)]), weekly_food_budget: '300' });
  await b.sync(); await a.sync();
  assert.equal(b.records()[0].amount, 40); assert.equal(b.records().length, 2);
  assert.equal(b.data.get('weekly_food_budget'), '500');
});

test('changes made during upload remain pending and upload on next sync', async () => {
  const env = backend(), a = device(env);
  a.write('expense_records', [record(1)]);
  const original = a.ctx.fetch;
  let modified = false;
  a.ctx.fetch = async (url, options) => {
    const response = await original(url, options);
    if (options.method === 'PUT' && !modified) {
      modified = true; a.write('expense_records', [record(1), record(2)]);
    }
    return response;
  };
  await a.sync(); assert.equal(a.records().length, 2);
  await a.sync(); const b = device(env); await b.sync(); assert.equal(b.records().length, 2);
});

test('worker rejects unauthorized, foreign origins, malformed data and stale revisions', async () => {
  const env = backend();
  const call = (method, body, headers = {}) => worker.fetch(new Request('https://sync.example/sync', {
    method, headers: { Authorization: 'Bearer ' + key, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }), env);
  assert.equal((await call('GET', undefined, { Authorization: 'wrong' })).status, 401);
  assert.equal((await call('GET', undefined, { Origin: 'https://evil.example' })).status, 403);
  const preflight = await call('OPTIONS', undefined, { Origin: 'https://shelvee11.github.io' });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://shelvee11.github.io');
  assert.equal((await call('PUT', { revision: 0, entries: { bad: {} } })).status, 400);
  assert.equal((await call('PUT', { revision: 0, entries: {} })).status, 200);
  assert.equal((await call('PUT', { revision: 0, entries: {} })).status, 409);
  assert.equal((await call('PUT', { revision: 1, entries: {} })).status, 200);
  assert.equal((await call('GET')).headers.get('Cache-Control'), 'no-store');
  assert.equal(validEntries({ budget: { value: -1, stamp: '0000000000000000-seed' } }), false);
  assert.equal((await call('PUT', { revision: 2, entries: {} }, { 'Content-Length': String(5 * 1024 * 1024) })).status, 413);
});

test('service worker bypasses sync and only deletes Spendex caches', async () => {
  const handlers = {};
  let deleted = [];
  const context = vm.createContext({ URL, Response, Promise, fetch() { throw new Error('Must not intercept API'); },
    self: { location: { href: 'https://shelvee11.github.io/master/expense-tracker/service-worker.js', origin: 'https://shelvee11.github.io' },
      addEventListener: (name, callback) => handlers[name] = callback, clients: { claim() {} } },
    caches: { keys: async () => ['spendex-v15', 'other-app-v1'], delete: async k => deleted.push(k) }
  });
  vm.runInContext(readFileSync(new URL('service-worker.js', root), 'utf8'), context);
  let activation; handlers.activate({ waitUntil: p => activation = p }); await activation;
  assert.deepEqual(deleted, ['spendex-v15']);
  for (const [url, method] of [['https://sync.example/sync', 'GET'], ['https://shelvee11.github.io/sync', 'PUT']]) {
    handlers.fetch({ request: new Request(url, { method }), respondWith() { assert.fail('API must bypass cache'); } });
  }
});
