/* 跡 同步服务 —— Cloudflare Worker + D1
 *
 * 结构照搬 aside/sync-worker，只有一个接口 POST /sync，一次往返同时干两件事：
 * 把本地改动推上来、把别的设备的改动带回去。手机记一条到电脑看见只需一个 RTT。
 *
 *   请求 { since, sessions: [{id, data, deleted}], settings }
 *   响应 { now, sessions: [...], settings, truncated }
 *
 * since 传上次响应里的 now（一律用服务器时间，客户端时钟不可信，手机时区一改
 * 就会漏数据）。服务端只回 updated > since 的行，所以除第一次外，流量只跟
 * 「改了几条」有关，跟总条数无关。
 *
 * 进行中的计时（activeTimer）不走这里：它每次暂停/继续都在变，而两台设备的
 * 同一段计时谁赢都可能吞掉一段正在计的时间。留在本机，停表存成 session 之后再同步。
 */

// GitHub Pages 正式域 + 本地调试。其它来源一律回落到正式域，等于拒绝跨域读取。
const ALLOWED_ORIGINS = [
  'https://zecheng99.github.io',
  'https://shelvee11.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
];

const MAX_BATCH = 50;    // D1 单次 batch 的语句数上限，太大容易超时
const PULL_LIMIT = 5000; // 一次最多回多少行

function cors(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

// 常数时间比较：密钥是这套东西唯一的门，别让它能被逐字符试出来
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(req, env) {
    const headers = cors(req.headers.get('Origin') || '');
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (url.pathname === '/health') return json({ ok: true }, 200, headers);
    if (url.pathname !== '/sync') return json({ error: 'not found' }, 404, headers);
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, headers);

    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!env.SYNC_KEY || !safeEqual(token, env.SYNC_KEY)) {
      return json({ error: 'unauthorized' }, 401, headers);
    }

    let body;
    try { body = await req.json(); }
    catch { return json({ error: 'bad json' }, 400, headers); }

    const since = Number(body.since) || 0;
    const incoming = Array.isArray(body.sessions) ? body.sessions : [];
    const now = Date.now();

    /* ── 推：按 id upsert。墓碑只留 id，data 清空 ── */
    const stmts = [];
    for (const r of incoming) {
      if (!r || typeof r.id !== 'string' || !r.id) continue;
      stmts.push(
        env.DB.prepare(
          `INSERT INTO sessions (id, data, updated, deleted) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(id) DO UPDATE SET
             data = excluded.data, updated = excluded.updated, deleted = excluded.deleted
           WHERE sessions.deleted = 0 OR excluded.deleted = 1`
        ).bind(r.id, r.deleted ? '' : String(r.data || ''), now, r.deleted ? 1 : 0)
      );
    }
    /* settingsSeed = 这台设备还没同步过，带上来的很可能只是一份没人动过的默认值。
       第一次同步一律 DO NOTHING：云端没有就拿它开个头，已经有了就一个字都别覆盖——
       否则新设备一上来就把别处设好的目标冲成默认的 30 分钟 / 6 天。 */
    const seedOnly = !!body.settingsSeed;
    if (typeof body.settings === 'string' && body.settings) {
      stmts.push(
        seedOnly
          ? env.DB.prepare(
              `INSERT INTO meta (k, v, updated) VALUES ('settings', ?1, ?2)
               ON CONFLICT(k) DO NOTHING`
            ).bind(body.settings, now)
          : env.DB.prepare(
              `INSERT INTO meta (k, v, updated) VALUES ('settings', ?1, ?2)
               ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated = excluded.updated`
            ).bind(body.settings, now)
      );
    }
    for (let i = 0; i < stmts.length; i += MAX_BATCH) {
      await env.DB.batch(stmts.slice(i, i + MAX_BATCH));
    }

    /* ── 拉：只回这台设备没见过的改动 ── */
    const { results } = await env.DB.prepare(
      `SELECT id, data, updated, deleted FROM sessions
       WHERE updated > ?1 ORDER BY updated LIMIT ?2`
    ).bind(since, PULL_LIMIT).all();

    // An offline device can upload an old copy after it was deleted elsewhere.
    // Keep tombstones final and send them even when they predate that device's cursor.
    const removed = [];
    const liveIds = [...new Set(incoming.filter(r => r && !r.deleted && typeof r.id === 'string' && r.id).map(r => r.id))];
    for (let i = 0; i < liveIds.length; i += MAX_BATCH) {
      const ids = liveIds.slice(i, i + MAX_BATCH);
      const found = await env.DB.prepare(
        `SELECT id, data, updated, deleted FROM sessions WHERE deleted = 1 AND id IN (${ids.map(() => '?').join(',')})`
      ).bind(...ids).all();
      removed.push(...(found.results || []));
    }
    const rows = [...new Map([...(results || []), ...removed].map(row => [row.id, row])).values()];

    // 刚推上来的那几条会因为 updated = now 落进上面的结果里。过滤掉不是省流量而已：
    // 它们的内容就是客户端自己刚发的，原样回传没有意义。别的设备在 since~now 之间
    // 改过同一条的话，那份也已经被本次 upsert 覆盖了，本来就不该回传。
    const pushed = new Set(incoming.map(r => r && r.id).filter(Boolean));

    /* 同理，自己刚推的 settings 不回传：别的设备在 since~now 之间改过的话，那份
       也已经被本次 upsert 覆盖了（整行最后写入的赢），本来就不该回传。
       种子请求是例外——它的写入可能被 DO NOTHING 挡掉了，必须把真正生效的那份带回去。 */
    const pushedSettings = typeof body.settings === 'string' && !!body.settings;
    const setRow = seedOnly
      ? await env.DB.prepare(`SELECT v FROM meta WHERE k = 'settings'`).first()
      : pushedSettings ? null : await env.DB.prepare(
          `SELECT v FROM meta WHERE k = 'settings' AND updated > ?1`
        ).bind(since).first();

    return json({
      now,
      sessions: rows
        .filter(r => r.deleted || !pushed.has(r.id))
        .map(r => ({ id: r.id, data: r.data, deleted: r.deleted ? 1 : 0 })),
      settings: setRow ? setRow.v : null,
      // 顶到 LIMIT 说明这批没拉完，客户端要立刻再同步一次，否则会静默漏数据
      truncated: (results || []).length >= PULL_LIMIT,
    }, 200, headers);
  },
};
