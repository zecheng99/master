import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('../travel-core.js', import.meta.url), 'utf8'), context);
const Travel = context.SpendexTravel;
const plain = value => JSON.parse(JSON.stringify(value));
const record = (amount, currency) => ({ id: 1, date: '2026-11-08', category: '餐饮', amount, ...(currency ? { currency } : {}) });

test('legacy records remain CNY and mixed currencies are not added together', () => {
  assert.deepEqual(plain(Travel.totals({ records: [record(2500)] })), { byCurrency: { CNY: 2500 }, cny: 2500, missing: [], complete: true });
  const result = Travel.totals({ records: [record(2500), record(2000, 'JPY')] });
  assert.equal(result.complete, false);
  assert.deepEqual(plain(result.byCurrency), { CNY: 2500, JPY: 2000 });
  assert.deepEqual(plain(result.missing), ['JPY']);
  assert.equal(result.cny, 2500);
  assert.equal(Travel.converted({ rates: {} }, record(2000, 'JPY')), null);
});

test('trip-wide settlement rates recompute records and totals consistently', () => {
  const trip = { rates: { JPY: .05, USD: 7 }, records: [record(2500), record(2000, 'JPY'), record(10, 'USD')] };
  assert.equal(Travel.totals(trip).cny, 2670);
  assert.equal(Travel.totals(trip).complete, true);
  trip.rates.JPY = .048;
  assert.equal(Travel.totals(trip).cny, 2666);
  assert.equal(Travel.converted(trip, trip.records[1]), 96);
  assert.equal(Travel.totals({ records: [record(.1), record(.2)] }).cny, .3);
  assert.equal(Travel.totals({ records: [] }).cny, 0);
});

test('new CSV round-trips currencies, rates, quotes, newlines and pending flags', () => {
  const trip = { rates: { JPY: .05 }, records: [{ ...record(2000, 'JPY'), note: '寿司,"很好吃"\n第二行', pending: true }, { ...record(100), id: 2 }] };
  const imported = Travel.readCSV(Travel.buildCSV(trip));
  assert.equal(imported.skipped, 0);
  assert.equal(imported.records.length, 2);
  assert.equal(imported.records[0].note, trip.records[0].note);
  assert.equal(imported.records[0].pending, true);
  assert.equal(imported.records[0].currency, 'JPY');
  assert.equal(imported.records[1].currency, 'CNY');
  assert.deepEqual(plain(imported.rates), { JPY: .05 });
  assert.equal(Travel.totals({ records: imported.records, rates: imported.rates }).cny, 200);
});

test('old CSV defaults to CNY and new CSV preserves missing rates', () => {
  const old = Travel.readCSV('\uFEFF日期,类别,金额,备注,待确认\r\n2026-11-08,住宿,100,酒店,1\r\n');
  assert.equal(old.records[0].currency, 'CNY');
  assert.equal(old.records[0].pending, true);
  const trip = { records: [record(100, 'JPY')] };
  const result = Travel.readCSV(Travel.buildCSV(trip));
  assert.deepEqual(plain(result.rates), {});
  assert.equal(Travel.totals({ records: result.records }).complete, false);
  assert.notEqual(Travel.identity(record(100)), Travel.identity(record(100, 'JPY')));
});

test('CSV rejects conflicting or invalid rates and skips invalid amounts and currencies', () => {
  const header = '日期,类别,金额,币种,汇率（1原币兑人民币）\n';
  assert.throws(() => Travel.readCSV(header + '2026-11-08,餐饮,10,JPY,-1'), /汇率/);
  assert.throws(() => Travel.readCSV(header + '2026-11-08,餐饮,10,JPY,.05\n2026-11-09,餐饮,10,JPY,.06'), /统一汇率/);
  const invalid = Travel.readCSV(header + '2026-11-08,餐饮,-10,CNY,1\n2026-11-08,餐饮,10,INVALID,1');
  assert.equal(invalid.records.length, 0); assert.equal(invalid.skipped, 2);
  assert.throws(() => Travel.readCSV('日期,类别,金额\n2026-11-08,餐饮,"10'), /引号/);
});
