(function (root) {
  'use strict';
  const validMonth = month => typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month >= '2000-01';
  const today = (now = Date.now()) => new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  function nextMonth(month) {
    const [year, number] = month.split('-').map(Number);
    return number === 12 ? (year + 1) + '-01' : year + '-' + String(number + 1).padStart(2, '0');
  }
  function dueDate(month, day) {
    const [year, number] = month.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate();
    return month + '-' + String(Math.min(day, lastDay)).padStart(2, '0');
  }
  function resumeMonth(subscription, date = today()) {
    const month = date.slice(0, 7);
    if (subscription.startMonth > month) return subscription.startMonth;
    return dueDate(month, subscription.day) < date ? nextMonth(month) : month;
  }
  function valid(subscription) {
    return !!subscription && Number.isSafeInteger(subscription.id) && subscription.id > 0 &&
      typeof subscription.name === 'string' && subscription.name.trim().length > 0 && subscription.name.length <= 80 &&
      Number.isFinite(subscription.amount) && subscription.amount > 0 && Number.isSafeInteger(Math.round(subscription.amount * 100)) && Math.round(subscription.amount * 100) > 0 &&
      typeof subscription.largeCat === 'string' && !!subscription.largeCat && typeof subscription.smallCat === 'string' && !!subscription.smallCat &&
      Number.isInteger(subscription.day) && subscription.day >= 1 && subscription.day <= 31 &&
      validMonth(subscription.startMonth) &&
      (subscription.nextMonth === undefined || validMonth(subscription.nextMonth) && subscription.nextMonth >= subscription.startMonth) &&
      ['active', 'paused', 'cancelled'].includes(subscription.status) &&
      (subscription.note === undefined || typeof subscription.note === 'string' && subscription.note.length <= 500);
  }
  const validState = value => !!value && Number.isSafeInteger(value.id) && value.id > 0 && validMonth(value.nextMonth);
  function billingMonth(subscription, state) {
    const start = subscription.nextMonth || subscription.startMonth;
    return validState(state) && state.nextMonth > start ? state.nextMonth : start;
  }
  function stamp(groups, now = Date.now()) {
    let clock = BigInt(now);
    for (const entries of groups) for (const entry of Object.values(entries)) {
      const time = BigInt(entry.stamp.split('-')[0]);
      if (time >= clock) clock = time + 1n;
    }
    return String(clock).padStart(16, '0') + '-' + crypto.randomUUID();
  }
  async function chargeId(id, month) {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('spendex-subscription:' + id + ':' + month)));
    // Reserved numeric range keeps old event handlers and exports compatible.
    let number = 0;
    for (const byte of hash.slice(0, 6)) number = number * 256 + byte;
    return 4000000000000000 + number;
  }
  async function generate(entries, date = today(), now = Date.now()) {
    const result = { ...entries };
    let version, changed = false, generated = 0;
    const write = (key, value) => { version ||= stamp([entries], now); result[key] = { value, stamp: version }; changed = true; };
    for (const [key, entry] of Object.entries(entries)) {
      if (!key.startsWith('subscription:') || !valid(entry.value) || entry.value.status !== 'active') continue;
      const subscription = entry.value;
      const stateKey = 'subscription-state:' + subscription.id;
      let month = billingMonth(subscription, entries[stateKey]?.value);
      const initial = month;
      // Catch up in bounded batches if the account has been unused for a long time.
      while (generated < 120 && dueDate(month, subscription.day) <= date) {
        const id = await chargeId(subscription.id, month), recordKey = 'record:' + id;
        if (!(recordKey in result)) {
          const chargedOn = dueDate(month, subscription.day);
          write(recordKey, { id, date: chargedOn, dateStr: chargedOn, type: '支出',
            largeCat: subscription.largeCat, smallCat: subscription.smallCat, amount: subscription.amount,
            note: subscription.name + ' · 订阅扣费' + (subscription.note ? ' · ' + subscription.note : ''),
            ignored: false, pending: true, subscriptionId: subscription.id, subscriptionMonth: month });
          generated++;
        } else if (result[recordKey].value?.subscriptionId !== undefined && result[recordKey].value.subscriptionId !== subscription.id) {
          throw new Error('Subscription charge ID collision');
        }
        // A tombstone counts as an issued charge: a deleted bill must not reappear.
        month = nextMonth(month);
      }
      // Keep server progress separate, so a newer cursor never overwrites a
      // person's concurrent price edit, pause or cancellation.
      if (month !== initial) write(stateKey, { id: subscription.id, nextMonth: month });
    }
    return { entries: result, changed, generated };
  }
  function preserveSettings(incoming, stored, now = Date.now()) {
    let result = incoming, version;
    // Older PWA versions tombstone unknown entry types. Cancelling a subscription
    // is explicit status metadata; legacy tombstones must not erase its schedule.
    for (const [key, entry] of Object.entries(stored)) {
      const settings = key.startsWith('subscription:') && valid(entry.value);
      const state = key.startsWith('subscription-state:') && validState(entry.value);
      if (!settings && !state) continue;
      if (settings && incoming[key]?.value) continue;
      if (state && JSON.stringify(incoming[key]?.value) === JSON.stringify(entry.value)) continue;
      if (result === incoming) result = { ...incoming };
      version ||= stamp([stored, incoming], now);
      result[key] = { value: entry.value, stamp: version };
    }
    return { entries: result, changed: result !== incoming };
  }
  root.SpendexSubscriptions = { validMonth, today, nextMonth, dueDate, resumeMonth, valid, validState, billingMonth, stamp, chargeId, generate, preserveSettings };
})(globalThis);
