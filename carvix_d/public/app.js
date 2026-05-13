/* ============================================================
   Carvix — главное SPA-приложение (финансовый модуль).
   Хэш-роутинг: #dashboard | #expenses | #budgets | #tco | #receipts | #audit
   ============================================================ */

const TOKEN = localStorage.getItem('carvix_token');
if (!TOKEN) location.replace('/');

let CURRENT_USER = null;
let CURRENT_CHARTS = [];      // активные Chart.js инстансы (для destroy при смене)
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Алиас на i18n (window.t, window.applyI18n, window.getLang определены в i18n.js).
const T = (key, vars) => window.t(key, vars);
const LOC = () => (window.getLang() === 'en' ? 'en-US' : 'ru-RU');

/* ----------------- Утилиты ----------------- */
function fmtMoney(v) {
  const n = Number(v) || 0;
  return new Intl.NumberFormat(LOC(), { maximumFractionDigits: 0 }).format(n) + ' ₽';
}
function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleDateString(LOC());
}
function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleString(LOC(), { dateStyle: 'short', timeStyle: 'short' });
}

/** Получить переведённое название категории. */
function catLabel(k) { return T('cat.' + k) || k; }
function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}
function toast(msg, type = '') {
  const t = $('#toast');
  t.className = 'show ' + type;
  t.textContent = msg;
  setTimeout(() => t.classList.remove('show'), 2400);
}

