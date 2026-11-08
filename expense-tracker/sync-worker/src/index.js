const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED_ORIGINS = ['https://shelvee11.github.io', 'http://localhost:8000', 'http://127.0.0.1:8000'];

export function validEntries(entries) {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return false;
  return Object.entries(entries).every(([key, entry]) => {
    if (!/^(budget|record:\d+|trip:\d+|travel:\d+:\d+)$/.test(key) || !entry ||
        typeof entry.stamp !== 'string' || !/^\d{16}-(seed|[a-f0-9-]{36})$/.test(entry.stamp)) return false;
    const value = entry.value;
    if (value === null) return true;
    if (key === 'budget') return Number.isFinite(value) && value > 0;
    if (!value || !Number.isSafeInteger(value.id) || value.id <= 0 || String(value.id) !== key.split(':').at(-1)) return false;
    if (key.startsWith('trip:')) return typeof value.name === 'string' && ['active', 'archived'].includes(value.status) && !('records' in value);
    return typeof value.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date) && Number.isFinite(value.amount) && value.amount >= 0 &&
      (key.startsWith('record:') ? typeof value.largeCat === 'string' && typeof value.smallCat === 'string' : typeof value.category === 'string');
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || ALLOWED_ORIGINS.join(',')).split(',').map(s => s.trim());
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin' };
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
    if (origin && !allowed.includes(origin)) return reply({ error: 'Origin not allowed' }, 403);
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, PUT, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
    if (new URL(request.url).pathname !== '/sync') return reply({ error: 'Not found' }, 404);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (!env.SYNC_KEY || env.SYNC_KEY.length < 24) return reply({ error: 'Service not configured' }, 503);
    // Compare digests to avoid leaking key prefixes through timing.
    const hash = text => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    const [expected, actual] = await Promise.all([hash('Bearer ' + env.SYNC_KEY), hash(request.headers.get('Authorization') || '')]);
    const a = new Uint8Array(expected), b = new Uint8Array(actual);
    let different = 0;
    for (let i = 0; i < a.length; i++) different |= a[i] ^ b[i];
    if (different) return reply({ error: 'Unauthorized' }, 401);
    try {
      if (request.method === 'GET') {
        const row = await env.DB.prepare('SELECT revision, entries FROM sync_state WHERE id = 1').first();
        return reply(row ? { revision: row.revision, entries: JSON.parse(row.entries) } : { revision: 0, entries: {} });
      }
      if (request.method !== 'PUT') return reply({ error: 'Method not allowed' }, 405);
      if (Number(request.headers.get('Content-Length')) > MAX_BYTES) return reply({ error: 'Data too large' }, 413);
      let size = 0;
      const chunks = [];
      for await (const chunk of request.body || []) {
        size += chunk.byteLength;
        if (size > MAX_BYTES) return reply({ error: 'Data too large' }, 413);
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(await new Blob(chunks).text()); } catch { return reply({ error: 'Invalid JSON' }, 400); }
      if (!Number.isSafeInteger(body.revision) || body.revision < 0 || !validEntries(body.entries)) return reply({ error: 'Invalid data' }, 400);
      // A single conditional SQL write makes updates atomic across devices.
      const statement = body.revision === 0
        ? env.DB.prepare('INSERT OR IGNORE INTO sync_state (id, revision, entries) VALUES (1, 1, ?)').bind(JSON.stringify(body.entries))
        : env.DB.prepare('UPDATE sync_state SET revision = revision + 1, entries = ? WHERE id = 1 AND revision = ?').bind(JSON.stringify(body.entries), body.revision);
      const result = await statement.run();
      if (!result.meta.changes) return reply({ error: 'Revision conflict' }, 409);
      return reply({ revision: body.revision + 1 });
    } catch {
      return reply({ error: 'Storage unavailable' }, 503);
    }
  }
};
