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

/* ----------------- Styled confirm dialog ----------------- */
function confirmDialog(text, { title, icon = '⚠️', danger = true } = {}) {
  return new Promise(resolve => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `
      <div class="confirm-dialog">
        <div class="confirm-dialog__icon">${icon}</div>
        <div class="confirm-dialog__title">${title || T('common.confirm_delete')}</div>
        <div class="confirm-dialog__text">${text}</div>
        <div class="confirm-dialog__actions">
          <button class="btn" id="cdCancel">${T('common.cancel')}</button>
          <button class="btn ${danger ? 'danger' : 'dark'}" id="cdOk">${danger ? T('common.delete') : 'OK'}</button>
        </div>
      </div>`;
    document.body.appendChild(bg);
    bg.querySelector('.confirm-dialog').setAttribute('role', 'alertdialog');
    bg.querySelector('.confirm-dialog').setAttribute('aria-modal', 'true');
    bg.querySelector('#cdCancel').onclick = () => { bg.remove(); resolve(false); };
    bg.querySelector('#cdOk').onclick    = () => { bg.remove(); resolve(true); };
    bg.addEventListener('click', e => { if (e.target === bg) { bg.remove(); resolve(false); } });
    trapFocus(bg.querySelector('.confirm-dialog'));
  });
}
window.confirmDialog = confirmDialog;

/* ----------------- Nav badge notifications ----------------- */
let _badgeTimer = null;
async function refreshNavBadges() {
  try {
    const role = CURRENT_USER?.rol_nazvanie;
    if (!role) return;
    const allowed = ['Директор','Аналитик','Главный механик','Диспетчер'];
    if (!allowed.includes(role)) return;

    const [zData, bData] = await Promise.all([
      api('/api/zayavki?limit=1&status=1').catch(() => null),
      api('/api/finance/budgets/plan-fakt?god=' + new Date().getFullYear()).catch(() => null),
    ]);

    // Заявки: кол-во со статусом «Новая» (status_id=1)
    const newCount = zData?.total || 0;
    setBadge('requests', newCount);

    // Бюджеты: кол-во месяцев с превышением плана
    let overCount = 0;
    if (Array.isArray(bData)) {
      bData.forEach(r => { if (Number(r.fakt_summa) > Number(r.plan_summa) && Number(r.plan_summa) > 0) overCount++; });
    }
    setBadge('budgets', overCount);
  } catch (_) { /* silent */ }
}
function setBadge(section, count) {
  const link = document.querySelector(`.nav__item[data-section="${section}"]`);
  if (!link) return;
  let badge = link.querySelector('.nav-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'nav-badge';
    link.appendChild(badge);
  }
  badge.textContent = count > 0 ? (count > 99 ? '99+' : count) : '';
}
function startBadgePolling() {
  refreshNavBadges();
  _badgeTimer = setInterval(refreshNavBadges, 60000);
}
function stopBadgePolling() { if (_badgeTimer) clearInterval(_badgeTimer); }

/* ----------------- Pagination helper ----------------- */
function renderPager(container, { total, limit, offset, onChange }) {
  const pages = Math.ceil(total / limit);
  if (pages <= 1) { container.innerHTML = ''; return; }
  const curPage = Math.floor(offset / limit);

  let html = `<button class="pager__btn" data-p="0" ${curPage === 0 ? 'disabled' : ''}>«</button>`;
  const range = 2;
  for (let p = 0; p < pages; p++) {
    if (p === 0 || p === pages - 1 || (p >= curPage - range && p <= curPage + range)) {
      html += `<button class="pager__btn ${p === curPage ? 'active' : ''}" data-p="${p}">${p + 1}</button>`;
    } else if (p === curPage - range - 1 || p === curPage + range + 1) {
      html += `<span class="pager__info">…</span>`;
    }
  }
  html += `<button class="pager__btn" data-p="${pages - 1}" ${curPage === pages - 1 ? 'disabled' : ''}>»</button>`;
  container.innerHTML = html;
  container.querySelectorAll('.pager__btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.dataset.p, 10);
      if (!isNaN(p)) onChange(p * limit);
    });
  });
}
window.renderPager = renderPager;