/* ----------------- API ----------------- */
async function api(path, options = {}) {
  const opts = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      ...(options.headers || {}),
    },
  };
  const res = await fetch(path, opts);
  if (res.status === 401) {
    localStorage.removeItem('carvix_token');
    location.replace('/');
    throw new Error('unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ----------------- Auth ----------------- */
async function loadUser() {
  CURRENT_USER = await api('/api/auth/me');
  window.CURRENT_USER = CURRENT_USER;       // доступно из app-roles.js
  $('#userName').textContent = CURRENT_USER.fio;
  const roleEl = $('#userRole');
  roleEl.textContent = CURRENT_USER.rol_nazvanie;
  roleEl.className = 'user__role role-badge role-badge--' + {
    'Директор': 'director',
    'Аналитик': 'analyst',
    'Главный механик': 'chief',
    'Механик': 'mechanic',
    'Диспетчер': 'dispatch',
    'Пользователь': 'user',
  }[CURRENT_USER.rol_nazvanie] || 'user';
  $('#userAvatar').textContent = CURRENT_USER.fio[0] || '?';

  // ---- Видимость пунктов меню по ролям ----------------------
  const role = CURRENT_USER.rol_nazvanie;

  // Полная карта: какая роль видит какие разделы
  const SECTIONS_BY_ROLE = {
    'Директор':         ['dashboard','requests','dispatch','repairs','transport','expenses','budgets','tco','receipts','audit'],
    'Аналитик':         ['dashboard','requests','transport','expenses','budgets','tco','receipts','audit'],
    'Главный механик':  ['dashboard','requests','dispatch','repairs','transport','expenses','budgets','tco','receipts'],
    'Диспетчер':        ['requests','dispatch','transport'],
    'Механик':          ['repairs','requests','transport'],
    'Пользователь':     ['requests','transport'],
  };
  const allowed = SECTIONS_BY_ROLE[role] || ['requests'];
  allowed.push('profile'); // профиль доступен всем

  document.querySelectorAll('.nav__item').forEach(link => {
    const sec = link.dataset.section;
    if (!allowed.includes(sec)) link.style.display = 'none';
  });

  // Если текущий хеш не доступен этой роли — редиректим в первый доступный.
  const cur = location.hash.replace('#','') || 'dashboard';
  if (!allowed.includes(cur)) {
    location.replace(`#${allowed[0]}`);
  }
}

$('#logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('carvix_token');
  location.replace('/');
});

/* ----------------- Theme & Lang toggles ----------------- */
$('#themeToggle')?.addEventListener('click', () => window.toggleTheme());

function syncLangButtons() {
  const cur = window.getLang();
  $$('.lang-toggle__btn').forEach(b =>
    b.classList.toggle('active', b.dataset.lang === cur)
  );
}
$$('.lang-toggle__btn').forEach(btn => {
  btn.addEventListener('click', () => {
    window.setLang(btn.dataset.lang);
    syncLangButtons();
    // Перерендерим текущий раздел, чтобы динамические строки тоже перевелись
    navigate();
  });
});
syncLangButtons();

/* ----------------- Router ----------------- */
const ROUTES = {
  dashboard: renderDashboard,
  expenses:  renderExpenses,
  budgets:   renderBudgets,
  tco:       renderTco,
  receipts:  renderReceipts,
  audit:     renderAudit,
  profile:   renderProfile,
};

// Открываем ROUTES наружу — внешние модули (app-roles.js) могут расширять
// объект напрямую: Object.assign(window.CARVIX_ROUTES, { requests: fn, ... }).
// Это работает потому что navigate() вызывается асинхронно, после loadUser().
window.CARVIX_ROUTES = ROUTES;

function navigate() {
  const hash = location.hash.replace('#', '') || 'dashboard';
  const handler = ROUTES[hash] || renderDashboard;

  // подсветка nav
  $$('.nav__item').forEach(a =>
    a.classList.toggle('active', a.dataset.section === hash)
  );

  // destroy старые графики
  CURRENT_CHARTS.forEach(c => c.destroy?.());
  CURRENT_CHARTS = [];

  const root = $('#content');
  root.innerHTML = `<div class="loading-screen"><div class="spinner"></div><div>${T('common.loading')}</div></div>`;

  Promise.resolve(handler(root))
    .catch(e => {
      console.error(e);
      root.innerHTML = `<div class="empty">⚠ ${escape(e.message || T('toast.auth_error'))}</div>`;
      if (e.status === 403) toast(T('toast.no_rights'), 'error');
    });
}

window.addEventListener('hashchange', navigate);

/* =========================================================
   0. ПРОФИЛЬ
   ========================================================= */
async function renderProfile(root) {
  const u = CURRENT_USER;
  root.innerHTML = `
    <div class="section__head">
      <div>
        <h2 class="section__title">${T('profile.title')}</h2>
        <div class="section__subtitle">${T('profile.subtitle')}</div>
      </div>
    </div>
    <div class="table-card" style="max-width:560px">
      <div class="profile-info">
        <div class="profile-avatar">${escape(u.fio[0] || '?')}</div>
        <div>
          <div style="font-size:13px;color:var(--c-muted)">${T('profile.login')}</div>
          <div style="font-weight:600">${escape(u.login)}</div>
        </div>
        <div>
          <div style="font-size:13px;color:var(--c-muted)">${T('profile.role')}</div>
          <div style="font-weight:600">${escape(u.rol_nazvanie)}</div>
        </div>
        <div>
          <div style="font-size:13px;color:var(--c-muted)">${T('profile.division')}</div>
          <div style="font-weight:600">${escape(u.podrazdelenie_nazvanie)}</div>
        </div>
      </div>
      <hr style="border:none;border-top:1px solid var(--c-border);margin:20px 0">
      <h3 style="margin-bottom:14px">${T('profile.edit')}</h3>
      <div class="form-grid">
        <label class="full">${T('auth.fio')}
          <input type="text" id="pfFio" value="${escape(u.fio)}" />
        </label>
        <label class="full">${T('profile.old_pass')}
          <input type="password" id="pfOldPwd" autocomplete="current-password" />
        </label>
        <label class="full">${T('profile.new_pass')}
          <input type="password" id="pfNewPwd" autocomplete="new-password" />
        </label>
        <label class="full">${T('auth.password_confirm')}
          <input type="password" id="pfNewPwd2" autocomplete="new-password" />
        </label>
      </div>
      <div style="margin-top:16px;display:flex;gap:10px">
        <button class="btn dark" id="pfSave">${T('common.save')}</button>
      </div>
    </div>
  `;

  $('#pfSave').onclick = async () => {
    const fio = $('#pfFio').value.trim();
    const old_password = $('#pfOldPwd').value;
    const new_password = $('#pfNewPwd').value;
    const new_password2 = $('#pfNewPwd2').value;

    if (new_password && new_password !== new_password2) {
      return toast(T('profile.pwd_mismatch'), 'error');
    }

    try {
      const body = { fio };
      if (new_password) {
        body.old_password = old_password;
        body.new_password = new_password;
      }
      const updated = await api('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      Object.assign(CURRENT_USER, updated);
      $('#userName').textContent = updated.fio;
      $('#userAvatar').textContent = updated.fio[0] || '?';
      toast(T('profile.saved'), 'success');
      $('#pfOldPwd').value = '';
      $('#pfNewPwd').value = '';
      $('#pfNewPwd2').value = '';
    } catch (e) {
      toast(e.message, 'error');
    }
  };
}

/* =========================================================
   1. ДАШБОРД
   ========================================================= */
async function renderDashboard(root) {
  const role = CURRENT_USER?.rol_nazvanie;
  // Главный механик видит свой дашборд с заявками/ремонтами
  if (role === 'Главный механик') {
    return renderMechanicDashboard(root);
  }
  const year = new Date().getFullYear();
  const data = await api(`/api/finance/reports/dashboard?god=${year}`);

  // Месяцы — короткие, через Intl чтобы локализовалось автоматически.
  const monthNames = Array.from({ length: 12 }, (_, i) =>
    new Date(2000, i, 1).toLocaleDateString(LOC(), { month: 'short' })
  );
  const kpi = data.kpi;
  const tickColor = getComputedStyle(document.documentElement).getPropertyValue('--c-muted').trim();
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--c-border').trim();

  const deltaArrow =
    kpi.delta_pct == null ? '' :
    kpi.delta_pct > 0 ? `<span class="kpi-card__hint up">${T('dashboard.delta_up',   { n: kpi.delta_pct })}</span>` :
                        `<span class="kpi-card__hint down">${T('dashboard.delta_down', { n: kpi.delta_pct })}</span>`;

  root.innerHTML = `
    <div class="section__head">
      <div>
        <h2 class="section__title">${T('dashboard.title')}</h2>
        <div class="section__subtitle">${T('dashboard.subtitle', { year })}</div>
      </div>
    </div>

    <div class="cards-grid">
      <div class="kpi-card">
        <div class="kpi-card__label">${T('dashboard.kpi_month')}</div>
        <div class="kpi-card__value">${fmtMoney(kpi.tek_mesyats)}</div>
        ${deltaArrow}
      </div>
      <div class="kpi-card">
        <div class="kpi-card__label">${T('dashboard.kpi_plan')}</div>
        <div class="kpi-card__value">${fmtMoney(kpi.plan_god)}</div>
        <div class="kpi-card__hint">${T('dashboard.fact')}: ${fmtMoney(kpi.fakt_god)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card__label">${T('dashboard.kpi_dev')}</div>
        <div class="kpi-card__value" style="color: ${kpi.otklonenie_god < 0 ? 'var(--c-bad)' : 'var(--c-good)'}">
          ${kpi.otklonenie_god < 0 ? '−' : '+'}${fmtMoney(Math.abs(kpi.otklonenie_god))}
        </div>
        <div class="kpi-card__hint">${kpi.otklonenie_god < 0 ? T('dashboard.over') : T('dashboard.left')}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card__label">${T('dashboard.kpi_top')}</div>
        <div class="kpi-card__value">${data.top_ts.length}</div>
        <div class="kpi-card__hint">${T('dashboard.tco_top_hint')}</div>
      </div>
    </div>

    <div class="charts-row">
      <div class="chart-card">
        <h3>${T('dashboard.dynamics')}</h3>
        <canvas id="dynChart"></canvas>
      </div>
      <div class="chart-card">
        <h3>${T('dashboard.structure')}</h3>
        <canvas id="pieChart"></canvas>
      </div>
    </div>

    <div class="table-card">
      <h3>${T('dashboard.top5')}</h3>
      <table class="tbl">
        <thead><tr>
          <th>${T('tco.col_plate')}</th><th>${T('tco.col_model')}</th><th>${T('tco.col_division')}</th>
          <th class="num">${T('tco.col_repairs')}</th><th class="num">${T('tco.col_tco')}</th>
        </tr></thead>
        <tbody>
          ${data.top_ts.map(t => `
            <tr>
              <td><strong>${escape(t.gos_nomer)}</strong></td>
              <td>${escape(t.marka)} ${escape(t.model)}</td>
              <td>${escape(t.podrazdelenie)}</td>
              <td class="num">${t.kolvo_remontov}</td>
              <td class="num"><strong>${fmtMoney(t.tco)}</strong></td>
            </tr>
          `).join('') || `<tr><td colspan="5" class="empty">${T('common.no_data')}</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  // Линейный график
  CURRENT_CHARTS.push(new Chart($('#dynChart'), {
    type: 'line',
    data: {
      labels: data.dynamics.map(d => monthNames[d.mesyats - 1]),
      datasets: [
        { label: T('cat.remont'),    data: data.dynamics.map(d => +d.remont),    borderColor: '#b89460', backgroundColor: 'rgba(184,148,96,.15)', fill: true, tension: .35 },
        { label: T('cat.zapchasti'), data: data.dynamics.map(d => +d.zapchasti), borderColor: '#2f5a9c', backgroundColor: 'rgba(47,90,156,.10)',  fill: true, tension: .35 },
        { label: T('cat.topliv'),    data: data.dynamics.map(d => +d.topliv),    borderColor: '#2f8f5e', backgroundColor: 'rgba(47,143,94,.10)',  fill: true, tension: .35 },
        { label: T('cat.prochee'),   data: data.dynamics.map(d => +d.prochee),   borderColor: '#b94a48', backgroundColor: 'rgba(185,74,72,.10)',  fill: true, tension: .35 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, color: tickColor } } },
      scales: {
        x: { ticks: { color: tickColor }, grid: { color: gridColor } },
        y: { ticks: { color: tickColor, callback: v => Intl.NumberFormat(LOC(), { notation: 'compact' }).format(v) }, grid: { color: gridColor } },
      },
    },
  }));

  // Pie
  CURRENT_CHARTS.push(new Chart($('#pieChart'), {
    type: 'doughnut',
    data: {
      labels: data.struktura.map(s => catLabel(s.kategoriya)),
      datasets: [{
        data: data.struktura.map(s => +s.summa),
        backgroundColor: ['#b89460','#2f5a9c','#2f8f5e','#b94a48','#c69317','#776e63','#9b6b9b'],
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, color: tickColor } } },
    },
  }));
}

