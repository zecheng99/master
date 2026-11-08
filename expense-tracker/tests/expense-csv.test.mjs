import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({ TextDecoder });
vm.runInContext(readFileSync(new URL('../expense-csv.js', import.meta.url), 'utf8'), context);
const CSV = context.SpendexCSV;
const header = '日期,类型,大类,小类,金额,备注,忽略,待确认';
const plain = value => JSON.parse(JSON.stringify(value));

test('Excel dates normalize to calendar dates without timezone shifts', () => {
  for (const value of ['2026/11/8', '2026-11-8', '2026年11月8日', '2026.11.08', '2026/11/8 12:30:00', '2026-11-08T00:00:00Z']) assert.equal(CSV.date(value), '2026-11-08');
  assert.equal(CSV.date('25569.5'), '1970-01-01');
  assert.equal(CSV.date('2026/2/30'), null);
  assert.equal(CSV.date('11/8/2026'), null, 'Ambiguous month/day dates require explicit formatting');
});

test('Excel CRLF, quoted amounts and multiline notes import with flags intact', () => {
  const result = CSV.parse('\uFEFF' + header + '\r\n2026/11/8,支出,B-食,饮食,"1,234.50","午饭,\"\"很好\"\"\n第二行",1,1\r\n');
  assert.equal(result.records.length, 1);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.records[0].date, '2026-11-08');
  assert.equal(result.records[0].amount, 1234.5);
  assert.equal(result.records[0].note, '午饭,"很好"\n第二行');
  assert.equal(result.records[0].ignored, true); assert.equal(result.records[0].pending, true);
});

test('semicolon, tab and reordered columns are recognized; optional trailing cells may be omitted', () => {
  for (const separator of [';', '\t']) {
    const text = ['金额', '备注', '日期', '小类', '大类'].join(separator) + '\r\n' + ['20', '午饭', '2026/11/8', '饮食', 'B-食'].join(separator);
    const result = CSV.parse(text);
    assert.equal(result.records[0].amount, 20); assert.equal(result.records[0].type, '支出');
  }
  assert.equal(CSV.parse('sep=;\r\n' + header.replaceAll(',', ';') + '\r\n2026/11/8;支出;B-食;饮食;20').records.length, 1);
});

test('invalid rows report reasons while malformed headers and quoting fail explicitly', () => {
  const result = CSV.parse(header + '\n2026/2/30,支出,B-食,饮食,20\n2026/11/8,支出,B-食,饮食,not-money\n2026/11/8,支出,B-食,饮食,20');
  assert.equal(result.records.length, 1); assert.equal(result.skipped.length, 2);
  assert.match(result.skipped[0].reason, /日期/); assert.match(result.skipped[1].reason, /金额/);
  assert.throws(() => CSV.parse('wrong,header\n1,2'), /必需列/);
  assert.throws(() => CSV.parse('日期,类别,金额,币种\n2026-11-08,餐饮,100,JPY'), /旅行账单/);
  assert.throws(() => CSV.parse(header + '\n2026-11-08,支出,B-食,饮食,20,"note'), /引号/);
  assert.throws(() => CSV.parse('#设置,每周饮食预算,400\n'), /表头/);
  assert.throws(() => CSV.parse(',,,\n,,,\n'), /表头/);
});

test('UTF-8, UTF-16 and Windows GBK decode without mangling Chinese headers', () => {
  assert.equal(CSV.decode(new TextEncoder().encode('日期')), '日期');
  assert.equal(CSV.decode(Uint8Array.from([0xff, 0xfe, 0xe5, 0x65, 0x1f, 0x67])), '日期');
  assert.equal(CSV.decode(Uint8Array.from([0xfe, 0xff, 0x65, 0xe5, 0x67, 0x1f])), '日期');
  assert.equal(CSV.decode(Uint8Array.from([0xc8, 0xd5, 0xc6, 0xda])), '日期');
});

test('export preserves original notes, settings and booleans and does not reorder input', () => {
  const record = { id: 2, date: '2026/11/8', dateStr: '2026/11/8', type: '支出', largeCat: 'B-食', smallCat: '饮食', amount: 20, note: '午饭,"店名"\n第二行', ignored: true, pending: true };
  const records = [record, { ...record, id: 1, amount: 10 }];
  const result = CSV.parse(CSV.build(records, 400));
  assert.equal(records[0].id, 2);
  assert.equal(result.records[1].note, record.note);
  assert.equal(result.records[1].date, '2026-11-08');
  assert.equal(result.records[1].ignored, true); assert.equal(result.records[1].pending, true);
  assert.deepEqual(plain(result.settings), [['#设置', '每周饮食预算', '400']]);
});

test('repeat import preserves genuine duplicate counts and distinct notes', () => {
  const record = CSV.parse(header + '\n2026/11/8,支出,B-食,饮食,20,午饭').records[0];
  assert.equal(CSV.additions([], [record, record]).length, 2);
  assert.equal(CSV.additions([record, record], [record, record]).length, 0);
  assert.equal(CSV.additions([record], [record, record]).length, 1);
  assert.equal(CSV.additions([record], [{ ...record, note: '晚饭' }]).length, 1);
  const existing = [{ ...record, id: 123, date: '2026/11/8', dateStr: '2026/11/8' }];
  assert.equal(CSV.additions(existing, [record]).length, 0);
  assert.equal(CSV.normalizeRecords(existing)[0].id, 123);
  assert.equal(CSV.normalizeRecords(existing)[0].date, '2026-11-08');
});
