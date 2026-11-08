import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { default: worker, settleSubscriptions } = await import(new URL('../sync-worker/src/index.js', import.meta.url));
const Sub = globalThis.SpendexSubscriptions;
const KEY = 'test-only-subscription-sync-key-123456';
const WORKER_URL = 'https://spendex-sync.zechengyu90.workers.dev';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8000/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-background-networking', '--no-first-run'] });
function backend() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../sync-worker/schema.sql', import.meta.url), 'utf8'));
  return { SYNC_KEY: KEY, DB: { prepare(sql) {
    let args = [];
    return { bind(...values) { args = values; return this; },
      async first() { return db.prepare(sql).get(...args) || null; },
      async run() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; } };
  } } };
}
async function device(env, width) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
  await context.addInitScript(({ url, key }) => localStorage.setItem('spendex_sync_config_v1', JSON.stringify({ url, key })), { url: WORKER_URL, key: KEY });
  await context.route(WORKER_URL + '/**', async route => {
    const request = route.request();
    const response = await worker.fetch(new Request(request.url(), {
      method: request.method(), headers: request.headers(), ...(request.postData() ? { body: request.postData() } : {})
    }), env);
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(base);
  await synced(page);
  return { context, page, errors };
}
async function synced(page) {
  await page.waitForFunction(() => document.getElementById('cloud-sync-button').title.startsWith('已同步'));
}
async function requestSync(page) {
  await page.evaluate(() => CloudSync.sync());
  await synced(page);
}
try {
  for (const width of [320, 390, 1280]) {
    const env = backend();
    const a = await device(env, width), page = a.page;
    assert.equal(await page.locator('#amount').getAttribute('placeholder'), '0.00');
    assert.deepEqual(await page.evaluate(() => {
      const amount = getComputedStyle(document.getElementById('amount')), note = getComputedStyle(document.getElementById('note'));
      return [amount.fontSize, amount.fontWeight, amount.color, note.fontSize, note.fontWeight, note.color];
    }), ['16px', '400', 'rgb(29, 29, 31)', '16px', '400', 'rgb(29, 29, 31)']);
    await page.getByRole('button', { name: '订阅', exact: true }).click();
    await page.getByRole('button', { name: '＋ 添加订阅', exact: true }).click();
    await page.locator('#subscription-name').fill('云存储');
    await page.locator('#subscription-amount').fill('18');
    await page.locator('#subscription-day').fill('1');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await synced(page);
    await page.waitForFunction(() => getRecords().length === 1);
    const subscription = await page.evaluate(() => getSubscriptions()[0]);
    const bill = await page.evaluate(() => getRecords()[0]);
    assert.equal(bill.amount, 18); assert.equal(bill.pending, true); assert.equal(bill.subscriptionId, subscription.id);
    assert.match(await page.locator('.subscription-overview').innerText(), /18.00/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (width === 390) {
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: join(tmpdir(), 'spendex-subscriptions-mobile.png'), fullPage: true });
    }

    const b = await device(env, width);
    assert.equal(await b.page.evaluate(() => getSubscriptions().length), 1);
    assert.equal(await b.page.evaluate(() => getRecords().length), 1);
    await Promise.all([requestSync(page), requestSync(b.page), settleSubscriptions(env)]);
    assert.equal(await page.evaluate(() => getRecords().length), 1);
    await page.getByRole('button', { name: '明细', exact: true }).click();
    assert.equal(await page.locator('.summary-big.col-expense').innerText(), '¥0.00');

    // Correct the actual payment and confirm it; the source subscription stays 18.
    await page.evaluate(id => editRecord(id), bill.id);
    await page.locator('#amount').fill('17');
    await page.locator('#submit-btn').click();
    await synced(page);
    assert.equal(await page.evaluate(() => getRecords()[0].subscriptionId), subscription.id);
    await page.getByRole('button', { name: '明细', exact: true }).click();
    await page.getByRole('button', { name: '确认扣款', exact: true }).click();
    assert.equal(await page.locator('.summary-big.col-expense').innerText(), '¥17.00');
    await requestSync(page);
    await requestSync(b.page);
    assert.equal(await b.page.evaluate(() => getRecords()[0].pending), false);
    assert.equal(await b.page.evaluate(() => getRecords()[0].amount), 17);

    await page.getByRole('button', { name: '订阅', exact: true }).click();
    await page.getByRole('button', { name: '修改', exact: true }).click();
    await page.locator('#subscription-amount').fill('20');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await synced(page);
    assert.equal(await page.evaluate(() => getRecords()[0].amount), 17);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await synced(page);
    const nextPeriod = await page.evaluate(() => getSubscriptionStates()[0].nextMonth);
    const scheduledOn = Date.parse(Sub.dueDate(nextPeriod, 1) + 'T00:00:00Z');
    await worker.scheduled({ scheduledTime: scheduledOn }, env);
    await requestSync(page);
    assert.equal(await page.evaluate(() => getRecords().length), 1);
    await page.getByRole('button', { name: '恢复', exact: true }).click();
    await synced(page);
    await worker.scheduled({ scheduledTime: scheduledOn }, env);
    await requestSync(page);
    assert.equal(await page.evaluate(() => getRecords().length), 2);
    assert.equal(await page.evaluate(() => getRecords().find(item => item.pending).amount), 20);
    await page.getByRole('button', { name: '取消订阅', exact: true }).click();
    await synced(page);
    await worker.scheduled({ scheduledTime: Date.parse(Sub.dueDate(Sub.nextMonth(nextPeriod), 1) + 'T00:00:00Z') }, env);
    await requestSync(page); await requestSync(b.page);
    assert.equal(await b.page.evaluate(() => getSubscriptions()[0].status), 'cancelled');
    assert.equal(await b.page.evaluate(() => getRecords().length), 2);
    assert.match(await page.locator('.subscription-overview').innerText(), /0.00/);
    assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
    await a.context.close(); await b.context.close();
  }
  console.log('Subscription browser checks passed: add/edit, scheduled generation, two-device sync, confirmation, price history, pause/resume/cancel, no duplicates, mobile/desktop layouts and amount styling.');
} finally { await browser.close(); }
