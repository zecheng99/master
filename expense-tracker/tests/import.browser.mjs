import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--disable-background-networking', '--no-first-run']
});
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8000/';
const header = '日期,类型,大类,小类,金额,备注,忽略,待确认';
try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    let acceptImport = true;
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.type() === 'confirm' && !acceptImport ? dialog.dismiss() : dialog.accept());
    await page.goto(base);
    await page.getByRole('button', { name: '明细', exact: true }).click();
    async function choose(text, name = 'Excel导出的账单.csv') {
      const waiting = page.waitForEvent('filechooser');
      await page.locator('.data-action-btn[onclick="importCSV()"]').click();
      const chooser = await waiting;
      await chooser.setFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(text) });
      await page.waitForFunction(() => {
        const status = document.getElementById('import-status');
        return !status.hidden && !status.textContent.startsWith('正在读取');
      });
    }
    const csv = '#设置,每周饮食预算,450\r\n' + header + '\r\n' +
      '2025/6/8,支出,B-食,饮食,20,午饭,0,1\r\n' +
      '2025/6/8,支出,B-食,饮食,20,晚饭,0,0\r\n' +
      '2025/6/9,支出,G-购物,购物,"1,234.50","备注,\"\"店名\"\"\n第二行",1,0\r\n';
    await choose(csv);
    let records = await page.evaluate(() => getRecords());
    assert.equal(records.length, 3);
    assert.equal(records[0].date, '2025-06-08');
    assert.equal(records[0].pending, true);
    assert.equal(records[2].amount, 1234.5);
    assert.equal(records[2].note, '备注,"店名"\n第二行');
    assert.equal(await page.locator('#month-label').innerText(), '2025-06');
    assert.match(await page.locator('#records-card').innerText(), /午饭/);
    assert.match(await page.locator('#import-status').innerText(), /已导入 3 条/);
    assert.equal(await page.evaluate(() => getFoodBudget()), 450);
    await choose(csv);
    assert.equal(await page.evaluate(() => getRecords().length), 3);
    assert.match(await page.locator('#import-status').innerText(), /已存在/);
    await choose('wrong,header\r\n1,2');
    assert.match(await page.locator('#import-status').innerText(), /必需列/);
    assert.equal(await page.evaluate(() => getRecords().length), 3);
    acceptImport = false;
    await choose('#设置,每周饮食预算,999\n' + header + '\n2025/6/10,支出,B-食,饮食,21,早餐');
    assert.match(await page.locator('#import-status').innerText(), /已取消/);
    assert.equal(await page.evaluate(() => getRecords().length), 3);
    assert.equal(await page.evaluate(() => getFoodBudget()), 450);
    acceptImport = true;
    await choose('not-a-csv', '账单.xlsx');
    assert.match(await page.locator('#import-status').innerText(), /CSV UTF-8/);
    // A failed file read must show an actionable message, not silently stop.
    await page.evaluate(() => File.prototype.arrayBuffer = () => Promise.reject(new Error('文件读取失败')));
    await choose(csv);
    assert.match(await page.locator('#import-status').innerText(), /恢复失败.*文件读取失败/);
    assert.equal(await page.evaluate(() => getRecords().length), 3);
    assert.equal(await page.locator('input[type="file"]').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Import browser checks passed: native file chooser, Excel CSV dates, quoted fields, visible history, repeat restore, cancellation, workbook rejection, read errors, and mobile/desktop layouts.');
} finally { await browser.close(); }
