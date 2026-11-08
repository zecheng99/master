(function () {
  'use strict';
  const { merge, flatten, materialize } = SpendexSyncCore;
  const DEFAULT_SYNC_URL = 'https://spendex-sync.zechengyu90.workers.dev';
  const STATE = 'spendex_sync_entries_v1', CONFIG = 'spendex_sync_config_v1';
  let timer, running = false, rerun = false, generation = 0;
  let status = '未开启云同步';
  const read = (key, fallback) => JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  const entries = () => read(STATE, {});
  const config = () => {
    const saved = read(CONFIG, {});
    return { ...saved, url: saved.url || DEFAULT_SYNC_URL };
  };
  const current = () => flatten(getRecords(), getTrips(), localStorage.getItem('weekly_food_budget'), read('expense_subscriptions', []));
  const saveEntries = value => localStorage.setItem(STATE, JSON.stringify(value));
  function stamp(all) {
    const previous = Object.values(all).reduce((n, e) => Math.max(n, Number(e.stamp.split('-')[0])), 0);
    return String(Math.max(Date.now(), previous + 1)).padStart(16, '0') + '-' + crypto.randomUUID();
  }
  function capture(seed = false) {
    const all = entries(), data = current();
    const version = stamp(all);
    for (const key of new Set([...Object.keys(all), ...Object.keys(data)])) {
      if (key.startsWith('subscription-state:')) continue; // Server-owned scheduling cursor.
      const value = data[key] ?? null;
      if (JSON.stringify(all[key]?.value ?? null) !== JSON.stringify(value)) {
        // Initial data on a newly connected device only seeds missing cloud entries.
        all[key] = { value, stamp: seed ? '0000000000000000-seed' : version };
      }
    }
    saveEntries(all);
  }
  function setStatus(message) {
    status = message;
    const el = document.getElementById('sync-status');
    if (el) el.textContent = message;
    document.getElementById('cloud-sync-button').title = message;
  }
  function changed() {
    capture();
    if (config().key) {
      setStatus(navigator.onLine ? '有修改，等待同步' : '离线，联网后自动同步');
      clearTimeout(timer);
      timer = setTimeout(sync, 1200);
    }
  }
  function apply(all) {
    const data = materialize(all);
    // Save the merge before updating the legacy storage views.
    saveEntries(all);
    localStorage.setItem('expense_records', JSON.stringify(data.records));
    localStorage.setItem('travel_trips', JSON.stringify(data.trips));
    localStorage.setItem('expense_subscriptions', JSON.stringify(data.subscriptions));
    localStorage.setItem('expense_subscription_states', JSON.stringify(data.subscriptionStates));
    if (data.budget !== null) localStorage.setItem('weekly_food_budget', data.budget);
    if (document.getElementById('history-panel').classList.contains('active')) renderHistory();
    const travel = document.getElementById('travel-panel');
    if (travel.classList.contains('active') && !document.querySelector('.modal-overlay')) {
      // Preserve the current trip's unfinished form while updating synced totals.
      refreshTravelAfterSync();
    }
    if (document.getElementById('subscription-panel')?.classList.contains('active') && !document.querySelector('.modal-overlay')) renderSubscriptions();
  }
  async function request(url, key, options = {}) {
    const response = await fetch(url + '/sync', {
      ...options, cache: 'no-store', signal: AbortSignal.timeout(20000),
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' }
    });
    if (response.status === 401) throw new Error('同步密钥不正确');
    if (response.status === 409) return null;
    if (!response.ok) throw new Error('服务器错误（' + response.status + '）');
    return response.json();
  }
  async function sync() {
    const cfg = config(), runGeneration = generation;
    if (!cfg.url || !cfg.key) return;
    if (running) { rerun = true; return; }
    if (!navigator.onLine) { setStatus('离线，联网后自动同步'); return; }
    running = true;
    clearTimeout(timer);
    setStatus('正在同步…');
    try {
      capture();
      for (let attempt = 0; attempt < 5; attempt++) {
        const remote = await request(cfg.url, cfg.key);
        if (runGeneration !== generation) return;
        let combined = merge(remote.entries, entries());
        if (JSON.stringify(combined) !== JSON.stringify(remote.entries)) {
          const result = await request(cfg.url, cfg.key, {
            method: 'PUT', body: JSON.stringify({ revision: remote.revision, entries: combined })
          });
          if (runGeneration !== generation) return;
          if (!result) continue; // Another device committed first: pull and merge again.
          if (result.entries) combined = merge(combined, result.entries);
        }
        const latest = entries();
        apply(merge(combined, latest));
        if (JSON.stringify(merge(combined, latest)) !== JSON.stringify(combined)) rerun = true;
        setStatus('已同步 · ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
        return;
      }
      throw new Error('其他设备正在更新，稍后自动重试');
    } catch (error) {
      if (runGeneration === generation) setStatus('同步失败：' + (error instanceof TypeError ? '无法连接云端，稍后自动重试' : error.message));
    } finally {
      running = false;
      if (rerun) { rerun = false; timer = setTimeout(sync, 1200); }
    }
  }
  function open() {
    if (document.getElementById('sync-modal')) return;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay'; overlay.id = 'sync-modal';
    overlay.innerHTML = `<div class="modal-box sync-box">
      <h3>Cloudflare 云同步</h3>
      <p>云端地址已配置。电脑和手机填写相同的同步密钥即可连接。账单、旅行、订阅和每周预算会自动同步，离线也能记账。</p>
      <label for="sync-key">同步密钥</label><input id="sync-key" type="password" placeholder="部署时设置的密钥" autocomplete="off">
      <p>此处填写专用同步密钥，不是 Cloudflare 密码或 API Token。首次连接会合并已有记录；同一笔记录的冲突使用最后修改版本。</p>
      <p id="sync-status" role="status" aria-live="polite"></p>
      <div class="modal-btns"><button class="modal-cancel" id="sync-close">关闭</button><button class="modal-confirm" id="sync-save">保存并同步</button></div>
      <button class="sync-disconnect" id="sync-disconnect">断开云同步</button>
    </div>`;
    document.body.appendChild(overlay);
    document.getElementById('sync-key').value = config().key || '';
    setStatus(status);
    document.getElementById('sync-close').onclick = () => overlay.remove();
    document.getElementById('sync-save').onclick = () => {
      try {
        const key = document.getElementById('sync-key').value.trim();
        if (key.length < 24 || !/^[\x21-\x7e]+$/.test(key)) throw new Error('同步密钥须为至少 24 位的英文、数字或符号');
        const old = config();
        if (old.key && old.key !== key && !confirm('更换同步密钥后将使用新密钥连接云端，继续？')) return;
        generation++;
        localStorage.setItem(CONFIG, JSON.stringify({ url: old.url, key }));
        sync();
      } catch (error) { setStatus(error.message); }
    };
    document.getElementById('sync-disconnect').onclick = () => {
      generation++; rerun = false; clearTimeout(timer); localStorage.removeItem(CONFIG);
      document.getElementById('sync-key').value = '';
      setStatus('已断开，本机和云端数据均保留');
    };
  }
  window.CloudSync = { changed, sync, open };
  const existed = localStorage.getItem(STATE) !== null;
  capture(!existed);
  window.addEventListener('online', sync);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  // Storage is shared by browser tabs. Refresh views without uploading stale tab state.
  window.addEventListener('storage', event => {
    if ([STATE, CONFIG].includes(event.key)) { generation++; sync(); }
  });
  setInterval(() => { if (!document.hidden) sync(); }, 30000);
  sync();
})();
