(function (root) {
  'use strict';
  const currencies = [
    { code: 'CNY', name: '人民币', unit: 1 },
    { code: 'JPY', name: '日元', unit: 100 },
    { code: 'USD', name: '美元', unit: 1 },
    { code: 'SGD', name: '新加坡元', unit: 1 },
    { code: 'EUR', name: '欧元', unit: 1 },
    { code: 'GBP', name: '英镑', unit: 1 },
    { code: 'HKD', name: '港币', unit: 1 },
    { code: 'TWD', name: '新台币', unit: 1 },
    { code: 'KRW', name: '韩元', unit: 100 },
    { code: 'AUD', name: '澳元', unit: 1 },
    { code: 'THB', name: '泰铢', unit: 1 },
    { code: 'MYR', name: '马来西亚林吉特', unit: 1 }
  ];
  const currency = record => record.currency || 'CNY';
  const supported = code => currencies.some(item => item.code === code);
  const money = (amount, code = 'CNY') => code + ' ' + Number(amount).toLocaleString('zh-CN', { minimumFractionDigits: ['JPY', 'KRW'].includes(code) ? 0 : 2, maximumFractionDigits: 2 });
  const rate = (trip, code) => code === 'CNY' ? 1 : Number(trip.rates?.[code]);
  const validRate = value => Number.isFinite(value) && value > 0;
  const cents = amount => Math.round((amount + Number.EPSILON) * 100);
  function converted(trip, record) {
    const multiplier = rate(trip, currency(record));
    return validRate(multiplier) ? cents(record.amount * multiplier) / 100 : null;
  }
  function totals(trip) {
    const byCurrency = {}, missing = new Set();
    let totalCents = 0;
    for (const record of trip.records) {
      const code = currency(record);
      byCurrency[code] = (byCurrency[code] || 0) + record.amount;
      const value = converted(trip, record);
      if (value === null) missing.add(code);
      else totalCents += cents(value);
    }
    return { byCurrency, missing: [...missing].sort(), cny: totalCents / 100, complete: missing.size === 0 };
  }
  function parseCSV(text) {
    const rows = [], row = [];
    let value = '', quoted = false;
    text = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        if (quoted && text[i + 1] === '"') { value += '"'; i++; }
        else quoted = !quoted;
      } else if (char === ',' && !quoted) { row.push(value); value = ''; }
      else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && text[i + 1] === '\n') i++;
        row.push(value); rows.push(row.splice(0)); value = '';
      } else value += char;
    }
    if (quoted) throw new Error('CSV 引号不完整，请检查文件');
    if (value || row.length) { row.push(value); rows.push(row); }
    return rows.filter(cols => cols.some(cell => cell.trim()));
  }
  const csvCell = value => /[",\r\n]/.test(String(value)) ? '"' + String(value).replace(/"/g, '""') + '"' : String(value);
  function buildCSV(trip) {
    const rows = [['日期', '类别', '金额', '备注', '待确认', '币种', '汇率（1原币兑人民币）', '折合人民币']];
    for (const record of [...trip.records].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)) {
      const code = currency(record), multiplier = rate(trip, code), value = converted(trip, record);
      rows.push([record.date, record.category, record.amount, record.note || '', record.pending ? '1' : '', code,
        validRate(multiplier) ? multiplier : '', value === null ? '' : value.toFixed(2)]);
    }
    return rows.map(row => row.map(csvCell).join(',')).join('\n') + '\n';
  }
  function readCSV(text) {
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error('CSV 文件为空');
    const header = rows[0].map(cell => cell.trim());
    const index = name => header.indexOf(name);
    if (['日期', '类别', '金额'].some(name => index(name) < 0)) throw new Error('CSV 需要包含日期、类别和金额列');
    const records = [], rates = {};
    let skipped = 0;
    for (const row of rows.slice(1)) {
      const cell = name => (row[index(name)] || '').trim();
      const amount = Number(cell('金额')), code = cell('币种') || 'CNY';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cell('日期')) || !cell('类别') || !cell('金额') || !Number.isFinite(amount) || amount <= 0 || !supported(code)) { skipped++; continue; }
      const value = cell('汇率（1原币兑人民币）');
      if (code !== 'CNY' && value) {
        const multiplier = Number(value);
        if (!validRate(multiplier)) throw new Error(code + ' 的汇率必须大于 0');
        if (rates[code] !== undefined && rates[code] !== multiplier) throw new Error('同一行程的 ' + code + ' 需要使用统一汇率');
        rates[code] = multiplier;
      }
      records.push({ date: cell('日期'), category: cell('类别'), amount, note: row[index('备注')] || '', pending: cell('待确认') === '1', currency: code });
    }
    return { records, rates, skipped };
  }
  const identity = record => JSON.stringify([record.date, record.category, record.amount, currency(record), record.note || '', !!record.pending]);
  root.SpendexTravel = { currencies, currency, supported, money, rate, validRate, converted, totals, buildCSV, readCSV, identity };
})(globalThis);
