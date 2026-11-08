import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const DEFAULT_URL = 'https://spendex-sync.zechengyu90.workers.dev';
const CONFIG = 'spendex_sync_config_v1';
const KEY = 'test-only-sync-key-for-browser-checks';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--disable-background-networking', '--no-first-run']
});
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8000/';

async function setup({ url = DEFAULT_URL, saved = null, width = 390 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
  const calls = [], errors = [];
  // Intercept the entire Worker host so tests cannot contact the live ledger.
  await context.route(new URL(url).origin + '/**', async route => {
    const request = route.request();
    calls.push({ url: request.url(), authorization: request.headers().authorization });
    const allowed = request.headers().authorization === 'Bearer ' + KEY;
    await route.fulfill({
      status: allowed ? 200 : 401,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': new URL(base).origin },
      body: JSON.stringify(allowed ? { revision: 0, entries: {} } : { error: 'Unauthorized' })
    });
  });
  if (saved) {
    await context.addInitScript(({ config, name }) => {
      if (!localStorage.getItem(name)) localStorage.setItem(name, JSON.stringify(config));
    }, { config: saved, name: CONFIG });
  }
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install();
  await page.goto(base);
  return { context, page, calls, errors };
}

try {
  for (const width of [390, 1280]) {
    const { context, page, calls, errors } = await setup({ width });
    await page.clock.fastForward(65000);
    assert.equal(calls.length, 0, 'New device must remain offline from sync until a key is saved');
    await page.getByRole('button', { name: '☁ 云同步', exact: true }).click();
    assert.equal(await page.locator('#sync-url').count(), 0);
    assert.equal(await page.locator('#sync-modal input').count(), 1);
    await page.locator('#sync-key').fill('short');
    await page.locator('#sync-save').click();
    assert.match(await page.locator('#sync-status').innerText(), /至少 24 位/);
    assert.equal(calls.length, 0);
    await page.locator('#sync-key').fill(KEY);
    await page.locator('#sync-save').click();
    await page.waitForFunction(() => document.getElementById('sync-status').textContent.startsWith('已同步'));
    assert.equal(calls[0].url, DEFAULT_URL + '/sync');
    const saved = await page.evaluate(name => JSON.parse(localStorage.getItem(name)), CONFIG);
    assert.deepEqual(saved, { url: DEFAULT_URL, key: KEY });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    // Legacy-shaped config created above must resume automatically after reload.
    await page.reload();
    await page.waitForFunction(() => document.getElementById('cloud-sync-button').title.startsWith('已同步'));
    await page.getByRole('button', { name: '☁ 云同步', exact: true }).click();
    assert.equal(await page.locator('#sync-key').inputValue(), KEY);
    await page.locator('#sync-disconnect').click();
    const requestsAtDisconnect = calls.length;
    await page.evaluate(() => {
      saveRecords([{ id: 123, date: '2026-11-08', largeCat: 'B-食', smallCat: '饮食', amount: 10 }]);
      window.dispatchEvent(new Event('online'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.fastForward(65000);
    assert.equal(calls.length, requestsAtDisconnect, 'Disconnect must stop sync, including edit and interval triggers');
    assert.match(await page.locator('#sync-status').innerText(), /已断开/);
    assert.equal(await page.evaluate(name => localStorage.getItem(name), CONFIG), null);
    await page.reload();
    await page.clock.fastForward(65000);
    assert.equal(calls.length, requestsAtDisconnect, 'Disconnect must persist across reloads');
    assert.equal(await page.evaluate(() => getRecords().length), 1);
    assert.deepEqual(errors, []);
    await context.close();
  }

  const legacyURL = 'https://legacy-sync.example';
  const { context, page, calls, errors } = await setup({ url: legacyURL, saved: { url: legacyURL, key: KEY } });
  await page.waitForFunction(() => document.getElementById('cloud-sync-button').title.startsWith('已同步'));
  assert.equal(calls[0].url, legacyURL + '/sync');
  await page.getByRole('button', { name: '☁ 云同步', exact: true }).click();
  assert.equal(await page.locator('#sync-key').inputValue(), KEY);
  await page.locator('#sync-save').click();
  await page.waitForFunction(() => document.getElementById('sync-status').textContent.startsWith('已同步'));
  assert.equal(await page.evaluate(name => JSON.parse(localStorage.getItem(name)).url, CONFIG), legacyURL);
  assert.deepEqual(errors, []);
  await context.close();
  console.log('Sync browser checks passed: one-field setup, default endpoint, key validation, existing configs, disconnected reloads, and mobile/desktop layouts.');
} finally {
  await browser.close();
}
