const TRAVEL_CATS = [
  { name: '住宿', icon: '🏨' }, { name: '出行', icon: '🚃' },
  { name: '餐饮', icon: '🍱' }, { name: '门票', icon: '🎫' },
  { name: '购物', icon: '🛍️' }, { name: '其他', icon: '📦' }
];
const Travel = SpendexTravel;
let selectedTravelCat = null;
let selectedTripId = null;
let viewingTripId = null;
const travelDrafts = new Map();

function getTrips() {
  try { return JSON.parse(localStorage.getItem('travel_trips') || '[]'); }
  catch { return []; }
}
function saveTrips(trips) {
  localStorage.setItem('travel_trips', JSON.stringify(trips));
  window.CloudSync?.changed();
}
function travelToday() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function preserveTravelDraft() {
  const amount = document.getElementById('travel-amount');
  if (!amount || !selectedTripId || viewingTripId) return;
  const draft = {
    amount: amount.value, note: document.getElementById('travel-note').value,
    date: document.getElementById('travel-date').value,
    currency: document.getElementById('travel-currency').value,
    pending: document.getElementById('travel-pending-check').checked,
    category: selectedTravelCat
  };
  if (draft.amount || draft.note || draft.pending || draft.category || draft.date !== travelToday()) travelDrafts.set(selectedTripId, draft);
  else travelDrafts.delete(selectedTripId);
}
function refreshTravelAfterSync() {
  const focused = document.activeElement;
  const focusId = focused?.id?.startsWith('travel-') ? focused.id : null;
  const selection = focused?.type === 'text' ? [focused.selectionStart, focused.selectionEnd] : null;
  preserveTravelDraft();
  renderTravel();
  const replacement = focusId && document.getElementById(focusId);
  if (replacement) {
    replacement.focus({ preventScroll: true });
    if (selection) replacement.setSelectionRange(...selection);
  }
}
function openTrip(tripId) {
  preserveTravelDraft();
  const trip = getTrips().find(item => item.id === tripId);
  if (!trip) return showTripList();
  selectedTripId = tripId;
  viewingTripId = trip.status === 'archived' ? tripId : null;
  selectedTravelCat = travelDrafts.get(tripId)?.category || null;
  renderTravel();
  const code = document.getElementById('travel-currency')?.value;
  if (trip.status === 'active' && code && code !== 'CNY' && !Travel.validRate(Travel.rate(trip, code))) {
    editTripRates(tripId, 'record', code);
  }
}
function showTripList() {
  preserveTravelDraft();
  selectedTripId = null; viewingTripId = null; selectedTravelCat = null;
  renderTravel();
}
function createTrip() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-box"><h3>新建行程</h3>
    <input type="text" id="trip-name-input" placeholder="如：大阪之旅" maxlength="40" aria-label="行程名称">
    <div class="modal-btns"><button class="modal-cancel" onclick="this.closest('.modal-overlay').remove()">取消</button>
      <button class="modal-confirm" onclick="confirmCreateTrip()">创建</button></div></div>`;
  document.body.appendChild(overlay);
  document.getElementById('trip-name-input').focus();
}
function confirmCreateTrip() {
  const name = document.getElementById('trip-name-input').value.trim();
  if (!name) return;
  const trips = getTrips(), id = newRecordId();
  trips.push({ id, name, status: 'active', createdAt: travelToday(), archivedAt: null, lastCurrency: 'CNY', rates: {}, records: [] });
  saveTrips(trips);
  document.getElementById('trip-name-input').closest('.modal-overlay').remove();
  openTrip(id);
}
function renameTripModal(tripId) {
  const trip = getTrips().find(item => item.id === tripId);
  if (!trip) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-box"><h3>修改行程名称</h3>
    <input type="text" id="rename-trip-input" value="${esc(trip.name)}" maxlength="40" aria-label="行程名称">
    <div class="modal-btns"><button class="modal-cancel" onclick="this.closest('.modal-overlay').remove()">取消</button>
      <button class="modal-confirm" onclick="confirmRenameTrip(${tripId})">确定</button></div></div>`;
  document.body.appendChild(overlay);
  document.getElementById('rename-trip-input').select();
}
function confirmRenameTrip(tripId) {
  const name = document.getElementById('rename-trip-input').value.trim();
  if (!name) return;
  const trips = getTrips(), trip = trips.find(item => item.id === tripId);
  if (!trip) return;
  preserveTravelDraft();
  trip.name = name; saveTrips(trips);
  document.getElementById('rename-trip-input').closest('.modal-overlay').remove();
  renderTravel();
}
function selectTravelCat(name) {
  selectedTravelCat = name;
  document.querySelectorAll('.travel-cat-grid .cat-btn').forEach(button => button.classList.toggle('selected', button.dataset.cat === name));
  updateTravelSubmit();
}
function selectTravelCurrency(tripId) {
  const code = document.getElementById('travel-currency').value;
  if (!Travel.supported(code)) return;
  const trips = getTrips(), trip = trips.find(item => item.id === tripId && item.status === 'active');
  if (!trip || selectedTripId !== tripId) return;
  trip.lastCurrency = code;
  saveTrips(trips);
  preserveTravelDraft();
  document.getElementById('travel-rates').innerHTML = tripRatesHTML(trip, 'record', code);
  if (code !== 'CNY' && !Travel.validRate(Travel.rate(trip, code))) editTripRates(tripId, 'record', code);
}
function updateTravelSubmit() {
  const result = SpendexAmount.update('travel-amount');
  const button = document.getElementById('travel-submit-btn');
  if (button) button.disabled = !(selectedTravelCat && result.valid && result.value > 0);
}
function saveTravelRecord(tripId) {
  const result = SpendexAmount.update('travel-amount');
  const amount = result.value;
  const code = document.getElementById('travel-currency').value;
  const date = document.getElementById('travel-date').value;
  if (!selectedTravelCat || !result.valid || amount <= 0 || !date || !Travel.supported(code)) return;
  // Resolve the explicit form's trip, never the first active trip in storage.
  const trips = getTrips(), trip = trips.find(item => item.id === tripId && item.status === 'active');
  if (!trip || selectedTripId !== tripId) { alert('此行程已结束或不存在，请返回行程列表'); return; }
  trip.lastCurrency = code;
  trip.records.push({ id: newRecordId(), date, category: selectedTravelCat, amount, currency: code,
    note: document.getElementById('travel-note').value.trim(), pending: document.getElementById('travel-pending-check').checked });
  saveTrips(trips);
  travelDrafts.delete(tripId); selectedTravelCat = null;
  showToast(); renderTravel();
}
function delTravelRecord(tripId, recordId) {
  if (!confirm('删除这条记录？')) return;
  const trips = getTrips(), trip = trips.find(item => item.id === tripId);
  if (!trip) return;
  preserveTravelDraft();
  trip.records = trip.records.filter(record => record.id !== recordId);
  saveTrips(trips); renderTravel();
}
function getTripDateRange(trip) {
  if (!trip.records.length) return trip.createdAt;
  const dates = trip.records.map(record => record.date).sort();
  return dates[0] === dates.at(-1) ? dates[0] : dates[0] + ' ~ ' + dates.at(-1);
}
function foreignCurrencies(trip) {
  return Object.keys(Travel.totals(trip).byCurrency).filter(code => code !== 'CNY').sort();
}
function rateCurrencies(trip, extraCode) {
  return [...new Set([...foreignCurrencies(trip), ...Object.keys(trip.rates || {}), extraCode])]
    .filter(code => code !== 'CNY' && Travel.supported(code)).sort();
}
function viewTripSummary(tripId) {
  preserveTravelDraft();
  const trip = getTrips().find(item => item.id === tripId);
  if (!trip) return showTripList();
  if (!Travel.totals(trip).complete) return editTripRates(tripId, 'summary');
  viewingTripId = tripId; renderTravel();
}
function endTrip(tripId) {
  preserveTravelDraft();
  const trip = getTrips().find(item => item.id === tripId && item.status === 'active');
  if (!trip) return;
  if (travelDrafts.has(tripId) && !confirm('当前还有未提交的记账内容。继续结束行程？')) return;
  if (foreignCurrencies(trip).length) return editTripRates(tripId, 'end');
  if (confirm('结束「' + trip.name + '」？其他行程不受影响。')) finishTrip(tripId);
}
function finishTrip(tripId) {
  const trips = getTrips(), trip = trips.find(item => item.id === tripId && item.status === 'active');
  if (!trip) return;
  if (!Travel.totals(trip).complete) return editTripRates(tripId, 'end');
  trip.status = 'archived'; trip.archivedAt = travelToday();
  saveTrips(trips);
  travelDrafts.delete(tripId); selectedTravelCat = null;
  viewingTripId = tripId; selectedTripId = tripId; renderTravel();
}
function editTripRates(tripId, action = 'summary', extraCode = '') {
  if (document.getElementById('trip-rates-modal')) return;
  const trip = getTrips().find(item => item.id === tripId);
  if (!trip) return;
  preserveTravelDraft();
  const codes = rateCurrencies(trip, extraCode);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'trip-rates-modal';
  overlay.dataset.currency = extraCode;
  overlay.innerHTML = `<div class="modal-box trip-rates-box"><h3>${action === 'end' ? '确认汇率并结束行程' : '设置行程汇率'}</h3>
    <p>为「${esc(trip.name)}」统一折算人民币。修改汇率会重新计算此行程的全部记录。</p>
    ${codes.map(code => {
      const info = Travel.currencies.find(item => item.code === code), multiplier = Travel.rate(trip, code);
      return `<label class="rate-label" for="trip-rate-${code}">${info.unit} ${code}（${info.name}）兑换人民币</label>
        <div class="rate-input-row"><input id="trip-rate-${code}" type="number" min="0" step="any" inputmode="decimal" placeholder="请输入汇率" value="${Travel.validRate(multiplier) ? Number((multiplier * info.unit).toPrecision(12)) : ''}"><span>元</span></div>`;
    }).join('')}
    <p class="rate-error" id="trip-rate-error" role="alert"></p>
    <div class="modal-btns"><button class="modal-cancel" onclick="document.getElementById('trip-rates-modal').remove();refreshTravelAfterSync()">取消</button>
      <button class="modal-confirm" onclick="confirmTripRates(${tripId},'${action}')">${action === 'end' ? '保存并结束' : action === 'record' ? '保存汇率' : '保存并汇总'}</button></div></div>`;
  document.body.appendChild(overlay);
}
function confirmTripRates(tripId, action) {
  // Re-read storage: another device may have changed the trip while this modal was open.
  const trips = getTrips(), trip = trips.find(item => item.id === tripId);
  if (!trip) { document.getElementById('trip-rates-modal').remove(); return showTripList(); }
  const rates = { ...trip.rates };
  const extraCode = document.getElementById('trip-rates-modal').dataset.currency;
  for (const code of rateCurrencies(trip, extraCode)) {
    const input = document.getElementById('trip-rate-' + code);
    if (!input) {
      document.getElementById('trip-rates-modal').remove();
      return editTripRates(tripId, action, extraCode);
    }
    const info = Travel.currencies.find(item => item.code === code), value = Number(input.value) / info.unit;
    if (!Travel.validRate(value)) { document.getElementById('trip-rate-error').textContent = '请填写大于 0 的有效汇率'; input.focus(); return; }
    rates[code] = value;
  }
  trip.rates = rates; saveTrips(trips);
  document.getElementById('trip-rates-modal').remove();
  if (action === 'end') finishTrip(tripId);
  else if (action === 'record') refreshTravelAfterSync();
  else { viewingTripId = tripId; renderTravel(); }
}
function deleteTrip(tripId) {
  if (!confirm('删除这个行程及其所有记录？')) return;
  saveTrips(getTrips().filter(trip => trip.id !== tripId));
  travelDrafts.delete(tripId); showTripList();
}
function tripCurrencyChips(trip) {
  return Object.entries(Travel.totals(trip).byCurrency).map(([code, amount]) => `<span class="currency-chip">${Travel.money(amount, code)}</span>`).join('');
}
function tripTotalLabel(trip) {
  const totals = Travel.totals(trip);
  return totals.complete ? '折合人民币 ¥' + totals.cny.toFixed(2) : '待填写汇率';
}
function tripRatesHTML(trip, action = 'summary', extraCode = '') {
  const codes = rateCurrencies(trip, extraCode);
  if (!codes.length) return '';
  return `<div class="card rate-summary"><div class="rate-summary-header"><span>行程汇率</span>
    <button class="trip-back" onclick="editTripRates(${trip.id},'${action}','${extraCode}')">修改汇率</button></div>
    ${codes.map(code => {
      const info = Travel.currencies.find(item => item.code === code), value = Travel.rate(trip, code);
      return `<p>${info.unit} ${code} = ${Travel.validRate(value) ? Number((value * info.unit).toPrecision(12)) + ' CNY' : '待填写'}</p>`;
    }).join('')}</div>`;
}
function renderTravel() {
  if (viewingTripId) {
    const trip = getTrips().find(item => item.id === viewingTripId);
    if (trip) return renderTripSummary(trip.id);
  } else if (selectedTripId) {
    const trip = getTrips().find(item => item.id === selectedTripId);
    if (trip?.status === 'active') return renderTripRecorder(trip);
    if (trip?.status === 'archived') { viewingTripId = trip.id; return renderTripSummary(trip.id); }
  }
  selectedTripId = null; viewingTripId = null; selectedTravelCat = null;
  renderTripList();
}
function renderTripList() {
  const trips = getTrips().sort((a, b) => b.id - a.id);
  let html = `<div class="btn-group"><button class="btn btn-primary" onclick="createTrip()">＋ 新建行程</button></div>`;
  for (const [status, label] of [['active', '进行中'], ['archived', '已结束']]) {
    const group = trips.filter(trip => trip.status === status);
    if (!group.length) continue;
    html += `<p class="card-label">${label} · ${group.length}</p><div class="card">`;
    html += group.map(trip => `<button class="trip-list-item" onclick="openTrip(${trip.id})">
      <span class="trip-list-copy"><span class="trip-name">${esc(trip.name)}</span>
        <span class="trip-info">${getTripDateRange(trip)} · ${trip.records.length} 笔</span>
        <span class="currency-chips">${tripCurrencyChips(trip)}</span></span>
      <span class="trip-list-aside"><span class="trip-amt">${tripTotalLabel(trip)}</span><span aria-hidden="true">›</span></span></button>`).join('');
    html += '</div>';
  }
  if (!trips.length) html += '<div class="card"><div class="empty-msg">还没有行程记录，可以同时创建多个行程</div></div>';
  document.getElementById('travel-panel').innerHTML = html;
}
function tripRecordsHTML(trip, allowDelete) {
  if (!trip.records.length) return '';
  return `<p class="card-label">记录</p><div class="card">` + [...trip.records].sort((a, b) => b.id - a.id).map(record => {
    const cat = TRAVEL_CATS.find(item => item.name === record.category), value = Travel.converted(trip, record), code = Travel.currency(record);
    return `<div class="record-item"><div class="record-left">
      <div class="record-cat">${cat?.icon || ''} ${esc(record.category)}${record.pending ? '<span class="record-badge pending">待确认</span>' : ''}</div>
      <div class="record-meta">${esc(record.date)}${record.note ? ' · ' + esc(record.note) : ''}</div></div>
      <div class="record-right"><div class="record-amt">-${Travel.money(record.amount, code)}</div>
        ${code !== 'CNY' ? `<div class="record-meta">${value === null ? '待折算' : '约 ¥' + value.toFixed(2)}</div>` : ''}</div>
      ${allowDelete ? `<button class="record-del-btn" aria-label="删除记录" onclick="delTravelRecord(${trip.id},${record.id})">×</button>` : ''}</div>`;
  }).join('') + '</div>';
}
function renderTripRecorder(trip) {
  const draft = travelDrafts.get(trip.id);
  selectedTravelCat = draft?.category || null;
  const code = draft?.currency || trip.lastCurrency || 'CNY';
  let html = `<button class="trip-back" onclick="showTripList()">‹ 返回行程列表</button>
    <div class="card"><div class="trip-header">
      <h2>${esc(trip.name)} <button class="record-edit-btn" aria-label="修改行程名称" onclick="renameTripModal(${trip.id})">✏️</button></h2>
      <div class="trip-total">${tripTotalLabel(trip)}</div><div class="currency-chips">${tripCurrencyChips(trip)}</div>
      <div class="trip-meta">进行中 · ${trip.records.length} 笔 · ${getTripDateRange(trip)}</div></div></div>
    <div id="travel-rates" style="display:contents">${tripRatesHTML(trip, 'record', code)}</div>
    <p class="card-label">类别</p><div class="card"><div class="travel-cat-grid">${TRAVEL_CATS.map(cat =>
      `<button class="cat-btn${selectedTravelCat === cat.name ? ' selected' : ''}" data-cat="${cat.name}" onclick="selectTravelCat('${cat.name}')"><span class="icon">${cat.icon}</span>${cat.name}</button>`).join('')}</div></div>
    <p class="card-label">详情</p><div class="card">
      <div class="form-row"><label class="form-label" for="travel-date">日期</label><input class="form-input" type="date" id="travel-date" value="${esc(draft?.date || travelToday())}"></div>
      <div class="form-row travel-money-row"><label class="form-label" for="travel-amount">金额</label>
        <input class="form-input money-input" type="text" id="travel-amount" placeholder="0.00" inputmode="text" autocomplete="off" spellcheck="false" aria-describedby="travel-amount-result" value="${esc(draft?.amount || '')}" oninput="updateTravelSubmit()" onkeydown="SpendexAmount.onKey(event,'travel-amount')">
        <select class="travel-currency" id="travel-currency" aria-label="币种" onchange="selectTravelCurrency(${trip.id})">${Travel.currencies.map(item => `<option value="${item.code}"${item.code === code ? ' selected' : ''}>${item.code} ${item.name}</option>`).join('')}</select></div>
      <div class="amount-calculation" id="travel-amount-calculation" hidden><span id="travel-amount-result" role="status" aria-live="polite"></span><button type="button" id="travel-amount-use-result" onclick="SpendexAmount.useResult('travel-amount')" hidden>使用结果</button></div>
      <div class="form-row"><label class="form-label" for="travel-note">备注</label><input class="form-input" type="text" id="travel-note" placeholder="可选" value="${esc(draft?.note || '')}"></div>
      <p class="travel-help">按原币金额记录，人民币累计按行程汇率计算。汇率可随时修改。</p></div>
    <div class="card"><div class="form-toggle-row"><div><label for="travel-pending-check">待确认</label><div class="toggle-desc">标记后可快速识别</div></div>
      <div class="toggle-switch"><input type="checkbox" id="travel-pending-check"${draft?.pending ? ' checked' : ''}><span class="slider" onclick="document.getElementById('travel-pending-check').click()"></span></div></div></div>
    <div class="btn-group"><button class="btn btn-primary" id="travel-submit-btn" onclick="saveTravelRecord(${trip.id})" disabled>记一笔</button></div>`;
  html += tripRecordsHTML(trip, true);
  html += `<div class="btn-group"><button class="btn btn-secondary" onclick="viewTripSummary(${trip.id})">查看汇总</button>
    <button class="btn btn-secondary" onclick="importTripCSV(${trip.id})">导入 CSV</button><button class="btn btn-cancel" onclick="endTrip(${trip.id})">结束行程</button></div>`;
  document.getElementById('travel-panel').innerHTML = html;
  updateTravelSubmit();
}
function returnFromTripSummary(tripId) {
  const trip = getTrips().find(item => item.id === tripId);
  if (trip?.status === 'active') openTrip(tripId);
  else showTripList();
}
function renderTripSummary(tripId) {
  const trip = getTrips().find(item => item.id === tripId);
  if (!trip) return showTripList();
  const totals = Travel.totals(trip), byCat = {};
  for (const record of trip.records) (byCat[record.category] ||= []).push(record);
  let html = `<button class="trip-back" onclick="showTripList()">‹ 返回行程列表</button>
    <div class="card"><div class="trip-summary-total"><div class="label">${esc(trip.name)} · ${trip.status === 'active' ? '进行中' : '已结束'}</div>
      <div class="amount">${totals.complete ? '¥' + totals.cny.toFixed(2) : '待折算'}</div><div class="trip-meta">${totals.complete ? '折合人民币' : '尚有外币未填写汇率'}</div>
      <div class="currency-chips">${tripCurrencyChips(trip)}</div></div>
      <div class="trip-summary-meta">${getTripDateRange(trip)} · 共 ${trip.records.length} 笔</div>
      ${Object.keys(byCat).length ? '<div class="cat-breakdown">' + Object.entries(byCat).map(([cat, records]) => {
        const subtotal = Travel.totals({ ...trip, records }), info = TRAVEL_CATS.find(item => item.name === cat);
        return `<div class="cat-breakdown-row"><span>${info?.icon || ''} ${esc(cat)}</span><span class="category-totals"><span class="amt">${subtotal.complete ? '¥' + subtotal.cny.toFixed(2) : '待折算'}</span><span class="record-meta">${Object.entries(subtotal.byCurrency).map(([code, amount]) => Travel.money(amount, code)).join(' · ')}</span></span></div>`;
      }).join('') + '</div>' : ''}</div>`;
  html += tripRatesHTML(trip);
  html += tripRecordsHTML(trip, false);
  html += `<div class="btn-group"><button class="btn btn-primary" onclick="exportTripCSV(${trip.id})">导出 CSV</button>
    <button class="btn btn-secondary" onclick="returnFromTripSummary(${trip.id})">${trip.status === 'active' ? '继续记账' : '返回列表'}</button>
    <button class="btn btn-cancel" onclick="deleteTrip(${trip.id})">删除行程</button></div>`;
  document.getElementById('travel-panel').innerHTML = html;
}
function exportTripCSV(tripId) {
  const trip = getTrips().find(item => item.id === tripId);
  if (!trip?.records.length) { alert('没有记录'); return; }
  triggerDownload(Travel.buildCSV(trip), `trip_${trip.name}_${getTripDateRange(trip).replace(' ~ ', '_')}.csv`);
}
function importTripCSV(tripId) {
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.csv';
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => parseAndImportTripCSV(tripId, reader.result);
    reader.readAsText(file);
  };
  input.click();
}
function parseAndImportTripCSV(tripId, text) {
  let incoming;
  try { incoming = Travel.readCSV(text); } catch (error) { alert(error.message); return; }
  if (!incoming.records.length) { alert('未找到有效记录，请检查金额、日期和币种'); return; }
  const trips = getTrips(), trip = trips.find(item => item.id === tripId && item.status === 'active');
  if (!trip) return;
  const existing = new Set(trip.records.map(Travel.identity));
  const additions = incoming.records.filter(record => {
    const identity = Travel.identity(record);
    if (existing.has(identity)) return false;
    existing.add(identity); return true;
  });
  if (!additions.length) { alert('所有记录已存在，无需导入。'); return; }
  const conflicts = Object.keys(incoming.rates).filter(code => Travel.validRate(Travel.rate(trip, code)) && Travel.rate(trip, code) !== incoming.rates[code]);
  const message = `发现 ${additions.length} 条新记录，导入到「${trip.name}」？` +
    (incoming.skipped ? `\n已跳过 ${incoming.skipped} 条无效记录。` : '') +
    (conflicts.length ? `\n${conflicts.join('、')} 汇率与此行程不同，将保留此行程的汇率。` : '');
  if (!confirm(message)) return;
  preserveTravelDraft();
  trip.records.push(...additions.map(record => ({ ...record, id: newRecordId() })));
  trip.rates = { ...incoming.rates, ...trip.rates };
  saveTrips(trips); renderTravel();
  alert(`已导入 ${additions.length} 条记录！`);
}