/* ----------------- Form validation utility ----------------- */
function validateForm(container, rules) {
  container.querySelectorAll('.field-error').forEach(el => el.classList.remove('field-error'));
  container.querySelectorAll('.field-error-msg').forEach(el => el.remove());
  let valid = true;
  for (const { selector, message } of rules) {
    const el = container.querySelector(selector);
    if (!el) continue;
    const val = el.value?.trim();
    const isEmpty = !val || val === '0';
    if (isEmpty) {
      const label = el.closest('label') || el.parentElement;
      label.classList.add('field-error');
      const msg = document.createElement('span');
      msg.className = 'field-error-msg';
      msg.textContent = message || T('validate.required') || 'Обязательное поле';
      label.appendChild(msg);
      el.addEventListener('input', () => {
        label.classList.remove('field-error');
        label.querySelector('.field-error-msg')?.remove();
      }, { once: true });
      el.addEventListener('change', () => {
        label.classList.remove('field-error');
        label.querySelector('.field-error-msg')?.remove();
      }, { once: true });
      valid = false;
    }
  }
  return valid;
}
window.validateForm = validateForm;

/* ----------------- Accessibility: Escape & focus-trap ----------------- */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const modal = document.querySelector('.modal-bg');
    if (modal) { modal.remove(); e.preventDefault(); }
  }
});
function trapFocus(container) {
  const focusable = container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  container.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    if (e.shiftKey) {
      if (document.activeElement === first) { last.focus(); e.preventDefault(); }
    } else {
      if (document.activeElement === last) { first.focus(); e.preventDefault(); }
    }
  });
  first.focus();
}
window.trapFocus = trapFocus;

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
    let msg = data.error || `HTTP ${res.status}`;
    if (res.status === 400) msg = `Ошибка валидации: ${msg}`;
    if (res.status === 429) msg = `Лимит запросов: ${msg}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ----------------- Avatar helpers ----------------- */
function updateSidebarAvatar(user) {
  const el = $('#userAvatar');
  if (user.avatar_url) {
    el.innerHTML = `<img src="${user.avatar_url}?t=${Date.now()}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else {
    el.textContent = user.fio[0] || '?';
  }
}
window.updateSidebarAvatar = updateSidebarAvatar;

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
  updateSidebarAvatar(CURRENT_USER);

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
  const roleCls = {
    'Директор': 'director', 'Аналитик': 'analyst', 'Главный механик': 'chief',
    'Механик': 'mechanic', 'Диспетчер': 'dispatch', 'Пользователь': 'user',
  }[u.rol_nazvanie] || 'user';

  root.innerHTML = `
    <div class="pf">
      <!-- Hero card -->
      <div class="pf-hero">
        <div class="pf-hero__bg"></div>
        <div class="pf-hero__body">
          <div class="pf-avatar-wrap">
            <div class="pf-avatar pf-avatar--${roleCls}" id="pfAvatarPreview">
              ${u.avatar_url
                ? `<img src="${u.avatar_url}?t=${Date.now()}" alt="">`
                : `<span>${escape(u.fio[0] || '?')}</span>`}
            </div>
            <div class="pf-avatar-overlay" id="pfAvatarOverlay" title="${T('profile.avatar_change')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            </div>
            <input type="file" id="pfAvatarInput" accept="image/jpeg,image/png,image/gif,image/webp" hidden />
            ${u.avatar_url ? `<button class="pf-avatar-del" id="pfAvatarDel" title="${T('profile.avatar_delete')}">×</button>` : ''}
          </div>
          <h2 class="pf-hero__name">${escape(u.fio)}</h2>
          <span class="role-badge role-badge--${roleCls}" style="font-size:11px;padding:3px 12px">${escape(u.rol_nazvanie)}</span>
          <div class="pf-meta">
            <div class="pf-meta__item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              <div>
                <div class="pf-meta__label">${T('profile.login')}</div>
                <div class="pf-meta__value">${escape(u.login)}</div>
              </div>
            </div>
            <div class="pf-meta__item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M3 3h18v4H3zM3 11h18v4H3zM3 19h18v2H3z"/></svg>
              <div>
                <div class="pf-meta__label">${T('profile.division')}</div>
                <div class="pf-meta__value">${escape(u.podrazdelenie_nazvanie)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Settings card -->
      <div class="pf-card">
        <div class="pf-card__header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="22" height="22"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.68 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.85.997 1.51 1.08H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          <h3>${T('profile.edit')}</h3>
        </div>
        <div class="pf-form">
          <label class="pf-field">
            <span class="pf-field__label">${T('auth.fio')}</span>
            <div class="pf-field__wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="18" height="18"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              <input type="text" id="pfFio" value="${escape(u.fio)}" />
            </div>
          </label>
          <div class="pf-divider"><span>${T('profile.change_pass')}</span></div>
          <label class="pf-field">
            <span class="pf-field__label">${T('profile.old_pass')}</span>
            <div class="pf-field__wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="18" height="18"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              <input type="password" id="pfOldPwd" autocomplete="current-password" placeholder="••••••" />
            </div>
          </label>
          <div class="pf-row">
            <label class="pf-field">
              <span class="pf-field__label">${T('profile.new_pass')}</span>
              <div class="pf-field__wrap">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="18" height="18"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                <input type="password" id="pfNewPwd" autocomplete="new-password" placeholder="••••••" />
              </div>
            </label>
            <label class="pf-field">
              <span class="pf-field__label">${T('auth.password_confirm')}</span>
              <div class="pf-field__wrap">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="18" height="18"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                <input type="password" id="pfNewPwd2" autocomplete="new-password" placeholder="••••••" />
              </div>
            </label>
          </div>
        </div>
        <div class="pf-card__footer">
          <button class="btn dark pf-save" id="pfSave">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            ${T('common.save')}
          </button>
        </div>
      </div>

      <!-- Activity log card -->
      <div class="pf-card" style="grid-column: 1 / -1">
        <div class="pf-card__header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="22" height="22"><polyline points="12 8 12 12 14 14"/><circle cx="12" cy="12" r="10"/></svg>
          <h3>${T('profile.activity') || 'Последние действия'}</h3>
        </div>
        <div id="pfActivity"><div class="loading-screen"><div class="spinner"></div></div></div>
      </div>
    </div>
  `;

  // Load activity log
  api('/api/finance/audit-log/my').then(items => {
    const el = $('#pfActivity');
    if (!items || !items.length) {
      el.innerHTML = `<div class="empty" style="padding:14px">${T('common.no_data')}</div>`;
      return;
    }
    el.innerHTML = `
      <table class="tbl" style="font-size:13px">
        <thead><tr>
          <th>${T('audit.col_when') || 'Когда'}</th>
          <th>${T('audit.col_op') || 'Операция'}</th>
          <th>${T('audit.col_obj') || 'Объект'}</th>
          <th class="num">${T('audit.col_sum') || 'Сумма'}</th>
          <th>${T('audit.col_comment') || 'Комментарий'}</th>
        </tr></thead>
        <tbody>
          ${items.map(it => `
            <tr>
              <td>${fmtDateTime(it.data_operatsii)}</td>
              <td><span class="chip blue">${escape(it.tip_operatsii)}</span></td>
              <td>${escape(it.obyekt_tablitsa || '')}${it.obyekt_id ? ' #' + it.obyekt_id : ''}</td>
              <td class="num">${it.summa ? fmtMoney(it.summa) : '—'}</td>
              <td>${escape(it.kommentariy || '—')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }).catch(() => {
    const el = $('#pfActivity');
    if (el) el.innerHTML = `<div class="empty" style="padding:14px">${T('common.no_data')}</div>`;
  });

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
      updateSidebarAvatar(updated);
      toast(T('profile.saved'), 'success');
      $('#pfOldPwd').value = '';
      $('#pfNewPwd').value = '';
      $('#pfNewPwd2').value = '';
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  // Avatar upload
  $('#pfAvatarOverlay').onclick = () => $('#pfAvatarInput').click();
  $('#pfAvatarInput').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('avatar', file);
    try {
      const res = await fetch('/api/auth/avatar', {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      Object.assign(CURRENT_USER, data);
      updateSidebarAvatar(data);
      toast(T('profile.avatar_ok'), 'success');
      renderProfile(root); // re-render
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  // Avatar delete
  const delBtn = $('#pfAvatarDel');
  if (delBtn) {
    delBtn.onclick = async () => {
      if (!await confirmDialog(T('profile.avatar_confirm'), { icon: '🗑️' })) return;
      try {
        const data = await api('/api/auth/avatar', { method: 'DELETE' });
        Object.assign(CURRENT_USER, data);
        updateSidebarAvatar(data);
        toast(T('profile.avatar_removed'), 'success');
        renderProfile(root);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }
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
  // Аналитик видит расширенный аналитический дашборд
  if (role === 'Аналитик') {
    return renderAnalystDashboard(root);
  }
  const year = new Date().getFullYear();
  const pds = await api('/api/auth/podrazdeleniya').catch(() => []);

  root.innerHTML = `
    <div class="section__head">
      <div>
        <h2 class="section__title">${T('dashboard.title')}</h2>
        <div class="section__subtitle">${T('dashboard.subtitle', { year })}</div>
      </div>
    </div>
    <div class="filters" style="margin-bottom:14px">
      <label>${T('filter.division') || 'Подразделение'}
        <select id="dPd">
          <option value="">${T('common.all') || 'Все'}</option>
          ${pds.map(p => `<option value="${p.id}">${p.nazvanie}</option>`).join('')}
        </select>
      </label>
    </div>
    <div id="dashContent"><div class="loading-screen"><div class="spinner"></div></div></div>
  `;

  async function loadDash() {
    // Destroy previous charts
    CURRENT_CHARTS.forEach(c => c.destroy());
    CURRENT_CHARTS.length = 0;

    const pdId = $('#dPd').value;
    const qs = `god=${year}${pdId ? '&podrazdelenie_id=' + pdId : ''}`;
    const data = await api(`/api/finance/reports/dashboard?${qs}`);

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

    $('#dashContent').innerHTML = `

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

  $('#dPd').onchange = loadDash;
  loadDash();
}

/* =========================================================
   2. РЕЕСТР РАСХОДОВ
   ========================================================= */
async function renderExpenses(root) {
  const PAGE_SIZE = 30;
  let currentOffset = 0;

  root.innerHTML = `
    <div class="section__head">
      <div>
        <h2 class="section__title">${T('expenses.title')}</h2>
        <div class="section__subtitle">${T('expenses.subtitle')}</div>
      </div>
      <button class="btn dark" id="addExpenseBtn">${T('expenses.add')}</button>
    </div>

    <div class="filters">
      <input type="text" class="search-input" id="fSearch" placeholder="${T('common.search') || 'Поиск…'}" />
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
      <div id="expPager" class="pager"></div>
    </div>
  `;

  async function load() {
    const params = new URLSearchParams();
    if ($('#fSearch').value.trim()) params.set('q', $('#fSearch').value.trim());
    if ($('#fFrom').value) params.set('from', $('#fFrom').value);
    if ($('#fTo').value)   params.set('to', $('#fTo').value);
    if ($('#fKat').value)  params.set('kategoriya', $('#fKat').value);
    if ($('#fSrc').value)  params.set('source', $('#fSrc').value);
    params.set('limit', PAGE_SIZE);
    params.set('offset', currentOffset);

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
                   ? `<button class="btn danger" data-del="${it.source_id}" aria-label="${T('common.delete')}">×</button>`
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

    renderPager($('#expPager'), {
      total: data.total, limit: PAGE_SIZE, offset: currentOffset,
      onChange: off => { currentOffset = off; load(); },
    });

    $$('button[data-del]', $('#expensesTbl')).forEach(b => {
      b.onclick = async () => {
        if (!await confirmDialog(T('common.confirm_delete'), { icon: '🗑️' })) return;
        try {
          await api('/api/finance/expenses/' + b.dataset.del, { method: 'DELETE' });
          toast(T('toast.deleted'), 'success');
          load();
        } catch (e) { toast(e.message, 'error'); }
      };
    });
  }

  let _searchTimer;
  $('#fSearch').oninput = () => {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => { currentOffset = 0; load(); }, 350);
  };
  $('#applyBtn').onclick = () => { currentOffset = 0; load(); };
  $('#resetBtn').onclick = () => {
    $$('.filters input, .filters select').forEach(el => { el.value = ''; });
    $('#fSrc').value = 'all';
    currentOffset = 0;
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
  const [pd, tsList] = await Promise.all([
    api('/api/auth/podrazdeleniya'),
    api('/api/zayavki/dict/ts'),
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
        <label class="full">${T('expenses.col_plate')}
          <select id="mTs">
            <option value="">${T('expenses.no_ts') || '— без ТС —'}</option>
            ${tsList.map(t => `<option value="${t.id}" data-pd="${t.podrazdelenie}">${escape(t.gos_nomer)} — ${escape(t.marka)} ${escape(t.model)}</option>`).join('')}
          </select>
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
  bg.querySelector('.modal').setAttribute('role', 'dialog');
  bg.querySelector('.modal').setAttribute('aria-modal', 'true');
  bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
  trapFocus(bg.querySelector('.modal'));
  $('#mCancel', bg).onclick = () => bg.remove();
  $('#mSave', bg).onclick = async () => {
    const rules = [
      { selector: '#mData', message: T('validate.date') || 'Укажите дату' },
      { selector: '#mSum', message: T('validate.sum') || 'Укажите сумму' },
    ];
    if (!validateForm(bg, rules)) return;
    const tsVal = $('#mTs', bg).value;
    if (!tsVal && !$('#mPd', bg).value) {
      return toast(T('expenses.need_ts_or_pd') || 'Укажите ТС или подразделение', 'error');
    }
    const body = {
      kategoriya:       $('#mKat', bg).value,
      data:             $('#mData', bg).value,
      summa:            +$('#mSum', bg).value,
      ts_id:            tsVal ? +tsVal : null,
      podrazdelenie_id: $('#mPd', bg).value ? +$('#mPd', bg).value : null,
      opisanie:         $('#mDesc', bg).value || null,
    };
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

    <div class="chart-card" style="margin-bottom:18px"><canvas id="bChartPF"></canvas></div>

    <div class="table-card">
      <div id="bTbl"></div>
    </div>
  `;

  let chartInstance = null;

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

    // --- Bar chart: план vs факт по месяцам ---
    const monthLabels = [...Array(12)].map((_, i) =>
      new Date(2000, i, 1).toLocaleDateString(LOC(), { month: 'short' })
    );
    const planByMonth = Array(12).fill(0);
    const faktByMonth = Array(12).fill(0);
    data.items.forEach(it => {
      const mi = (it.mesyats || 1) - 1;
      planByMonth[mi] += Number(it.plan_summa) || 0;
      faktByMonth[mi] += Number(it.fakt_summa) || 0;
    });
    if (chartInstance) chartInstance.destroy();
    const ctx = document.getElementById('bChartPF');
    if (ctx) {
      const tickColor = getComputedStyle(document.documentElement).getPropertyValue('--c-muted').trim() || '#888';
      chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: monthLabels,
          datasets: [
            { label: T('budgets.kpi_plan'), data: planByMonth, backgroundColor: 'rgba(56,142,60,.55)', borderRadius: 4 },
            { label: T('budgets.kpi_fakt'), data: faktByMonth, backgroundColor: 'rgba(239,83,80,.55)', borderRadius: 4 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { boxWidth: 12, color: tickColor } } },
          scales: {
            x: { ticks: { color: tickColor } },
            y: { ticks: { color: tickColor, callback: v => fmtMoney(v) }, beginAtZero: true },
          },
        },
      });
      CURRENT_CHARTS.push(chartInstance);
    }
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
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `
      <div class="modal modal--wide" role="dialog" aria-modal="true">
        <div class="be-head">
          <nav class="breadcrumbs" aria-label="Навигация">
            <span class="breadcrumbs__link">${T('tco.title')}</span>
            <span class="breadcrumbs__sep">›</span>
            <span class="breadcrumbs__current">${escape(d.summary.gos_nomer)}</span>
          </nav>
          <button class="btn-close" id="tcoClose" aria-label="Закрыть">×</button>
        </div>
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
        <div style="max-height:50vh;overflow:auto">
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
      </div>
    `;
    document.body.appendChild(bg);
    bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
    bg.querySelector('#tcoClose').onclick = () => bg.remove();
    trapFocus(bg.querySelector('.modal'));
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
      const bg = document.createElement('div');
      bg.className = 'modal-bg';
      bg.innerHTML = `
        <div class="modal modal--wide" role="dialog" aria-modal="true">
          <div class="be-head">
            <nav class="breadcrumbs" aria-label="Навигация">
              <span class="breadcrumbs__link">${T('receipts.title')}</span>
              <span class="breadcrumbs__sep">›</span>
              <span class="breadcrumbs__current">${T('receipts.detail_title', { n: escape(d.nomer_nakl || d.id) })}</span>
            </nav>
            <button class="btn-close" id="rcDetailClose" aria-label="Закрыть">×</button>
          </div>
          <h3>${T('receipts.detail_title', { n: escape(d.nomer_nakl || d.id) })}</h3>
          <div class="dtl-grid">
            <div><div class="kpi-card__label">${T('receipts.detail_sup')}</div><div>${escape(d.postavshik_nazvanie)}</div></div>
            <div><div class="kpi-card__label">${T('receipts.detail_date')}</div><div>${fmtDate(d.data_prikhoda)}</div></div>
            <div><div class="kpi-card__label">${T('receipts.detail_creator')}</div><div>${escape(d.sozdatel_fio || '—')}</div></div>
            <div><div class="kpi-card__label">${T('receipts.detail_sum')}</div><div><strong>${fmtMoney(d.summa_obshaya)}</strong></div></div>
          </div>
          ${d.kommentariy ? `<div style="color:var(--c-muted);font-style:italic;margin-bottom:10px">${escape(d.kommentariy)}</div>` : ''}
          <div style="max-height:50vh;overflow:auto">
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
        </div>
      `;
      document.body.appendChild(bg);
      bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
      bg.querySelector('#rcDetailClose').onclick = () => bg.remove();
      trapFocus(bg.querySelector('.modal'));
    };
  });
}

