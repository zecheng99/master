const Subscription = SpendexSubscriptions;
function getSubscriptions() {
  try { return JSON.parse(localStorage.getItem('expense_subscriptions') || '[]'); }
  catch { return []; }
}
function saveSubscriptions(subscriptions) {
  localStorage.setItem('expense_subscriptions', JSON.stringify(subscriptions));
  window.CloudSync?.changed();
}
function getSubscriptionStates() {
  try { return JSON.parse(localStorage.getItem('expense_subscription_states') || '[]'); }
  catch { return []; }
}
function subscriptionBillingMonth(subscription) {
  return Subscription.billingMonth(subscription, getSubscriptionStates().find(state => state.id === subscription.id));
}
function renderSubscriptions() {
  const subscriptions = getSubscriptions(), records = getRecords();
  const active = subscriptions.filter(item => item.status === 'active');
  const monthly = active.reduce((sum, item) => sum + Math.round(item.amount * 100), 0) / 100;
  let html = `<div class="card subscription-overview"><p>每月预计订阅支出</p><strong>¥${monthly.toFixed(2)}</strong><span>${active.length} 项使用中</span></div>
    <button class="btn btn-primary" onclick="subscriptionForm()">＋ 添加订阅</button>
    <p class="subscription-help">到期自动生成待确认账单，确认后计入支出，可在明细中修改实际金额。每月扣费日不足时按月末处理。</p>`;
  let connected = false;
  try { connected = !!JSON.parse(localStorage.getItem('spendex_sync_config_v1') || '{}').key; } catch {}
  if (!connected) html += `<div class="card subscription-notice">开启云同步后，云端才能自动记账。<button class="trip-back" onclick="CloudSync.open()">设置云同步</button></div>`;
  for (const [status, label] of [['active', '使用中'], ['paused', '已暂停'], ['cancelled', '已取消']]) {
    const group = subscriptions.filter(item => item.status === status).sort((a, b) => {
      const aDate = Subscription.dueDate(subscriptionBillingMonth(a), a.day), bDate = Subscription.dueDate(subscriptionBillingMonth(b), b.day);
      return aDate.localeCompare(bDate) || b.id - a.id;
    });
    if (!group.length) continue;
    html += `<p class="card-label">${label} · ${group.length}</p>`;
    html += group.map(item => {
      const pending = records.filter(record => record.subscriptionId === item.id && record.pending).length;
      const due = Subscription.dueDate(subscriptionBillingMonth(item), item.day);
      return `<div class="card subscription-card"><div class="subscription-heading"><h2>${esc(item.name)}</h2><span>¥${item.amount.toFixed(2)} / 月</span></div>
        <p>每月 ${item.day} 日 · ${esc(item.largeCat)} / ${esc(item.smallCat)}</p>
        <p>${status === 'active' ? (due <= Subscription.today() ? '等待云端生成：' : '下次记账：') + due : status === 'paused' ? '暂停期间不生成新账单，恢复后从下一次扣费日继续。' : '已停止生成新账单，历史账单保留。'}</p>
        ${pending ? `<p class="subscription-pending">${pending} 笔待确认，请在明细中核对</p>` : ''}
        ${item.note ? `<p>${esc(item.note)}</p>` : ''}
        ${status !== 'cancelled' ? `<div class="subscription-actions"><button onclick="subscriptionForm(${item.id})">修改</button>
          <button onclick="changeSubscriptionStatus(${item.id},'${status === 'active' ? 'paused' : 'active'}')">${status === 'active' ? '暂停' : '恢复'}</button>
          <button onclick="changeSubscriptionStatus(${item.id},'cancelled')">取消订阅</button></div>` : ''}</div>`;
    }).join('');
  }
  if (!subscriptions.length) html += '<div class="card"><div class="empty-msg">添加每月固定扣费的项目，例如云存储、会员或软件订阅。</div></div>';
  document.getElementById('subscription-panel').innerHTML = html;
}
function subscriptionForm(id = null) {
  if (document.getElementById('subscription-modal')) return;
  const existing = id ? getSubscriptions().find(item => item.id === id) : null;
  if (id && (!existing || existing.status === 'cancelled')) return;
  const date = Subscription.today();
  const item = existing || { name: '', amount: '', day: Number(date.slice(8)), startMonth: date.slice(0, 7), largeCat: 'Z-其他', smallCat: '订阅', note: '' };
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'subscription-modal';
  overlay.innerHTML = `<div class="modal-box subscription-form"><h3>${id ? '修改订阅' : '添加订阅'}</h3>
    <label for="subscription-name">名称</label><input id="subscription-name" value="${esc(item.name)}" maxlength="80" placeholder="例如：云存储">
    <label for="subscription-amount">每月金额（人民币）</label><input id="subscription-amount" type="text" inputmode="text" value="${esc(item.amount)}" placeholder="0.00" autocomplete="off" oninput="SpendexAmount.update('subscription-amount')" onkeydown="SpendexAmount.onKey(event,'subscription-amount')">
    <div class="amount-calculation" id="subscription-amount-calculation" hidden><span id="subscription-amount-result" role="status"></span><button id="subscription-amount-use-result" type="button" onclick="SpendexAmount.useResult('subscription-amount')" hidden>使用结果</button></div>
    <div class="subscription-schedule"><div><label for="subscription-day">每月扣费日</label><input id="subscription-day" type="number" min="1" max="31" inputmode="numeric" value="${item.day}"></div>
      <div><label for="subscription-start">开始月份</label><input id="subscription-start" type="month" value="${item.startMonth}" ${id ? 'disabled' : `min="${date.slice(0, 7)}"`}></div></div>
    <label for="subscription-large-cat">分类</label><select id="subscription-large-cat" onchange="subscriptionCategoryOptions()">${CATS.filter(cat => !cat.isIncome).map(cat => `<option value="${esc(cat.code)}"${cat.code === item.largeCat ? ' selected' : ''}>${esc(cat.code)}</option>`).join('')}</select>
    <select id="subscription-small-cat" aria-label="子分类"></select>
    <label for="subscription-note">备注</label><input id="subscription-note" value="${esc(item.note || '')}" maxlength="500" placeholder="可选">
    <p>按北京时间／新加坡时间记账。月底没有对应日期时使用当月最后一天。修改设置只影响之后生成的账单。</p>
    <p id="subscription-error" role="alert" class="rate-error"></p>
    <div class="modal-btns"><button class="modal-cancel" onclick="document.getElementById('subscription-modal').remove();renderSubscriptions()">取消</button>
      <button class="modal-confirm" onclick="saveSubscriptionForm(${id || 'null'})">保存</button></div></div>`;
  document.body.appendChild(overlay);
  subscriptionCategoryOptions(item.smallCat);
  document.getElementById('subscription-name').focus();
}
function subscriptionCategoryOptions(selected) {
  const cat = CATS.find(item => item.code === document.getElementById('subscription-large-cat').value);
  document.getElementById('subscription-small-cat').innerHTML = cat.subs.map(sub => `<option value="${esc(sub)}"${sub === selected ? ' selected' : ''}>${esc(sub)}</option>`).join('');
}
function saveSubscriptionForm(id) {
  const items = getSubscriptions(), previous = items.find(item => item.id === id);
  const fail = message => { document.getElementById('subscription-error').textContent = message; };
  if (id && (!previous || previous.status === 'cancelled')) return fail('此订阅已被取消或不存在，请关闭后重新查看。');
  const name = document.getElementById('subscription-name').value.trim();
  const amount = SpendexAmount.update('subscription-amount');
  const day = Number(document.getElementById('subscription-day').value);
  const startMonth = previous?.startMonth || document.getElementById('subscription-start').value;
  const largeCat = document.getElementById('subscription-large-cat').value, smallCat = document.getElementById('subscription-small-cat').value;
  if (!name) return fail('请填写订阅名称');
  if (!amount.valid || amount.value <= 0) return fail('请填写大于 0 的有效金额');
  if (!Number.isInteger(day) || day < 1 || day > 31) return fail('扣费日需要是 1 至 31 的整数');
  if (!Subscription.validMonth(startMonth) || !id && startMonth < Subscription.today().slice(0, 7)) return fail('开始月份请选择本月或未来月份');
  const item = { ...previous, id: previous?.id || newRecordId(), name, amount: amount.value, day, startMonth,
    nextMonth: previous?.nextMonth || startMonth, largeCat, smallCat,
    note: document.getElementById('subscription-note').value.trim(), status: previous?.status || 'active', createdAt: previous?.createdAt || Subscription.today() };
  if (!Subscription.valid(item)) return fail('订阅设置无效，请检查名称、金额和分类');
  if (previous) items[items.findIndex(item => item.id === id)] = item;
  else items.push(item);
  saveSubscriptions(items);
  document.getElementById('subscription-modal').remove(); renderSubscriptions();
  window.CloudSync?.sync();
}
function changeSubscriptionStatus(id, status) {
  const items = getSubscriptions(), item = items.find(item => item.id === id);
  if (!item || item.status === 'cancelled') return;
  if (status === 'cancelled' && !confirm('取消「' + item.name + '」？之后不再生成新账单，已生成的账单仍保留。')) return;
  if (status === 'active' && item.status !== 'paused') return;
  if (status === 'active') {
    const next = Subscription.resumeMonth(item);
    item.nextMonth = item.nextMonth && item.nextMonth > next ? item.nextMonth : next;
  }
  item.status = status;
  saveSubscriptions(items); renderSubscriptions(); window.CloudSync?.sync();
}
function confirmSubscriptionCharge(id) {
  const records = getRecords(), record = records.find(item => item.id === id && item.subscriptionId && item.pending);
  if (!record) return;
  record.pending = false;
  saveRecords(records); renderHistory();
}