/* =========================================================
   2. РЕЕСТР РАСХОДОВ
   ========================================================= */
async function renderExpenses(root) {
  root.innerHTML = `
    <div class="section__head">
      <div>
        <h2 class="section__title">${T('expenses.title')}</h2>
        <div class="section__subtitle">${T('expenses.subtitle')}</div>
      </div>
      <button class="btn dark" id="addExpenseBtn">${T('expenses.add')}</button>
    </div>

    <div class="filters">
      <label>${T('filter.from')} <input type="date" id="fFrom" /></label>
      <label>${T('filter.to')}   <input type="date" id="fTo" /></label>
      <label>${T('filter.category')}
        <select id="fKat">
          <option value="">${T('common.all')}</option>
          <option value="remont">${T('cat.remont')}</option>
          <option value="zapchasti">${T('cat.zapchasti')}</option>
          <option value="topliv">${T('cat.topliv')}</option>
          <option value="strakhovka">${T('cat.strakhovka')}</option>
          <option value="nalog">${T('cat.nalog')}</option>
          <option value="moyka">${T('cat.moyka')}</option>
          <option value="prochee">${T('cat.prochee')}</option>
        </select>
      </label>
      <label>${T('filter.source')}
        <select id="fSrc">
          <option value="all">${T('filter.src_all')}</option>
          <option value="prochiy">${T('filter.src_misc')}</option>
          <option value="remont_rabot">${T('filter.src_works')}</option>
          <option value="remont_zapchasti">${T('filter.src_repair_parts')}</option>
        </select>
      </label>
      <div class="spacer"></div>
      <button class="btn" id="applyBtn">${T('common.apply')}</button>
      <button class="btn" id="resetBtn">${T('common.reset')}</button>
    </div>

    <div class="table-card">
      <div id="expensesTbl"><div class="loading-screen"><div class="spinner"></div></div></div>
    </div>
  `;

  async function load() {
    const params = new URLSearchParams();
    if ($('#fFrom').value) params.set('from', $('#fFrom').value);
    if ($('#fTo').value)   params.set('to', $('#fTo').value);
    if ($('#fKat').value)  params.set('kategoriya', $('#fKat').value);
    if ($('#fSrc').value)  params.set('source', $('#fSrc').value);
    params.set('limit', '200');

    const data = await api('/api/finance/expenses?' + params);
    const html = `
      <table class="tbl">
        <thead><tr>
          <th>${T('expenses.col_date')}</th><th>${T('expenses.col_cat')}</th><th>${T('expenses.col_plate')}</th>
          <th>${T('expenses.col_division')}</th><th>${T('expenses.col_desc')}</th><th class="num">${T('expenses.col_sum')}</th><th></th>
        </tr></thead>
        <tbody>
          ${data.items.map(it => `
            <tr>
              <td>${fmtDate(it.data)}</td>
              <td><span class="chip ${chipColor(it.kategoriya)}">${escape(catLabel(it.kategoriya))}</span></td>
              <td>${escape(it.gos_nomer || '—')}</td>
              <td>${escape(it.podrazdelenie_nazvanie || '—')}</td>
              <td>${escape(it.opisanie || '—')}</td>
              <td class="num"><strong>${fmtMoney(it.summa)}</strong></td>
              <td>
                ${it.source === 'prochiy'
                   ? `<button class="btn danger" data-del="${it.source_id}">×</button>`
                   : ''}
              </td>
            </tr>
          `).join('') || `<tr><td colspan="7" class="empty">${T('expenses.empty')}</td></tr>`}
        </tbody>
      </table>
      <div class="tbl-foot">
        <span>${T('expenses.total', { n: data.total })}</span>
        <span>${T('expenses.sum_total', { sum: fmtMoney(data.total_summa) })}</span>
      </div>
    `;
    $('#expensesTbl').innerHTML = html;

    $$('button[data-del]', $('#expensesTbl')).forEach(b => {
      b.onclick = async () => {
        if (!confirm(T('common.confirm_delete'))) return;
        try {
          await api('/api/finance/expenses/' + b.dataset.del, { method: 'DELETE' });
          toast(T('toast.deleted'), 'success');
          load();
        } catch (e) { toast(e.message, 'error'); }
      };
    });
  }

  $('#applyBtn').onclick = load;
  $('#resetBtn').onclick = () => {
    $$('.filters input, .filters select').forEach(el => { el.value = ''; });
    $('#fSrc').value = 'all';
    load();
  };
  $('#addExpenseBtn').onclick = () => openExpenseModal(load);
  load();
}