/* =========================================================
   6. АУДИТ-ЛОГ
   ========================================================= */
async function renderAudit(root) {
  const PAGE_SIZE = 30;
  let currentOffset = 0;

  root.innerHTML = `
    <div class="section__head">
      <div>
        <h2 class="section__title">${T('audit.title')}</h2>
        <div class="section__subtitle">${T('audit.subtitle')}</div>
      </div>
    </div>
    <div class="filters">
      <input type="text" class="search-input" id="aSearch" placeholder="${T('common.search') || 'Поиск…'}" />
    </div>
    <div class="table-card">
      <div id="aTbl"><div class="loading-screen"><div class="spinner"></div></div></div>
      <div id="aPager" class="pager"></div>
    </div>
  `;

  async function load() {
    const params = new URLSearchParams();
    if ($('#aSearch').value.trim()) params.set('q', $('#aSearch').value.trim());
    params.set('limit', PAGE_SIZE);
    params.set('offset', currentOffset);

    const data = await api('/api/finance/audit-log?' + params);
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

    renderPager($('#aPager'), {
      total: data.total, limit: PAGE_SIZE, offset: currentOffset,
      onChange: off => { currentOffset = off; load(); },
    });
  }

  let _searchTimer;
  $('#aSearch').oninput = () => {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => { currentOffset = 0; load(); }, 350);
  };
  load();
}

