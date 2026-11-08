(function (root) {
  'use strict';
  function rows(text, delimiter = ',') {
    const result = [], row = [];
    let cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = !quoted;
      } else if (char === delimiter && !quoted) { row.push(cell); cell = ''; }
      else if ((char === '\r' || char === '\n') && !quoted) {
        if (char === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); result.push(row.splice(0)); cell = '';
      } else cell += char;
    }
    if (quoted) throw new Error('CSV 的引号没有闭合，请在 Excel 中重新另存为 CSV UTF-8');
    if (cell || row.length) { row.push(cell); result.push(row); }
    return result.filter(row => row.some(cell => cell.trim()));
  }
  function delimiter(line) {
    return [',', ';', '\t'].map(value => [value, rows(line, value)[0]?.length || 0]).sort((a, b) => b[1] - a[1])[0][0];
  }
  function date(value) {
    const text = String(value ?? '').trim().replace(/^'/, '');
    let parts = text.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/);
    if (!parts && /^\d{2,7}(\.\d+)?$/.test(text)) {
      const serial = Number(text);
      if (serial >= 61 && serial < 2958466) return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000).toISOString().slice(0, 10);
    }
    if (!parts) return null;
    const [year, month, day] = parts.slice(1).map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (year < 1900 || year > 9999 || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  function normalizeRecords(records) {
    if (!Array.isArray(records)) return [];
    return records.map(record => {
      const normalized = date(record.date || record.dateStr);
      return normalized && (record.date !== normalized || record.dateStr !== normalized)
        ? { ...record, date: normalized, dateStr: normalized } : record;
    });
  }
  function decode(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { return new TextDecoder('gb18030', { fatal: true }).decode(bytes); }
  }
  function parse(text) {
    text = String(text).replace(/^\uFEFF/, '');
    let separator;
    const settings = [];
    // Consume only leading metadata, so quoted notes can contain arbitrary newlines.
    while (text.length) {
      const match = text.match(/^([^\r\n]*)(?:\r\n|\r|\n|$)/);
      const line = match[1].trim();
      if (/^sep=[,;\t]$/i.test(line)) separator = line.slice(4);
      else if (line.startsWith('#')) settings.push(...rows(line, delimiter(line)));
      else if (line) break;
      text = text.slice(match[0].length);
    }
    if (!text.trim()) throw new Error('CSV 文件为空，或只包含设置而没有账单表头');
    const firstLine = text.split(/\r\n|\r|\n/, 1)[0];
    const data = rows(text, separator || delimiter(firstLine));
    if (!data.length) throw new Error('CSV 文件没有可识别的表头或账单数据');
    const header = data.shift().map(cell => cell.trim());
    const aliases = {
      日期: ['日期', '记账日期', '交易日期', '时间'], 类型: ['类型', '收支类型', '收支'],
      大类: ['大类', '大分类', '一级分类'], 小类: ['小类', '小分类', '二级分类', '子分类'],
      金额: ['金额', '金额(元)', '金额（元）'], 备注: ['备注', '说明'], 忽略: ['忽略'], 待确认: ['待确认']
    };
    const index = name => header.findIndex(value => aliases[name].includes(value));
    const missing = ['日期', '大类', '小类', '金额'].filter(name => index(name) < 0);
    if (missing.length) {
      if (header.includes('类别') && header.includes('币种')) throw new Error('这是旅行账单 CSV，请在对应行程里选择「导入 CSV」');
      throw new Error('未识别到必需列：' + missing.join('、') + '。请使用表头：日期、类型、大类、小类、金额、备注（顺序可以调整）');
    }
    const records = [], skipped = [];
    const flag = value => ['1', 'true', 'yes', '是'].includes(value.toLowerCase());
    for (let i = 0; i < data.length; i++) {
      const row = data[i], cell = name => (row[index(name)] || '').trim();
      const normalized = date(cell('日期'));
      const amountText = cell('金额').replace(/^[¥￥]\s*/, '').replace(/[,\s\u00a0]/g, '');
      const amount = Number(amountText);
      let error;
      if (row.length > header.length) error = '列数与表头不一致（备注或千分位中的逗号需要用引号包裹）';
      else if (!normalized) error = '日期无法识别，请使用 YYYY-MM-DD，例如 2026-11-08';
      else if (!amountText || !Number.isFinite(amount) || amount < 0) error = '金额不是有效的非负数字';
      else if (!cell('大类') || !cell('小类')) error = '大类或小类为空';
      if (error) { skipped.push({ row: i + 2, reason: error }); continue; }
      records.push({ date: normalized, dateStr: normalized, type: cell('类型') || (cell('大类') === '收入' ? '收入' : '支出'),
        largeCat: cell('大类'), smallCat: cell('小类'), amount, note: row[index('备注')] || '',
        ignored: flag(cell('忽略')), pending: flag(cell('待确认')) });
    }
    return { records, settings, skipped };
  }
  const identity = record => JSON.stringify([date(record.date || record.dateStr) || record.date,
    record.type || '支出', record.largeCat, record.smallCat, record.amount, record.note || '', !!record.ignored, !!record.pending]);
  function additions(existing, incoming) {
    // Preserve two identical genuine transactions, while repeated restores remain idempotent.
    const counts = new Map();
    for (const record of existing) { const key = identity(record); counts.set(key, (counts.get(key) || 0) + 1); }
    return incoming.filter(record => {
      const key = identity(record), count = counts.get(key) || 0;
      if (!count) return true;
      counts.set(key, count - 1); return false;
    });
  }
  const quote = value => /[",\r\n]/.test(String(value)) ? '"' + String(value).replace(/"/g, '""') + '"' : String(value);
  function build(records, budget) {
    const data = [['#设置', '每周饮食预算', budget], ['日期', '类型', '大类', '小类', '金额', '备注', '忽略', '待确认']];
    for (const record of normalizeRecords([...records]).sort((a, b) => a.id - b.id)) {
      data.push([record.date, record.type || '支出', record.largeCat, record.smallCat, record.amount, record.note || '', record.ignored ? '1' : '', record.pending ? '1' : '']);
    }
    return data.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
  }
  root.SpendexCSV = { rows, date, decode, normalizeRecords, parse, additions, build };
})(globalThis);
