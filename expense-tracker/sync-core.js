/* Shared, deterministic merge rules. Deleted entries remain as tombstones. */
(function (root) {
  const merge = (a, b) => {
    const result = { ...a };
    for (const [key, entry] of Object.entries(b)) {
      if (!result[key] || entry.stamp > result[key].stamp ||
          (entry.stamp === result[key].stamp && JSON.stringify(entry) > JSON.stringify(result[key]))) result[key] = entry;
    }
    return result;
  };
  function flatten(records, trips, budget) {
    const items = {};
    for (const record of records) items['record:' + record.id] = record;
    for (const trip of trips) {
      const { records: expenses, ...info } = trip;
      items['trip:' + trip.id] = info;
      for (const record of expenses) items['travel:' + trip.id + ':' + record.id] = record;
    }
    if (budget !== null) items.budget = Number(budget);
    return items;
  }
  function materialize(entries) {
    const records = [], trips = [];
    for (const [key, entry] of Object.entries(entries)) {
      if (entry.value === null) continue;
      if (key.startsWith('record:')) records.push(entry.value);
      if (key.startsWith('trip:')) trips.push({ ...entry.value, records: [] });
    }
    for (const trip of trips) {
      for (const [key, entry] of Object.entries(entries)) {
        if (key.startsWith('travel:' + trip.id + ':') && entry.value !== null) trip.records.push(entry.value);
      }
      trip.records.sort((a, b) => a.id - b.id);
    }
    return { records: records.sort((a, b) => a.id - b.id), trips: trips.sort((a, b) => a.id - b.id), budget: entries.budget?.value ?? null };
  }
  root.SpendexSyncCore = { merge, flatten, materialize };
})(globalThis);
