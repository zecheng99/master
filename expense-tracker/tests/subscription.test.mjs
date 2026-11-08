import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
const context = vm.createContext({ crypto: webcrypto, TextEncoder });
vm.runInContext(readFileSync(new URL('../subscription-core.js', import.meta.url), 'utf8'), context);
const Sub = context.SpendexSubscriptions;
const seed = '0000000000000000-seed';
const subscription = overrides => ({ id: 123, name: '云存储', amount: 18, day: 31, startMonth: '2026-01', nextMonth: '2026-01', largeCat: 'Z-其他', smallCat: '订阅', status: 'active', ...overrides });
const entries = value => ({ 'subscription:123': { value, stamp: seed } });
const bills = state => Object.entries(state).filter(([key, entry]) => key.startsWith('record:') && entry.value).map(([, entry]) => entry.value);

test('calendar handles short months, leap years, year rollover and home timezone', () => {
  assert.equal(Sub.dueDate('2026-02', 31), '2026-02-28');
  assert.equal(Sub.dueDate('2028-02', 31), '2028-02-29');
  assert.equal(Sub.dueDate('2026-04', 31), '2026-04-30');
  assert.equal(Sub.nextMonth('2026-12'), '2027-01');
  assert.equal(Sub.today(Date.parse('2026-01-31T16:00:00Z')), '2026-02-01');
});

test('due bills are pending, catch up and generate only once per subscription month', async () => {
  const original = entries(subscription());
  assert.equal((await Sub.generate(original, '2026-01-30')).generated, 0);
  const generated = await Sub.generate(original, '2026-03-31');
  assert.deepEqual(bills(generated.entries).map(bill => bill.date), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.ok(bills(generated.entries).every(bill => bill.pending && !bill.ignored && bill.amount === 18));
  assert.equal(generated.entries['subscription-state:123'].value.nextMonth, '2026-04');
  assert.equal(generated.entries['subscription:123'], original['subscription:123']);
  assert.equal((await Sub.generate(generated.entries, '2026-03-31')).changed, false);
  assert.equal(original['subscription:123'].value.nextMonth, '2026-01');
});

test('changing price affects future bills; confirmed, edited and deleted bills remain untouched', async () => {
  const first = await Sub.generate(entries(subscription()), '2026-01-31');
  const id = bills(first.entries)[0].id, key = 'record:' + id;
  first.entries[key].value = { ...first.entries[key].value, amount: 17, pending: false };
  first.entries['subscription:123'].value.amount = 25;
  const second = await Sub.generate(first.entries, '2026-02-28');
  assert.equal(second.entries[key].value.amount, 17);
  assert.equal(second.entries[key].value.pending, false);
  assert.equal(bills(second.entries).find(bill => bill.subscriptionMonth === '2026-02').amount, 25);
  second.entries[key] = { value: null, stamp: seed };
  second.entries['subscription-state:123'].value.nextMonth = '2026-01';
  const repeated = await Sub.generate(second.entries, '2026-02-28');
  assert.equal(repeated.entries[key].value, null);
  assert.equal(repeated.generated, 0);
});

test('paused and cancelled subscriptions skip bills; resume starts at the next applicable date', async () => {
  for (const status of ['paused', 'cancelled']) assert.equal((await Sub.generate(entries(subscription({ status })), '2026-12-31')).generated, 0);
  assert.equal(Sub.resumeMonth(subscription({ day: 15 }), '2026-05-16'), '2026-06');
  assert.equal(Sub.resumeMonth(subscription({ day: 15 }), '2026-05-15'), '2026-05');
  assert.equal(Sub.resumeMonth(subscription({ startMonth: '2027-01' }), '2026-05-15'), '2027-01');
});

test('legacy clients cannot erase subscription settings with unknown-entry tombstones', () => {
  const stored = entries(subscription({ status: 'cancelled' }));
  const incoming = { 'subscription:123': { value: null, stamp: '0000000000000123-00000000-0000-0000-0000-000000000000' } };
  const result = Sub.preserveSettings(incoming, stored);
  assert.equal(result.changed, true);
  assert.equal(result.entries['subscription:123'].value.status, 'cancelled');
  assert.ok(result.entries['subscription:123'].stamp > incoming['subscription:123'].stamp);
  assert.equal(incoming['subscription:123'].value, null);
});

test('long catch-up is bounded and can continue without duplicates', async () => {
  const first = await Sub.generate(entries(subscription({ startMonth: '2000-01', nextMonth: '2000-01' })), '2026-01-31');
  assert.equal(first.generated, 120);
  const second = await Sub.generate(first.entries, '2026-01-31');
  assert.equal(second.generated, 120);
  assert.equal(new Set(bills(second.entries).map(bill => bill.id)).size, 240);
});

test('subscription validation rejects invalid schedules, amounts and states', () => {
  assert.equal(Sub.valid(subscription()), true);
  for (const invalid of [{ day: 0 }, { day: 32 }, { day: 1.5 }, { amount: 0 }, { amount: Infinity }, { amount: .001 }, { startMonth: '2026-13' }, { nextMonth: '2025-12' }, { status: 'unknown' }]) assert.equal(Sub.valid(subscription(invalid)), false);
});