/* =========================================================
   ДАШБОРД АНАЛИТИКА — расширенная аналитика
   ========================================================= */
async function renderAnalystDashboard(root) {
  const year = new Date().getFullYear();
  const data = await api(`/api/finance/reports/analyst-dashboard?god=${year}`);
  const monthNames = Array.from({ length: 12 }, (_, i) =>
    new Date(2000, i, 1).toLocaleDateString(LOC(), { month: 'short' })
  );
  const tickColor = getComputedStyle(document.documentElement).getPropertyValue('--c-muted').trim();
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--c-border').trim();

  // KPI cards
  const totalMekh = data.mekhaniki.length;
  const busyMekh  = data.mekhaniki.filter(m => m.aktivnyh > 0).length;
  const totalRepairs = data.repair_dynamics.reduce((s, d) => s + d.kolvo, 0);
  const avgAll = data.avg_repair_by_month.length
    ? (data.avg_repair_by_month.reduce((s, d) => s + Number(d.avg_days), 0) / data.avg_repair_by_month.length).toFixed(1)
    : '—';
  const totalStatuses = data.status_summary.reduce((s, d) => s + d.kolvo, 0);

  root.innerHTML = `
    <div class="section__head">
      <div>
        <h2 class="section__title">${T('dashboard.title')}</h2>
        <div class="section__subtitle">${T('dashboard.analyst_subtitle', { year })}</div>
      </div>
    </div>

    <div class="cards-grid">
      <div class="kpi-card">
        <div class="kpi-card__label">${T('dashboard.analyst_mekh')}</div>
        <div class="kpi-card__value">${busyMekh} / ${totalMekh}</div>
        <div class="kpi-card__hint">занято / всего</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card__label">${T('dashboard.analyst_avg')}</div>
        <div class="kpi-card__value">${avgAll}</div>
        <div class="kpi-card__hint">среднее за ${year}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card__label">${T('dashboard.analyst_rdyn')}</div>
        <div class="kpi-card__value">${totalRepairs}</div>
        <div class="kpi-card__hint">завершённых за год</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card__label">${T('dashboard.analyst_statuses')}</div>
        <div class="kpi-card__value">${totalStatuses}</div>
        <div class="kpi-card__hint">всего заявок</div>
      </div>
    </div>

    <div class="charts-row">
      <div class="chart-card">
        <h3>${T('dashboard.analyst_mekh')}</h3>
        <canvas id="aMekhChart"></canvas>
      </div>
      <div class="chart-card">
        <h3>${T('dashboard.analyst_avg')}</h3>
        <canvas id="aAvgChart"></canvas>
      </div>
    </div>

    <div class="charts-row">
      <div class="chart-card">
        <h3>${T('dashboard.analyst_rdyn')}</h3>
        <canvas id="aRepDynChart"></canvas>
      </div>
      <div class="chart-card">
        <h3>${T('dashboard.analyst_statuses')}</h3>
        <canvas id="aStatusChart"></canvas>
      </div>
    </div>

    <div class="table-card">
      <h3>${T('dashboard.analyst_types')}</h3>
      <table class="tbl">
        <thead><tr>
          <th>${T('dashboard.analyst_tip')}</th>
          <th>${T('dashboard.analyst_tip_cat')}</th>
          <th class="num">${T('dashboard.analyst_tip_cnt')}</th>
          <th class="num">${T('dashboard.analyst_tip_sum')}</th>
          <th class="num">${T('dashboard.analyst_tip_avg')}</th>
        </tr></thead>
        <tbody>
          ${data.tip_stats.map(t => `
            <tr>
              <td><strong>${escape(t.tip)}</strong></td>
              <td><span class="chip">${escape(t.kategoriya || '—')}</span></td>
              <td class="num">${t.kolvo}</td>
              <td class="num"><strong>${fmtMoney(t.summa)}</strong></td>
              <td class="num">${t.avg_days ?? '—'}</td>
            </tr>
          `).join('') || `<tr><td colspan="5" class="empty">${T('common.no_data')}</td></tr>`}
        </tbody>
      </table>
    </div>

    <div class="table-card" style="margin-top: 14px">
      <h3>${T('dashboard.analyst_mekh')}</h3>
      <table class="tbl">
        <thead><tr>
          <th>${T('dashboard.analyst_mekh_fio')}</th>
          <th>${T('dashboard.analyst_mekh_div')}</th>
          <th class="num">${T('dashboard.analyst_mekh_act')}</th>
          <th class="num">${T('dashboard.analyst_mekh_30d')}</th>
          <th class="num">${T('dashboard.analyst_mekh_tot')}</th>
        </tr></thead>
        <tbody>
          ${data.mekhaniki.map(m => `
            <tr>
              <td><strong>${escape(m.fio)}</strong></td>
              <td>${escape(m.podrazdelenie)}</td>
              <td class="num"><span class="chip ${m.aktivnyh === 0 ? 'green' : m.aktivnyh > 2 ? 'red' : 'amber'}">${m.aktivnyh}</span></td>
              <td class="num">${m.za_30_dney}</td>
              <td class="num">${m.vsego}</td>
            </tr>
          `).join('') || `<tr><td colspan="5" class="empty">${T('common.no_data')}</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  // Chart 1: Загрузка механиков (bar)
  const mekhLabels = data.mekhaniki.map(m => m.fio.split(' ').slice(0, 2).join(' '));
  CURRENT_CHARTS.push(new Chart($('#aMekhChart'), {
    type: 'bar',
    data: {
      labels: mekhLabels,
      datasets: [
        { label: T('dashboard.analyst_mekh_act'), data: data.mekhaniki.map(m => m.aktivnyh), backgroundColor: '#b89460' },
        { label: T('dashboard.analyst_mekh_30d'), data: data.mekhaniki.map(m => m.za_30_dney), backgroundColor: '#2f5a9c' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, color: tickColor } } },
      scales: {
        x: { ticks: { color: tickColor, maxRotation: 45 }, grid: { color: gridColor } },
        y: { ticks: { color: tickColor, stepSize: 1 }, grid: { color: gridColor }, beginAtZero: true },
      },
    },
  }));

  // Chart 2: Средний срок ремонта по месяцам (line)
  const avgByMonth = Array.from({ length: 12 }, (_, i) => {
    const d = data.avg_repair_by_month.find(r => r.mesyats === i + 1);
    return d ? Number(d.avg_days) : null;
  });
  CURRENT_CHARTS.push(new Chart($('#aAvgChart'), {
    type: 'line',
    data: {
      labels: monthNames,
      datasets: [{
        label: T('dashboard.analyst_avg'),
        data: avgByMonth,
        borderColor: '#2f8f5e',
        backgroundColor: 'rgba(47,143,94,.15)',
        fill: true,
        tension: .35,
        spanGaps: true,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: tickColor }, grid: { color: gridColor } },
        y: { ticks: { color: tickColor }, grid: { color: gridColor }, beginAtZero: true },
      },
    },
  }));

  // Chart 3: Динамика ремонтов по месяцам (stacked bar)
  const repDyn = Array.from({ length: 12 }, (_, i) => {
    const d = data.repair_dynamics.find(r => r.mesyats === i + 1);
    return d || { rabot: 0, zapchastey: 0, kolvo: 0 };
  });
  CURRENT_CHARTS.push(new Chart($('#aRepDynChart'), {
    type: 'bar',
    data: {
      labels: monthNames,
      datasets: [
        { label: T('cat.remont'), data: repDyn.map(d => +d.rabot), backgroundColor: '#b89460' },
        { label: T('cat.zapchasti'), data: repDyn.map(d => +d.zapchastey), backgroundColor: '#2f5a9c' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, color: tickColor } } },
      scales: {
        x: { stacked: true, ticks: { color: tickColor }, grid: { color: gridColor } },
        y: { stacked: true, ticks: { color: tickColor, callback: v => Intl.NumberFormat(LOC(), { notation: 'compact' }).format(v) }, grid: { color: gridColor } },
      },
    },
  }));

  // Chart 4: Заявки по статусам (doughnut)
  const statusColors = ['#b89460', '#2f5a9c', '#2f8f5e', '#b94a48', '#c69317', '#776e63'];
  CURRENT_CHARTS.push(new Chart($('#aStatusChart'), {
    type: 'doughnut',
    data: {
      labels: data.status_summary.map(s => s.status),
      datasets: [{
        data: data.status_summary.map(s => s.kolvo),
        backgroundColor: statusColors.slice(0, data.status_summary.length),
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, color: tickColor } } },
    },
  }));
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

  const zNew     = allZ.filter(z => z.status === 'Новая').length;
  const zInWork  = allZ.filter(z => z.status === 'В работе').length;
  const zDone    = allZ.filter(z => z.status === 'Выполнена').length;
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
              <td><span class="chip ${z.status === 'Новая' ? 'gold' : z.status === 'В работе' ? 'blue' : 'green'}">${escape(z.status)}</span></td>
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
  .then(() => { navigate(); startBadgePolling(); })
  .catch(e => {
    console.error(e);
    $('#content').innerHTML = `<div class="empty">${T('toast.auth_error')}: ${escape(e.message)}</div>`;
  });
