/* ============================================================
   Carvix — модули ролей: Заявки, Распределение, Ремонты.
   Регистрирует разделы requests / dispatch / repairs в
   глобальном роутере window.CARVIX_ROUTES.
   ============================================================ */
(function () {
  'use strict';

  const T   = (k, v) => window.t(k, v);
  const $   = (s, r = document) => r.querySelector(s);
  const $$  = (s, r = document) => [...r.querySelectorAll(s)];

  const ROLE = () => (window.CURRENT_USER?.rol_nazvanie || '');
  const me   = () => window.CURRENT_USER || {};

  // Бэйджи статуса заявки → CSS-класс.
  const STATUS_CLASS = {
    'Новая':              'st-new',
    'В работе':           'st-progress',
    'Выполнена':          'st-done',
    'Отклонена':          'st-rejected',
    'Ожидание запчастей': 'st-waiting',
    'На согласовании':    'st-pending',
  };

  function statusBadge(name) {
    return `<span class="status-badge ${STATUS_CLASS[name] || ''}">${escape(name || '—')}</span>`;
  }
  function escape(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
  }
  function fmtDateTime(s) {
    if (!s) return '—';
    const d = new Date(s);
    return isNaN(d) ? s : d.toLocaleString(window.getLang() === 'en' ? 'en-US' : 'ru-RU',
      { dateStyle: 'short', timeStyle: 'short' });
  }
  function fmtMoney(v) {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(v) || 0) + ' ₽';
  }
  function prio(p) {
    const map = { 1: '🔥 1', 2: '⚠ 2', 3: '3', 4: '4', 5: '5' };
    return map[p] || '—';
  }
  function urgencyBadge(dataRezhima) {
    if (!dataRezhima) return '';
    const now = new Date();
    const deadline = new Date(dataRezhima);
    if (deadline < now) return `<span class="urgency urgency--overdue">${T('requests.urgency_overdue')}</span>`;
    const hoursLeft = (deadline - now) / 36e5;
    if (hoursLeft <= 24) return `<span class="urgency urgency--urgent">${T('requests.urgency_urgent')}</span>`;
    if (hoursLeft <= 72) return `<span class="urgency urgency--soon">${T('requests.urgency_soon', { date: deadline.toLocaleDateString(LOC(), { day:'2-digit', month:'2-digit' }) })}</span>`;
    return '';
  }

  /* ──────────────────────────────────────────────────────────
     1. ЗАЯВКИ — раздел для всех ролей (содержание зависит от роли)
     ────────────────────────────────────────────────────────── */
  async function renderRequests(root) {
    const role = ROLE();
    const isCreator   = ['Пользователь','Диспетчер','Главный механик','Директор'].includes(role);
    const isDispatcher = ['Диспетчер','Главный механик','Директор','Аналитик'].includes(role);
    const PAGE_SIZE = 20;
    let currentOffset = 0;

    root.innerHTML = `
      <div class="section__head">
        <div>
          <h2 class="section__title">${T('requests.title')}</h2>
          <div class="section__subtitle">${T('requests.subtitle.' + (role === 'Пользователь' ? 'user' :
            role === 'Механик' ? 'mech' : 'all'))}</div>
        </div>
        <div class="section__actions">
          ${isCreator ? `<button class="btn dark" id="btnNewReq">+ ${T('requests.new_btn')}</button>` : ''}
        </div>
      </div>

      <div class="filters">
        <input type="text" class="search-input" id="fReqSearch" placeholder="${window.t('common.search') || 'Search…'}" />
        <label>${T('requests.filter_status')}
          <select id="fStatus"><option value="">${T('common.all')}</option></select>
        </label>
        ${role === 'Пользователь' || role === 'Механик' ? '' : `
          <label class="filter-check"><input type="checkbox" id="fMine" /> ${T('requests.only_mine')}</label>
        `}
        <span class="spacer"></span>
        <button class="btn" id="btnReload">↻ ${T('common.refresh')}</button>
      </div>

      <div id="reqList" class="req-list">
        <div class="loading-screen"><div class="spinner"></div></div>
      </div>
      <div id="reqPager" class="pager"></div>
    `;

    const statusy = await window.api('/api/zayavki/dict/statusy');
    const fStatus = $('#fStatus');
    statusy.forEach(s => {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.nazvanie;
      fStatus.appendChild(o);
    });

    async function load() {
      const list = $('#reqList');
      list.innerHTML = `<div class="loading-screen"><div class="spinner"></div></div>`;
      const qs = new URLSearchParams();
      if ($('#fReqSearch').value.trim()) qs.set('q', $('#fReqSearch').value.trim());
      if (fStatus.value) qs.set('status', fStatus.value);
      const fMineEl = $('#fMine');
      if (fMineEl?.checked) qs.set('mine', '1');
      qs.set('limit', PAGE_SIZE);
      qs.set('offset', currentOffset);

      const data = await window.api('/api/zayavki?' + qs);
      const items = data.items || [];
      if (!items.length) {
        list.innerHTML = `<div class="empty">${T('requests.empty')}</div>`;
        $('#reqPager').innerHTML = '';
        return;
      }
      list.innerHTML = items.map(z => `
        <div class="req-card" data-id="${z.id}">
          <div class="req-card__head">
            <div class="req-card__title">
              <strong>#${z.id}</strong> · ${escape(z.tip_remonta)}
              <span class="req-card__plate">${escape(z.gos_nomer)}</span>
              ${urgencyBadge(z.data_rezhima)}
            </div>
            ${statusBadge(z.status)}
          </div>
          <div class="req-card__body">
            <div class="req-card__meta">
              <span title="${T('requests.priority')}">⚑ ${prio(z.prioritet)}</span>
              <span>🚚 ${escape(z.marka)} ${escape(z.model)}</span>
              <span>🏢 ${escape(z.podrazdelenie)}</span>
              <span>👤 ${escape(z.sozdatel_fio)}</span>
              <span>🕒 ${fmtDateTime(z.data_sozdaniya)}</span>
              ${z.mekhanik_fio
                ? `<span class="req-card__mech">🛠 ${escape(z.mekhanik_fio)}</span>`
                : `<span class="req-card__mech req-card__mech--empty">⏳ ${T('requests.unassigned')}</span>`}
            </div>
            ${z.opisanie ? `<div class="req-card__desc">${escape(z.opisanie)}</div>` : ''}
          </div>
          <div class="req-card__actions">
            ${isDispatcher && !z.mekhanik_id && z.status !== 'Выполнена' && z.status !== 'Отклонена'
              ? `<button class="btn btn--accent" data-action="auto" data-id="${z.id}">⚡ ${T('requests.auto_assign')}</button>
                 <button class="btn"            data-action="manual" data-id="${z.id}">${T('requests.assign')}</button>`
              : ''}
            ${isDispatcher && z.status !== 'Выполнена' && z.status !== 'Отклонена'
              ? `<button class="btn btn--ghost" data-action="status" data-id="${z.id}">${T('requests.change_status')}</button>`
              : ''}
            <button class="btn btn--ghost" data-action="open" data-id="${z.id}">${T('common.details')}</button>
          </div>
        </div>
      `).join('');

      window.renderPager($('#reqPager'), {
        total: data.total, limit: PAGE_SIZE, offset: currentOffset,
        onChange: off => { currentOffset = off; load(); },
      });

      // Делегируем клики
      list.querySelectorAll('button[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = +btn.dataset.id;
          const action = btn.dataset.action;
          if (action === 'auto')   autoAssign(id, load);
          if (action === 'manual') openManualAssign(id, load);
          if (action === 'status') openStatusDialog(id, statusy, load);
          if (action === 'open')   openRequestDetails(id);
        });
      });
    }

    let _searchTimer;
    $('#fReqSearch').oninput = () => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => { currentOffset = 0; load(); }, 350);
    };
    fStatus.addEventListener('change', () => { currentOffset = 0; load(); });
    $('#fMine')?.addEventListener('change', () => { currentOffset = 0; load(); });
    $('#btnReload').addEventListener('click', load);
    if (isCreator) {
      $('#btnNewReq').addEventListener('click', () => openCreateRequest(load));
    }
    load();
  }

  /* ──────────────────────────────────────────────────────────
     1.a Создание заявки
     ────────────────────────────────────────────────────────── */
  async function openCreateRequest(onSaved) {
    const [tipy, ts] = await Promise.all([
      window.api('/api/zayavki/dict/tipy-remonta'),
      window.api('/api/zayavki/dict/ts'),
    ]);

    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `
      <div class="modal" style="width: 540px">
        <h3>${T('requests.new_title')}</h3>
        <div class="form-grid">
          ${ts.length === 0 ? `<div class="info-banner" style="margin-bottom:8px">${T('transport.empty') || 'Нет доступного транспорта'}</div>` : `
          <label class="full">${T('requests.ts')}
            <select id="cTs">
              <option value="">—</option>
              ${ts.map(t => `<option value="${t.id}">${escape(t.gos_nomer)} · ${escape(t.marka)} ${escape(t.model)} · ${escape(t.podrazdelenie)}</option>`).join('')}
            </select>
          </label>`}
          <label class="full">${T('requests.tip_remonta')}
            <select id="cTip">
              <option value="">—</option>
              ${tipy.map(t => `<option value="${t.id}">${escape(t.nazvanie)} (${escape(t.kategoriya || '')})</option>`).join('')}
            </select>
          </label>
          <label>${T('requests.priority')}
            <select id="cPrio">
              <option value="1">1 — ${T('requests.prio.urgent')}</option>
              <option value="2">2 — ${T('requests.prio.high')}</option>
              <option value="3" selected>3 — ${T('requests.prio.normal')}</option>
              <option value="4">4 — ${T('requests.prio.low')}</option>
              <option value="5">5 — ${T('requests.prio.deferred')}</option>
            </select>
          </label>
          <label class="full">${T('requests.description')}
            <textarea id="cDesc" rows="3" placeholder="${T('requests.desc_ph')}"></textarea>
          </label>
        </div>
        <div class="modal__actions">
          <button class="btn" id="cCancel">${T('common.cancel')}</button>
          <button class="btn dark" id="cSave">${T('common.save')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(bg);
    bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
    bg.querySelector('#cCancel').onclick = () => bg.remove();
    bg.querySelector('#cSave').onclick = async () => {
      const rules = [
        ...(ts.length ? [{ selector: '#cTs', message: T('validate.ts') || 'Select vehicle' }] : []),
        { selector: '#cTip', message: T('validate.type') || 'Select repair type' },
      ];
      if (!window.validateForm(bg, rules)) return;
      const body = {
        ...(ts.length ? { ts_id: +bg.querySelector('#cTs').value } : {}),
        tip_remonta_id: +bg.querySelector('#cTip').value,
        prioritet: +bg.querySelector('#cPrio').value,
        opisanie: bg.querySelector('#cDesc').value || null,
      };
      try {
        await window.api('/api/zayavki', { method: 'POST', body: JSON.stringify(body) });
        window.toast(T('requests.created'), 'success');
        bg.remove();
        onSaved?.();
      } catch (e) { window.toast(e.message, 'error'); }
    };
  }

  async function openEditRequest(z, onSaved) {
    const [tipy, ts] = await Promise.all([
      window.api('/api/zayavki/dict/tipy-remonta'),
      window.api('/api/zayavki/dict/ts'),
    ]);

    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `
      <div class="modal" style="width: 540px">
        <h3>${T('requests.edit_title') || 'Редактирование заявки'}</h3>
        <div class="form-grid">
          ${ts.length === 0 ? `<div class="info-banner" style="margin-bottom:8px">${T('transport.empty') || 'Нет доступного транспорта'}</div>` : `
          <label class="full">${T('requests.ts')}
            <select id="eTs" ${z.status !== 'Новая' ? 'disabled' : ''}>
              <option value="">—</option>
              ${ts.map(t => `<option value="${t.id}" ${t.id === z.ts_id ? 'selected' : ''}>${escape(t.gos_nomer)} · ${escape(t.marka)} ${escape(t.model)} · ${escape(t.podrazdelenie)}</option>`).join('')}
            </select>
          </label>`}
          <label class="full">${T('requests.tip_remonta')}
            <select id="eTip">
              <option value="">—</option>
              ${tipy.map(t => `<option value="${t.id}" ${t.id === z.tip_remonta_id ? 'selected' : ''}>${escape(t.nazvanie)} (${escape(t.kategoriya || '')})</option>`).join('')}
            </select>
          </label>
          <label>${T('requests.priority')}
            <select id="ePrio">
              <option value="Низкий" ${z.prioritet === 'Низкий' ? 'selected' : ''}>${T('priority.low')}</option>
              <option value="Средний" ${z.prioritet === 'Средний' ? 'selected' : ''}>${T('priority.medium')}</option>
              <option value="Высокий" ${z.prioritet === 'Высокий' ? 'selected' : ''}>${T('priority.high')}</option>
            </select>
          </label>
          <label class="full">${T('requests.description')}
            <textarea id="eDesc" rows="3" placeholder="${T('requests.desc_ph') || 'Описание'}">${escape(z.opisanie || '')}</textarea>
          </label>
        </div>
        <div class="modal__actions">
          <button class="btn" id="eCancel">${T('common.cancel')}</button>
          <button class="btn dark" id="eSave">${T('common.save')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(bg);
    bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
    bg.querySelector('#eCancel').onclick = () => bg.remove();
    bg.querySelector('#eSave').onclick = async () => {
      const rules = [
        ...(ts.length ? [{ selector: '#eTs', message: T('validate.ts') || 'Select vehicle' }] : []),
        { selector: '#eTip', message: T('validate.type') || 'Select repair type' },
      ];
      if (!window.validateForm(bg, rules)) return;
      const body = {
        ...(ts.length && z.status === 'Новая' ? { ts_id: +bg.querySelector('#eTs').value } : {}),
        tip_remonta_id: +bg.querySelector('#eTip').value,
        prioritet: bg.querySelector('#ePrio').value,
        opisanie: bg.querySelector('#eDesc').value || null,
      };
      try {
        await window.api(`/api/zayavki/${z.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        window.toast(T('requests.updated') || 'Заявка обновлена', 'success');
        bg.remove();
        onSaved?.();
      } catch (e) { window.toast(e.message, 'error'); }
    };
  }

  /* ──────────────────────────────────────────────────────────
     1.b Назначение / автонаводка / смена статуса
     ────────────────────────────────────────────────────────── */
  async function autoAssign(id, onDone) {
    try {
      console.log('[autoAssign] start, zayavka', id);
      const r = await window.api(`/api/zayavki/${id}/auto-assign`, { method: 'POST' });
      console.log('[autoAssign] ok:', r);
      const scopeLbl = r.scope === 'local'
        ? T('requests.auto_scope.local')
        : T('requests.auto_scope.global');
      window.toast(
        T('requests.auto_done', {
          fio: r.mekhanik.fio,
          load: r.mekhanik.aktivnyh_remontov,
          scope: scopeLbl,
        }),
        'success'
      );
      onDone?.();
    } catch (e) {
      console.error('[autoAssign] error:', e);
      window.toast(e.message, 'error');
    }
  }

  async function openManualAssign(id, onDone) {
    const [zayavka, allMekh] = await Promise.all([
      window.api(`/api/zayavki/${id}`),
      window.api('/api/zayavki/dispetcher/mekhaniki'),
    ]);

    // Подкрашиваем механиков из подразделения ТС
    const localPdId = zayavka.podrazdelenie_id;
    const sorted = [...allMekh].sort((a, b) => {
      // local first, then by load
      const la = a.podrazdelenie_id === localPdId ? 0 : 1;
      const lb = b.podrazdelenie_id === localPdId ? 0 : 1;
      if (la !== lb) return la - lb;
      return a.aktivnyh_remontov - b.aktivnyh_remontov;
    });

    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `
      <div class="modal" style="width: 600px">
        <h3>${T('dispatch.manual_title', { id })}</h3>
        <p class="be-intro">${T('dispatch.manual_hint', { pd: escape(zayavka.podrazdelenie) })}</p>
        <div class="mekhaniki-list">
          ${sorted.map(m => `
            <label class="mekh-row ${m.podrazdelenie_id === localPdId ? 'mekh-row--local' : ''}">
              <input type="radio" name="mekh" value="${m.id}" />
              <div>
                <div class="mekh-row__fio">${escape(m.fio)}
                  ${m.podrazdelenie_id === localPdId
                    ? `<span class="badge-local">${T('dispatch.local')}</span>`
                    : ''}
                </div>
                <div class="mekh-row__meta">${escape(m.podrazdelenie)} ·
                  ${T('dispatch.load_active')}: <strong>${m.aktivnyh_remontov}</strong> ·
                  ${T('dispatch.load_30d')}: ${m.remontov_za_30_dney}
                </div>
              </div>
            </label>
          `).join('') || `<div class="empty">${T('dispatch.no_mekh')}</div>`}
        </div>
        <div class="modal__actions">
          <button class="btn" id="aCancel">${T('common.cancel')}</button>
          <button class="btn dark" id="aSave">${T('dispatch.assign_btn')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(bg);
    bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
    bg.querySelector('#aCancel').onclick = () => bg.remove();
    bg.querySelector('#aSave').onclick = async () => {
      const checked = bg.querySelector('input[name="mekh"]:checked');
      if (!checked) return window.toast(T('dispatch.choose_mekh'), 'error');
      try {
        await window.api(`/api/zayavki/${id}/assign`, {
          method: 'PATCH',
          body: JSON.stringify({ mekhanik_id: +checked.value }),
        });
        window.toast(T('dispatch.assigned'), 'success');
        bg.remove();
        onDone?.();
      } catch (e) { window.toast(e.message, 'error'); }
    };
  }

  function openStatusDialog(id, statusy, onDone) {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `
      <div class="modal" style="width: 460px">
        <h3>${T('requests.change_status')}</h3>
        <div class="form-grid">
          <label class="full">${T('requests.new_status')}
            <select id="sId">
              ${statusy.map(s => `<option value="${s.id}">${escape(s.nazvanie)}</option>`).join('')}
            </select>
          </label>
          <label class="full">${T('common.comment')}
            <textarea id="sCom" rows="2"></textarea>
          </label>
        </div>
        <div class="modal__actions">
          <button class="btn" id="sCancel">${T('common.cancel')}</button>
          <button class="btn dark" id="sSave">${T('common.save')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(bg);
    bg.querySelector('#sCancel').onclick = () => bg.remove();
    bg.querySelector('#sSave').onclick = async () => {
      try {
        await window.api(`/api/zayavki/${id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({
            status_id: +bg.querySelector('#sId').value,
            kommentariy: bg.querySelector('#sCom').value || null,
          }),
        });
        window.toast(T('common.saved'), 'success');
        bg.remove();
        onDone?.();
      } catch (e) { window.toast(e.message, 'error'); }
    };
  }

  async function openRequestDetails(id) {
    const [z, timeline, messages] = await Promise.all([
      window.api(`/api/zayavki/${id}`),
      window.api(`/api/zayavki/${id}/timeline`).catch(() => []),
      window.api(`/api/zayavki/${id}/chat`).catch(() => []),
    ]);
    const canChat = (
      z.sozdatel_id === CURRENT_USER.id ||
      z.mekhanik_id === CURRENT_USER.id ||
      ['Диспетчер','Главный механик','Директор','Аналитик'].includes(CURRENT_USER.rol_nazvanie)
    );
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `
      <div class="modal" style="width: 640px; max-height: 90vh; overflow-y: auto">
        <h3>${T('requests.detail_title', { id: z.id })}</h3>
        <div class="kv">
          <div class="kv__row"><div>${T('requests.tip_remonta')}</div><div>${escape(z.tip_remonta)}</div></div>
          <div class="kv__row"><div>${T('common.status')}</div><div>${statusBadge(z.status)}</div></div>
          <div class="kv__row"><div>${T('requests.priority')}</div><div>${prio(z.prioritet)}</div></div>
          <div class="kv__row"><div>${T('requests.ts')}</div><div>${escape(z.gos_nomer)} · ${escape(z.marka)} ${escape(z.model)}</div></div>
          <div class="kv__row"><div>${T('requests.division')}</div><div>${escape(z.podrazdelenie)}${z.adres ? ` · ${escape(z.adres)}` : ''}</div></div>
          <div class="kv__row"><div>${T('requests.creator')}</div><div>${escape(z.sozdatel_fio)}</div></div>
          <div class="kv__row"><div>${T('requests.created')}</div><div>${fmtDateTime(z.data_sozdaniya)}</div></div>
          <div class="kv__row"><div>${T('requests.mekhanik')}</div><div>${z.mekhanik_fio ? escape(z.mekhanik_fio) : '—'}</div></div>
          ${z.data_nachala ? `<div class="kv__row"><div>${T('repairs.started')}</div><div>${fmtDateTime(z.data_nachala)}</div></div>` : ''}
          ${z.data_okonchaniya ? `<div class="kv__row"><div>${T('repairs.finished')}</div><div>${fmtDateTime(z.data_okonchaniya)}</div></div>` : ''}
          ${z.stoimost_rabot != null ? `<div class="kv__row"><div>${T('repairs.cost_work')}</div><div>${fmtMoney(z.stoimost_rabot)}</div></div>` : ''}
          ${z.stoimost_zapchastey != null ? `<div class="kv__row"><div>${T('repairs.cost_parts')}</div><div>${fmtMoney(z.stoimost_zapchastey)}</div></div>` : ''}
          ${z.garantiyny_srok != null ? `<div class="kv__row"><div>${T('repairs.warranty') || 'Гарантия'}</div><div>${z.garantiyny_srok} дн.</div></div>` : ''}
        </div>
        ${z.opisanie ? `<div class="req-card__desc" style="margin-top: 12px">${escape(z.opisanie)}</div>` : ''}
        ${z.itog ? `<div class="req-card__desc" style="margin-top: 8px"><strong>${T('repairs.itog')}:</strong> ${escape(z.itog)}</div>` : ''}

        <div style="margin-top: 20px">
          <h4 style="margin-bottom: 10px; font-size: 14px; color: var(--c-muted)">${T('requests.timeline_title')}</h4>
          <div id="reqTimeline" class="timeline">${renderTimeline(timeline)}</div>
        </div>

        ${canChat ? `
        <div class="chat-box" style="margin-top: 20px; border-top: 1px solid var(--c-border); padding-top: 12px;">
          <h4 style="margin-bottom: 10px; font-size: 14px; color: var(--c-muted)">${T('chat.title') || 'Чат'}</h4>
          <div id="chatMessages" style="max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;">
            ${renderChatMessages(messages)}
          </div>
          <div style="display: flex; gap: 8px;">
            <input type="text" id="chatInput" class="field" placeholder="${T('chat.placeholder') || 'Написать сообщение…'}" style="flex: 1;" />
            <button class="btn dark" id="chatSend">${T('common.send') || 'Отправить'}</button>
          </div>
        </div>` : ''}

        <div class="modal__actions">
          <button class="btn" id="dClose">${T('common.close')}</button>
          ${(z.sozdatel_id === CURRENT_USER.id || ['Диспетчер','Главный механик','Директор','Аналитик'].includes(CURRENT_USER.rol_nazvanie)) ? `<button class="btn dark" id="dEdit">${T('common.edit')}</button>` : ''}
        </div>
      </div>
    `;
    document.body.appendChild(bg);
    bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
    bg.querySelector('#dClose').onclick = () => bg.remove();
    const editBtn = bg.querySelector('#dEdit');
    if (editBtn) editBtn.onclick = () => { bg.remove(); openEditRequest(z, onRefresh); };

    if (canChat) {
      const chatMessages = bg.querySelector('#chatMessages');
      const chatInput = bg.querySelector('#chatInput');
      const chatSend = bg.querySelector('#chatSend');
      const sendMsg = async () => {
        const text = chatInput.value.trim();
        if (!text) return;
        try {
          const msg = await window.api(`/api/zayavki/${id}/chat`, {
            method: 'POST',
            body: JSON.stringify({ tekst: text }),
          });
          chatMessages.innerHTML += renderChatMessages([msg]);
          chatMessages.scrollTop = chatMessages.scrollHeight;
          chatInput.value = '';
        } catch (e) { window.toast(e.message, 'error'); }
      };
      chatSend.onclick = sendMsg;
      chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendMsg(); });
    }
  }

  function renderChatMessages(list) {
    if (!list || !list.length) return `<div style="font-size: 12px; color: var(--c-muted)">${T('chat.empty') || 'Нет сообщений'}</div>`;
    return list.map(m => `
      <div style="display: flex; flex-direction: column; gap: 2px; align-self: ${m.avtor_id === CURRENT_USER.id ? 'flex-end' : 'flex-start'}; max-width: 80%;">
        <div style="font-size: 11px; color: var(--c-muted)">${escape(m.avtor_fio)} · ${fmtDateTime(m.data_sozdaniya)}</div>
        <div style="padding: 8px 12px; border-radius: 12px; background: ${m.avtor_id === CURRENT_USER.id ? 'var(--c-accent)' : 'var(--c-surface)'}; color: ${m.avtor_id === CURRENT_USER.id ? '#fff' : 'inherit'}; font-size: 13px;">${escape(m.tekst)}</div>
      </div>
    `).join('');
  }

  function renderTimeline(items) {
    if (!items || !items.length) return `<div class="empty" style="padding: 12px 0">${T('requests.timeline_empty')}</div>`;
    return `
      <div class="timeline__list">
        ${items.map((it, i) => `
          <div class="timeline__item ${i === items.length - 1 ? 'timeline__item--last' : ''}">
            <div class="timeline__dot"></div>
            <div class="timeline__content">
              <div class="timeline__header">
                <span class="timeline__status">${escape(it.status_nazvanie)}</span>
                <span class="timeline__time">${fmtDateTime(it.data_izmeneniya)}</span>
              </div>
              <div class="timeline__meta">
                ${it.sotrudnik_fio ? `<span class="timeline__user">${escape(it.sotrudnik_fio)}</span>` : ''}
                ${it.kommentariy ? `<span class="timeline__comment">${escape(it.kommentariy)}</span>` : ''}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  /* ──────────────────────────────────────────────────────────
     2. РАСПРЕДЕЛЕНИЕ — рабочее место Диспетчера
     Двухколоночный экран: слева новые/нераспределённые заявки,
     справа — список свободных механиков с метрикой.
     Большая кнопка «Автонаводка всех» = bulk auto-assign.
     ────────────────────────────────────────────────────────── */
  async function renderDispatch(root) {
    root.innerHTML = `
      <div class="section__head">
        <div>
          <h2 class="section__title">${T('dispatch.title')}</h2>
          <div class="section__subtitle">${T('dispatch.subtitle')}</div>
        </div>
        <div class="section__actions">
          <button class="btn btn--accent" id="btnAutoAll">⚡ ${T('dispatch.auto_all')}</button>
        </div>
      </div>

      <div class="dispatch-grid">
        <div class="dispatch-col">
          <h3 class="dispatch-col__title">📥 ${T('dispatch.queue')} <span class="badge-count" id="qCount">0</span></h3>
          <div id="qList" class="req-list"></div>
        </div>
        <div class="dispatch-col">
          <h3 class="dispatch-col__title">🛠 ${T('dispatch.mekhaniki')}</h3>
          <div id="mList" class="mekhaniki-list"></div>
        </div>
      </div>
    `;

    async function load() {
      $('#qList').innerHTML = `<div class="loading-screen"><div class="spinner"></div></div>`;
      $('#mList').innerHTML = `<div class="loading-screen"><div class="spinner"></div></div>`;

      const [zRes, mekh] = await Promise.all([
        // Только Новые + На согласовании = очередь распределения
        window.api('/api/zayavki?status=1'),
        window.api('/api/zayavki/dispetcher/mekhaniki'),
      ]);

      const queue = zRes.items.filter(z => !z.mekhanik_id);
      $('#qCount').textContent = queue.length;

      $('#qList').innerHTML = queue.length
        ? queue.map(z => `
            <div class="req-card">
              <div class="req-card__head">
                <div class="req-card__title">
                  <strong>#${z.id}</strong> ${escape(z.tip_remonta)}
                  <span class="req-card__plate">${escape(z.gos_nomer)}</span>
                </div>
                ${statusBadge(z.status)}
              </div>
              <div class="req-card__body">
                <div class="req-card__meta">
                  <span>⚑ ${prio(z.prioritet)}</span>
                  <span>🏢 ${escape(z.podrazdelenie)}</span>
                  <span>🕒 ${fmtDateTime(z.data_sozdaniya)}</span>
                </div>
                ${z.opisanie ? `<div class="req-card__desc">${escape(z.opisanie)}</div>` : ''}
              </div>
              <div class="req-card__actions">
                <button class="btn btn--accent" data-act="auto" data-id="${z.id}">⚡ ${T('requests.auto_assign')}</button>
                <button class="btn"            data-act="manual" data-id="${z.id}">${T('requests.assign')}</button>
              </div>
            </div>
          `).join('')
        : `<div class="empty">${T('dispatch.queue_empty')}</div>`;

      $('#mList').innerHTML = mekh.length
        ? mekh.map(m => `
            <div class="mekh-card ${m.aktivnyh_remontov === 0 ? 'mekh-card--free' : ''}">
              <div class="mekh-card__head">
                <strong>${escape(m.fio)}</strong>
                <span class="mekh-card__load ${m.aktivnyh_remontov === 0 ? 'is-zero' : m.aktivnyh_remontov > 2 ? 'is-busy' : 'is-mid'}">
                  ${m.aktivnyh_remontov} ${T('dispatch.active_short')}
                </span>
              </div>
              <div class="mekh-card__meta">
                ${escape(m.podrazdelenie)} · ${T('dispatch.load_30d_short')}: ${m.remontov_za_30_dney}
              </div>
            </div>
          `).join('')
        : `<div class="empty">${T('dispatch.no_mekh')}</div>`;

      // Делегаты
      $$('#qList button[data-act]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = +btn.dataset.id;
          if (btn.dataset.act === 'auto')   autoAssign(id, load);
          if (btn.dataset.act === 'manual') openManualAssign(id, load);
        });
      });
    }

    $('#btnAutoAll').addEventListener('click', async () => {
      if (!await window.confirmDialog(T('dispatch.auto_all_confirm'), { icon: '⚙️', danger: false, title: T('dispatch.auto_all_confirm') })) return;
      const { items } = await window.api('/api/zayavki?status=1');
      const queue = items.filter(z => !z.mekhanik_id);
      if (!queue.length) return window.toast(T('dispatch.queue_empty'), '');
      let ok = 0, fail = 0;
      for (const z of queue) {
        try {
          await window.api(`/api/zayavki/${z.id}/auto-assign`, { method: 'POST' });
          ok++;
        } catch (_) { fail++; }
      }
      window.toast(T('dispatch.auto_all_done', { ok, fail }), fail ? 'error' : 'success');
      load();
    });

    load();
  }

  /* ──────────────────────────────────────────────────────────
     3. МОИ РЕМОНТЫ — рабочее место Механика
     ────────────────────────────────────────────────────────── */
  async function renderRepairs(root) {
    root.innerHTML = `
      <div class="section__head">
        <div>
          <h2 class="section__title">${T('repairs.title')}</h2>
          <div class="section__subtitle">${T('repairs.subtitle')}</div>
        </div>
        <button class="btn" id="rReload">↻ ${T('common.refresh')}</button>
      </div>
      <div id="rList"><div class="loading-screen"><div class="spinner"></div></div></div>
    `;

    async function load() {
      $('#rList').innerHTML = `<div class="loading-screen"><div class="spinner"></div></div>`;
      try {
        const data = await window.api('/api/remonty/my');
        const items = data?.items || [];
        if (!items.length) {
          $('#rList').innerHTML = `<div class="empty">${T('repairs.empty')}</div>`;
          return;
        }
        const open = items.filter(x => !x.data_okonchaniya);
        const closed = items.filter(x => x.data_okonchaniya);

      $('#rList').innerHTML = `
        ${open.length ? `
          <h3 class="repair-section-title">${T('repairs.open')} (${open.length})</h3>
          ${open.map(remCard).join('')}
        ` : ''}
        ${closed.length ? `
          <h3 class="repair-section-title">${T('repairs.closed')} (${closed.length})</h3>
          ${closed.map(remCard).join('')}
        ` : ''}
      `;

      $$('#rList button[data-act]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = +btn.dataset.id;
          if (btn.dataset.act === 'start') startRepair(id, load);
          if (btn.dataset.act === 'finish') openFinishDialog(id, load);
          if (btn.dataset.act === 'open') openRequestDetails(items.find(i => i.remont_id === id)?.zayavka_id);
        });
      });
      } catch (e) {
        $('#rList').innerHTML = `<div class="empty">${T('common.error')}: ${e.message}</div>`;
      }
    }
    $('#rReload').addEventListener('click', load);
    load();
  }

  function remCard(r) {
    const isOpen = !r.data_okonchaniya;
    return `
      <div class="repair-card ${isOpen ? 'is-open' : 'is-closed'}">
        <div class="req-card__head">
          <div class="req-card__title">
            <strong>#${r.zayavka_id}</strong> ${escape(r.tip_remonta)}
            <span class="req-card__plate">${escape(r.gos_nomer)}</span>
          </div>
          ${statusBadge(r.status)}
        </div>
        <div class="req-card__body">
          <div class="req-card__meta">
            <span>⚑ ${prio(r.prioritet)}</span>
            <span>🚚 ${escape(r.marka)} ${escape(r.model)}</span>
            <span>🏢 ${escape(r.podrazdelenie)}</span>
            ${r.data_nachala ? `<span>▶ ${fmtDateTime(r.data_nachala)}</span>` : ''}
            ${r.data_okonchaniya ? `<span>■ ${fmtDateTime(r.data_okonchaniya)}</span>` : ''}
          </div>
          ${r.opisanie ? `<div class="req-card__desc">${escape(r.opisanie)}</div>` : ''}
          ${!isOpen ? `
            <div class="req-card__totals">
              <span>${T('repairs.cost_work')}: <strong>${fmtMoney(r.stoimost_rabot)}</strong></span>
              <span>${T('repairs.cost_parts')}: <strong>${fmtMoney(r.stoimost_zapchastey)}</strong></span>
              <span>${T('repairs.itog')}: ${escape(r.itog || '—')}</span>
            </div>
          ` : ''}
        </div>
        <div class="req-card__actions">
          ${isOpen && !r.data_nachala
            ? `<button class="btn btn--accent" data-act="start" data-id="${r.remont_id}">▶ ${T('repairs.start_btn')}</button>` : ''}
          ${isOpen
            ? `<button class="btn dark" data-act="finish" data-id="${r.remont_id}">✓ ${T('repairs.finish_btn')}</button>` : ''}
          <button class="btn btn--ghost" data-act="open" data-id="${r.remont_id}">${T('common.details')}</button>
        </div>
      </div>
    `;
  }

  async function startRepair(id, onDone) {
    try {
      await window.api(`/api/remonty/${id}/start`, { method: 'PATCH' });
      window.toast(T('repairs.started_ok'), 'success');
      onDone?.();
    } catch (e) { window.toast(e.message, 'error'); }
  }

  function openFinishDialog(id, onDone) {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `
      <div class="modal" style="width: 480px">
        <h3>${T('repairs.finish_title')}</h3>
        <div class="form-grid">
          <label class="full">${T('repairs.cost_work')}, ₽
            <input type="number" id="fW" min="0" step="100" value="0" />
          </label>
          <label class="full">${T('repairs.cost_parts')}, ₽
            <input type="number" id="fP" min="0" step="100" value="0" />
          </label>
          <label class="full">${T('repairs.itog')}
            <select id="fI">
              <option>${T('repairs.outcome_fixed')}</option>
              <option>${T('repairs.outcome_repeat')}</option>
              <option>${T('repairs.outcome_unrepairable')}</option>
            </select>
          </label>
          <label class="full">${T('repairs.warranty') || 'Гарантийный срок (дней)'}
            <input type="number" id="fG" min="0" step="1" value="0" />
          </label>
          <label class="full">${T('common.comment')}
            <textarea id="fC" rows="3"></textarea>
          </label>
        </div>
        <div class="modal__actions">
          <button class="btn" id="fCancel">${T('common.cancel')}</button>
          <button class="btn dark" id="fSave">${T('repairs.finish_btn')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(bg);
    bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
    bg.querySelector('#fCancel').onclick = () => bg.remove();
    bg.querySelector('#fSave').onclick = async () => {
      try {
        await window.api(`/api/remonty/${id}/finish`, {
          method: 'PATCH',
          body: JSON.stringify({
            stoimost_rabot: +bg.querySelector('#fW').value || 0,
            stoimost_zapchastey: +bg.querySelector('#fP').value || 0,
            garantiyny_srok: +bg.querySelector('#fG').value || 0,
            itog: bg.querySelector('#fI').value,
            kommentariy: bg.querySelector('#fC').value || null,
          }),
        });
        window.toast(T('repairs.finished_ok'), 'success');
        bg.remove();
        onDone?.();
      } catch (e) { window.toast(e.message, 'error'); }
    };
  }

  /* ──────────────────────────────────────────────────────────
     Регистрация в роутере
     ────────────────────────────────────────────────────────── */
  Object.assign(window.CARVIX_ROUTES, {
    requests: renderRequests,
    dispatch: renderDispatch,
    repairs:  renderRepairs,
  });
})();