function chipColor(k) {
  if (k === 'remont') return 'amber';
  if (k === 'zapchasti') return 'blue';
  if (k === 'topliv') return 'green';
  if (k === 'strakhovka' || k === 'nalog') return 'red';
  return '';
}

async function openExpenseModal(onSaved) {
  // Подгружаем подразделения и ТС для select
  const [pd, ts] = await Promise.all([
    api('/api/auth/podrazdeleniya'),
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${TOKEN}` } })
      .then(() => Promise.resolve([])), // ts эндпоинта пока нет — сделаем без него
  ]);

  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `
    <div class="modal">
      <h3>${T('expenses.modal_title')}</h3>
      <div class="form-grid">
        <label class="full">${T('filter.category')}
          <select id="mKat">
            <option value="topliv">${T('cat.topliv')}</option>
            <option value="strakhovka">${T('cat.strakhovka')}</option>
            <option value="nalog">${T('cat.nalog')}</option>
            <option value="moyka">${T('cat.moyka')}</option>
            <option value="prochee">${T('cat.prochee')}</option>
          </select>
        </label>
        <label>${T('expenses.col_date')}
          <input type="date" id="mData" value="${new Date().toISOString().slice(0,10)}" />
        </label>
        <label>${T('expenses.col_sum')}, ₽
          <input type="number" id="mSum" min="1" step="100" />
        </label>
        <label class="full">${T('expenses.col_division')}
          <select id="mPd">
            <option value="">${T('expenses.no_division')}</option>
            ${pd.map(p => `<option value="${p.id}">${escape(p.nazvanie)}</option>`).join('')}
          </select>
        </label>
        <label class="full">${T('expenses.col_desc')}
          <textarea id="mDesc" rows="2"></textarea>
        </label>
      </div>
      <div class="modal-actions">
        <button class="btn" id="mCancel">${T('common.cancel')}</button>
        <button class="btn dark" id="mSave">${T('common.save')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(bg);
  bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
  $('#mCancel', bg).onclick = () => bg.remove();
  $('#mSave', bg).onclick = async () => {
    const body = {
      kategoriya:       $('#mKat', bg).value,
      data:             $('#mData', bg).value,
      summa:            +$('#mSum', bg).value,
      podrazdelenie_id: $('#mPd', bg).value ? +$('#mPd', bg).value : null,
      opisanie:         $('#mDesc', bg).value || null,
    };
    if (!body.summa || !body.data) return toast(T('toast.fill_required'), 'error');
    try {
      await api('/api/finance/expenses', { method: 'POST', body: JSON.stringify(body) });
      toast(T('toast.expense_added'), 'success');
      bg.remove();
      onSaved && onSaved();
    } catch (e) { toast(e.message, 'error'); }
  };
}

/* =========================================================
   3. БЮДЖЕТЫ (план/факт)
   ========================================================= */
async function renderBudgets(root) {
  root.innerHTML = `
    <div class="section__head">
      <div>
        <h2 class="section__title">${T('budgets.title')}</h2>
        <div class="section__subtitle">${T('budgets.subtitle')}</div>
      </div>
    </div>

    <div class="filters">
      <label>${T('filter.year')} <input type="number" id="bGod" value="${new Date().getFullYear()}" min="2020" max="2100" /></label>
      <label>${T('filter.month')}
        <select id="bMes">
          <option value="">${T('common.all')}</option>
          ${[...Array(12).keys()].map(i => `<option value="${i+1}">${i+1}</option>`).join('')}
        </select>
      </label>
      <label>${T('filter.category')}
        <select id="bKat">
          <option value="">${T('common.all')}</option>
          <option value="remont">${T('cat.remont')}</option>
          <option value="zapchasti">${T('cat.zapchasti')}</option>
          <option value="topliv">${T('cat.topliv')}</option>
          <option value="prochee">${T('cat.prochee')}</option>
        </select>
      </label>
      <div class="spacer"></div>
      <button class="btn" id="bApply">${T('common.apply')}</button>
    </div>

    <div class="cards-grid" id="bTotals"></div>

    <div class="table-card">
      <div id="bTbl"></div>
    </div>
  `;

  async function load() {
    const params = new URLSearchParams();
    if ($('#bGod').value) params.set('god', $('#bGod').value);
    if ($('#bMes').value) params.set('mesyats', $('#bMes').value);
    if ($('#bKat').value) params.set('kategoriya', $('#bKat').value);

    const data = await api('/api/finance/budgets/plan-fakt?' + params);

    $('#bTotals').innerHTML = `
      <div class="kpi-card"><div class="kpi-card__label">${T('budgets.kpi_plan')}</div>
        <div class="kpi-card__value">${fmtMoney(data.totals.plan)}</div></div>
      <div class="kpi-card"><div class="kpi-card__label">${T('budgets.kpi_fakt')}</div>
        <div class="kpi-card__value">${fmtMoney(data.totals.fakt)}</div></div>
      <div class="kpi-card"><div class="kpi-card__label">${T('budgets.kpi_dev')}</div>
        <div class="kpi-card__value" style="color: ${data.totals.otklonenie < 0 ? 'var(--c-bad)' : 'var(--c-good)'}">
          ${data.totals.otklonenie < 0 ? '−' : '+'}${fmtMoney(Math.abs(data.totals.otklonenie))}
        </div></div>
      <div class="kpi-card"><div class="kpi-card__label">${T('budgets.kpi_pct')}</div>
        <div class="kpi-card__value">${data.totals.protsent}%</div></div>
    `;

    $('#bTbl').innerHTML = `
      <table class="tbl">
        <thead><tr>
          <th>${T('budgets.col_division')}</th><th>${T('budgets.col_period')}</th><th>${T('budgets.col_cat')}</th>
          <th class="num">${T('budgets.col_plan')}</th><th class="num">${T('budgets.col_fakt')}</th>
          <th class="num">${T('budgets.col_dev')}</th><th class="num">${T('budgets.col_pct')}</th>
        </tr></thead>
        <tbody>
          ${data.items.map(it => `
            <tr>
              <td>${escape(it.podrazdelenie_nazvanie)}</td>
              <td>${it.mesyats}/${it.god}</td>
              <td><span class="chip ${chipColor(it.kategoriya)}">${escape(catLabel(it.kategoriya))}</span></td>
              <td class="num">${fmtMoney(it.plan_summa)}</td>
              <td class="num">${fmtMoney(it.fakt_summa)}</td>
              <td class="num" style="color: ${+it.otklonenie < 0 ? 'var(--c-bad)' : 'var(--c-good)'}">
                ${+it.otklonenie < 0 ? '−' : ''}${fmtMoney(Math.abs(it.otklonenie))}
              </td>
              <td class="num">
                <span class="chip ${+it.protsent_ispolneniya > 100 ? 'red' : 'green'}">
                  ${it.protsent_ispolneniya}%
                </span>
              </td>
            </tr>
          `).join('') || `<tr><td colspan="7" class="empty">${T('budgets.empty')}</td></tr>`}
        </tbody>
      </table>
    `;
  }

  $('#bApply').onclick = load;
  load();
}

/* =========================================================
   4. TCO ПО МАШИНАМ
   ========================================================= */
async function renderTco(root) {
  root.innerHTML = `
    <div class="section__head">
      <div>
        <h2 class="section__title">${T('tco.title')}</h2>
        <div class="section__subtitle">${T('tco.subtitle')}</div>
      </div>
    </div>

    <div class="filters">
      <label>${T('filter.sort')}
        <select id="tSort">
          <option value="tco_desc">${T('tco.sort_tco_desc')}</option>
          <option value="tco_asc">${T('tco.sort_tco_asc')}</option>
          <option value="remontov">${T('tco.sort_repairs')}</option>
          <option value="gos_nomer">${T('tco.sort_plate')}</option>
        </select>
      </label>
      <div class="spacer"></div>
      <button class="btn" id="tApply">${T('common.apply')}</button>
    </div>

    <div id="tDetail"></div>
    <div class="table-card">
      <div id="tList"><div class="loading-screen"><div class="spinner"></div></div></div>
    </div>
  `;

  async function load() {
    const data = await api('/api/finance/reports/tco?sort=' + $('#tSort').value);

    $('#tList').innerHTML = `
      <table class="tbl">
        <thead><tr>
          <th>${T('tco.col_plate')}</th><th>${T('tco.col_model')}</th><th>${T('tco.col_division')}</th>
          <th class="num">${T('tco.col_repairs')}</th>
          <th class="num">${T('tco.col_works')}</th><th class="num">${T('tco.col_parts')}</th>
          <th class="num">${T('tco.col_other')}</th><th class="num">${T('tco.col_tco')}</th>
        </tr></thead>
        <tbody>
          ${data.items.map(t => `
            <tr style="cursor:pointer" data-ts="${t.ts_id}">
              <td><strong>${escape(t.gos_nomer)}</strong></td>
              <td>${escape(t.marka_nazvanie || '')} ${escape(t.model_nazvanie || '')}</td>
              <td>${escape(t.podrazdelenie_nazvanie || '—')}</td>
              <td class="num">${t.kolvo_remontov}</td>
              <td class="num">${fmtMoney(t.itogo_rabot)}</td>
              <td class="num">${fmtMoney(t.itogo_zapchastey)}</td>
              <td class="num">${fmtMoney(t.itogo_prochee)}</td>
              <td class="num"><strong>${fmtMoney(t.tco_obshchee)}</strong></td>
            </tr>
          `).join('') || `<tr><td colspan="8" class="empty">${T('common.no_data')}</td></tr>`}
        </tbody>
      </table>
      <div class="tbl-foot">
        <span>${T('tco.cars_count', { n: data.items.length })}</span>
        <span>${T('tco.tco_total', { sum: fmtMoney(data.totals.tco) })}</span>
      </div>
    `;
    $$('tr[data-ts]').forEach(tr => {
      tr.onclick = () => loadTcoDetail(tr.dataset.ts);
    });
  }

  async function loadTcoDetail(tsId) {
    const d = await api('/api/finance/reports/tco/' + tsId);
    $('#tDetail').innerHTML = `
      <div class="table-card" style="margin-bottom: 14px;">
        <h3>${escape(d.summary.gos_nomer)} — ${escape(d.summary.marka_nazvanie)} ${escape(d.summary.model_nazvanie)}</h3>
        <div class="dtl-grid">
          <div>
            <div class="kpi-card__label">${T('tco.detail_division')}</div>
            <div>${escape(d.summary.podrazdelenie_nazvanie || '—')}</div>
          </div>
          <div>
            <div class="kpi-card__label">${T('tco.detail_orders')}</div>
            <div>${d.summary.kolvo_zayavok} / ${d.summary.kolvo_remontov}</div>
          </div>
          <div>
            <div class="kpi-card__label">${T('tco.detail_total')}</div>
            <div><strong>${fmtMoney(d.summary.tco_obshchee)}</strong></div>
          </div>
          <div>
            <div class="kpi-card__label">${T('tco.detail_breakdown')}</div>
            <div>${fmtMoney(d.summary.itogo_rabot)} / ${fmtMoney(d.summary.itogo_zapchastey)} / ${fmtMoney(d.summary.itogo_prochee)}</div>
          </div>
        </div>
        <h3 style="margin-top:16px">${T('tco.history')}</h3>
        <table class="tbl">
          <thead><tr><th>${T('tco.history_type')}</th><th>${T('tco.history_start')}</th><th>${T('tco.history_end')}</th><th>${T('tco.history_mech')}</th><th class="num">${T('tco.history_total')}</th></tr></thead>
          <tbody>
            ${d.remonty.map(r => `
              <tr>
                <td>${escape(r.tip_remonta)} <span class="chip">${escape(catLabel(r.kategoriya))}</span></td>
                <td>${fmtDate(r.data_nachala)}</td>
                <td>${fmtDate(r.data_okonchaniya)}</td>
                <td>${escape(r.mekhanik || '—')}</td>
                <td class="num"><strong>${fmtMoney(r.itogo)}</strong></td>
              </tr>
            `).join('') || `<tr><td colspan="5" class="empty">${T('tco.history_empty')}</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
    $('#tDetail').scrollIntoView({ behavior: 'smooth' });
  }

  $('#tApply').onclick = load;
  load();
}

/* =========================================================
   5. ПРИХОДЫ ЗАПЧАСТЕЙ
   ========================================================= */
async function renderReceipts(root) {
  root.innerHTML = `
    <div class="section__head">
      <div>
        <h2 class="section__title">${T('receipts.title')}</h2>
        <div class="section__subtitle">${T('receipts.subtitle')}</div>
      </div>
    </div>

    <div class="table-card">
      <div id="rList"><div class="loading-screen"><div class="spinner"></div></div></div>
    </div>
    <div id="rDetail"></div>
  `;

  const data = await api('/api/finance/parts/receipts');
  $('#rList').innerHTML = `
    <table class="tbl">
      <thead><tr>
        <th>${T('receipts.col_date')}</th><th>${T('receipts.col_num')}</th><th>${T('receipts.col_supplier')}</th>
        <th>${T('receipts.col_creator')}</th>
        <th class="num">${T('receipts.col_pos')}</th><th class="num">${T('receipts.col_units')}</th>
        <th class="num">${T('receipts.col_sum')}</th>
      </tr></thead>
      <tbody>
        ${data.map(r => `
          <tr style="cursor:pointer" data-id="${r.id}">
            <td>${fmtDate(r.data_prikhoda)}</td>
            <td><strong>${escape(r.nomer_nakl || '—')}</strong></td>
            <td>${escape(r.postavshik_nazvanie)}</td>
            <td>${escape(r.sozdatel_fio || '—')}</td>
            <td class="num">${r.kolvo_pozitsiy}</td>
            <td class="num">${r.itogo_edinic}</td>
            <td class="num"><strong>${fmtMoney(r.summa_obshaya)}</strong></td>
          </tr>
        `).join('') || `<tr><td colspan="7" class="empty">${T('receipts.empty')}</td></tr>`}
      </tbody>
    </table>
  `;

  $$('tr[data-id]').forEach(tr => {
    tr.onclick = async () => {
      const d = await api('/api/finance/parts/receipts/' + tr.dataset.id);
      $('#rDetail').innerHTML = `
        <div class="table-card" style="margin-top: 14px;">
          <h3>${T('receipts.detail_title', { n: escape(d.nomer_nakl || d.id) })}</h3>
          <div class="dtl-grid">
            <div><div class="kpi-card__label">${T('receipts.detail_sup')}</div><div>${escape(d.postavshik_nazvanie)}</div></div>
            <div><div class="kpi-card__label">${T('receipts.detail_date')}</div><div>${fmtDate(d.data_prikhoda)}</div></div>
            <div><div class="kpi-card__label">${T('receipts.detail_creator')}</div><div>${escape(d.sozdatel_fio || '—')}</div></div>
            <div><div class="kpi-card__label">${T('receipts.detail_sum')}</div><div><strong>${fmtMoney(d.summa_obshaya)}</strong></div></div>
          </div>
          ${d.kommentariy ? `<div style="color:var(--c-muted);font-style:italic;margin-bottom:10px">${escape(d.kommentariy)}</div>` : ''}
          <table class="tbl">
            <thead><tr>
              <th>${T('receipts.pos_part')}</th><th>${T('receipts.pos_sku')}</th>
              <th class="num">${T('receipts.pos_qty')}</th><th class="num">${T('receipts.pos_price')}</th><th class="num">${T('receipts.pos_total')}</th>
            </tr></thead>
            <tbody>
              ${d.pozitsii.map(p => `
                <tr>
                  <td>${escape(p.naimenovanie)}</td>
                  <td>${escape(p.artikul || '—')}</td>
                  <td class="num">${p.kolichestvo}</td>
                  <td class="num">${fmtMoney(p.tsena_za_edinicu)}</td>
                  <td class="num"><strong>${fmtMoney(p.itogo_pozitsii)}</strong></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
      $('#rDetail').scrollIntoView({ behavior: 'smooth' });
    };
  });
}

/* =========================================================
   6. АУДИТ-ЛОГ
   ========================================================= */
async function renderAudit(root) {
  root.innerHTML = `
    <div class="section__head">
      <div>
        <h2 class="section__title">${T('audit.title')}</h2>
        <div class="section__subtitle">${T('audit.subtitle')}</div>
      </div>
    </div>
    <div class="table-card">
      <div id="aTbl"><div class="loading-screen"><div class="spinner"></div></div></div>
    </div>
  `;

  const data = await api('/api/finance/audit-log?limit=200');
  $('#aTbl').innerHTML = `
    <table class="tbl">
      <thead><tr>
        <th>${T('audit.col_when')}</th><th>${T('audit.col_user')}</th><th>${T('audit.col_role')}</th>
        <th>${T('audit.col_op')}</th><th>${T('audit.col_obj')}</th>
        <th class="num">${T('audit.col_sum')}</th><th>${T('audit.col_comment')}</th>
      </tr></thead>
      <tbody>
        ${data.items.map(it => `
          <tr>
            <td>${fmtDateTime(it.data_operatsii)}</td>
            <td><strong>${escape(it.sotrudnik_fio || '—')}</strong></td>
            <td>${escape(it.sotrudnik_rol || '—')}</td>
            <td><span class="chip blue">${escape(it.tip_operatsii)}</span></td>
            <td>${escape(it.obyekt_tablitsa || '')}${it.obyekt_id ? ' #' + it.obyekt_id : ''}</td>
            <td class="num">${it.summa ? fmtMoney(it.summa) : '—'}</td>
            <td>${escape(it.kommentariy || '')}</td>
          </tr>
        `).join('') || `<tr><td colspan="7" class="empty">${T('audit.empty')}</td></tr>`}
      </tbody>
    </table>
    <div class="tbl-foot">
      <span>${T('audit.records', { n: data.total })}</span>
    </div>
  `;
}

/* =========================================================
   ДАШБОРД ГЛАВНОГО МЕХАНИКА (заявки + ремонты)
   ========================================================= */
async function renderMechanicDashboard(root) {
  // Загружаем данные о заявках и ремонтах параллельно
  const [zData, rData] = await Promise.all([
    api('/api/zayavki?limit=200').catch(() => ({ items: [], total: 0 })),
    api('/api/remonty/my').catch(() => ({ items: [] })),
  ]);

  const allZ = zData.items || [];
  const allR = rData.items || [];

  const zNew     = allZ.filter(z => z.status === 'новая').length;
  const zInWork  = allZ.filter(z => z.status === 'в работе').length;
  const zDone    = allZ.filter(z => z.status === 'завершена').length;
  const rOpen    = allR.filter(r => !r.data_okonchaniya).length;
  const rClosed  = allR.filter(r => r.data_okonchaniya).length;

  root.innerHTML = `
    <div class="section__head">
      <div>
        <h2 class="section__title">${T('dashboard.title')}</h2>
        <div class="section__subtitle">${T('dashboard.mech_subtitle')}</div>
      </div>
    </div>

    <div class="cards-grid">
      <div class="kpi-card">
        <div class="kpi-card__label">${T('dashboard.mech_new')}</div>
        <div class="kpi-card__value" style="color:var(--warning,#e5a00d)">${zNew}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card__label">${T('dashboard.mech_inwork')}</div>
        <div class="kpi-card__value" style="color:var(--accent)">${zInWork}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card__label">${T('dashboard.mech_done')}</div>
        <div class="kpi-card__value" style="color:var(--c-good,#2f8f5e)">${zDone}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card__label">${T('dashboard.mech_repairs_open')}</div>
        <div class="kpi-card__value">${rOpen}</div>
      </div>
    </div>

    <div class="table-card" style="margin-top:18px">
      <h3 style="margin-bottom:10px">${T('dashboard.mech_recent')}</h3>
      <table class="tbl">
        <thead><tr>
          <th>#</th><th>${T('dashboard.mech_col_plate')}</th><th>${T('dashboard.mech_col_type')}</th>
          <th>${T('dashboard.mech_col_status')}</th><th>${T('dashboard.mech_col_date')}</th>
        </tr></thead>
        <tbody>
          ${allZ.slice(0, 15).map(z => `
            <tr>
              <td><strong>${z.id}</strong></td>
              <td>${escape(z.gos_nomer || '—')}</td>
              <td>${escape(z.tip_remonta || '—')}</td>
              <td><span class="chip ${z.status === 'новая' ? 'gold' : z.status === 'в работе' ? 'blue' : 'green'}">${escape(z.status)}</span></td>
              <td>${fmtDate(z.data_sozdaniya)}</td>
            </tr>
          `).join('') || `<tr><td colspan="5" class="empty">${T('common.no_data')}</td></tr>`}
        </tbody>
      </table>
    </div>

    ${allR.length ? `
    <div class="table-card" style="margin-top:18px">
      <h3 style="margin-bottom:10px">${T('dashboard.mech_repairs')}</h3>
      <table class="tbl">
        <thead><tr>
          <th>#</th><th>${T('dashboard.mech_col_plate')}</th><th>${T('dashboard.mech_col_type')}</th>
          <th>${T('dashboard.mech_col_status')}</th><th>${T('dashboard.mech_col_date')}</th>
        </tr></thead>
        <tbody>
          ${allR.slice(0, 10).map(r => `
            <tr>
              <td><strong>${r.zayavka_id}</strong></td>
              <td>${escape(r.gos_nomer || '—')}</td>
              <td>${escape(r.tip_remonta || '—')}</td>
              <td><span class="chip ${r.data_okonchaniya ? 'green' : 'blue'}">${r.data_okonchaniya ? T('dashboard.mech_closed') : T('dashboard.mech_inprogress')}</span></td>
              <td>${fmtDate(r.data_nachala)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}
  `;
}

/* ----------------- Bootstrap ----------------- */
loadUser()
  .then(navigate)
  .catch(e => {
    console.error(e);
    $('#content').innerHTML = `<div class="empty">${T('toast.auth_error')}: ${escape(e.message)}</div>`;
  });
