/* ============================================================
   Carvix — раздел «Транспорт».
   Стильный grid карточек ТС, диалог добавления с каскадными
   справочниками марка/модель + опция «создать новую».
   ============================================================ */
(function () {
  'use strict';

  const T  = (k, v) => window.t(k, v);
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  function escape(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
  }
  function fmtDate(s) {
    if (!s) return '—';
    const d = new Date(s);
    return isNaN(d) ? s : d.toLocaleDateString(window.getLang() === 'en' ? 'en-US' : 'ru-RU');
  }
  function fmtKm(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('ru-RU').format(n) + ' км';
  }

  /* ──────────────────────────────────────────────────────────
     RENDER — список ТС
     ────────────────────────────────────────────────────────── */
  async function renderTransport(root) {
    const role = window.CURRENT_USER?.rol_nazvanie || '';
    const isAdmin = ['Директор','Главный механик'].includes(role);
    const myId = window.CURRENT_USER?.id;

    root.innerHTML = `
      <div class="section__head">
        <div>
          <h2 class="section__title">${T('transport.title')}</h2>
          <div class="section__subtitle">${T('transport.subtitle')}</div>
        </div>
        <div class="section__actions" id="tsTopActions" style="display:none">
          <button class="btn dark" id="btnAddTs">+ ${T('transport.add')}</button>
        </div>
      </div>

      <div id="tsList" class="ts-grid">
        <div class="loading-screen"><div class="spinner"></div></div>
      </div>
    `;

    async function load() {
      $('#tsList').innerHTML = `<div class="loading-screen"><div class="spinner"></div></div>`;
      const { items } = await window.api('/api/transport');

      // Прячем верхнюю чёрную кнопку, когда список пуст —
      // в empty-state есть своя CTA «Добавить первое ТС».
      const topActions = $('#tsTopActions');
      if (topActions) topActions.style.display = items.length ? '' : 'none';

      if (!items.length) {
        $('#tsList').innerHTML = `
          <div class="empty-state">
            <div class="empty-state__icon">🚚</div>
            <h3>${T('transport.empty_title')}</h3>
            <p>${T('transport.empty_hint')}</p>
            <button class="btn btn--accent" id="btnAddFirst">+ ${T('transport.add_first')}</button>
          </div>
        `;
        $('#btnAddFirst')?.addEventListener('click', () => openAddDialog(load));
        return;
      }

      $('#tsList').innerHTML = items.map(t => `
        <div class="ts-card" data-id="${t.id}">
          <div class="ts-card__top">
            <div class="ts-card__plate">${escape(t.gos_nomer)}</div>
            <div class="ts-card__state ${stateClass(t.tekuschee_sostoyanie)}">${escape(t.tekuschee_sostoyanie || '—')}</div>
          </div>
          <div class="ts-card__brand">
            <div class="ts-card__marka">${escape(t.marka)}</div>
            <div class="ts-card__model">${escape(t.model)}</div>
          </div>
          <div class="ts-card__body">
            <div class="ts-card__row">
              <span class="ts-card__label">${T('transport.invent')}</span>
              <span class="ts-card__value">${escape(t.invent_nomer)}</span>
            </div>
            <div class="ts-card__row">
              <span class="ts-card__label">${T('transport.division')}</span>
              <span class="ts-card__value">${escape(t.podrazdelenie)}</span>
            </div>
            <div class="ts-card__row">
              <span class="ts-card__label">${T('transport.probeg')}</span>
              <span class="ts-card__value">${fmtKm(t.probeg)}</span>
            </div>
            <div class="ts-card__row">
              <span class="ts-card__label">${T('transport.year')}</span>
              <span class="ts-card__value">${fmtDate(t.data_vypuska)}</span>
            </div>
            ${isAdmin && t.sozdatel_fio ? `
              <div class="ts-card__row">
                <span class="ts-card__label">${T('transport.created_by') || 'Добавил'}</span>
                <span class="ts-card__value">${escape(t.sozdatel_fio)}</span>
              </div>
            ` : ''}
          </div>
          <div class="ts-card__foot">
            <span class="ts-card__chip">📋 ${t.kolichestvo_zayavok || 0} ${T('transport.zayavok')}</span>
            <div class="ts-card__actions">
              <button class="btn btn--ghost btn--sm" data-act="edit" data-id="${t.id}" title="${T('common.edit') || 'Изменить'}">✎</button>
              ${(isAdmin || t.sozdatel_id === myId) ? `<button class="btn btn--ghost btn--sm btn--danger" data-act="del" data-id="${t.id}" title="${T('common.delete')}">🗑</button>` : ''}
            </div>
          </div>
        </div>
      `).join('');

      $$('#tsList button[data-act]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = +btn.dataset.id;
          if (btn.dataset.act === 'edit') openEditDialog(id, load);
          if (btn.dataset.act === 'del') deleteTs(id, load);
        });
      });
    }

    $('#btnAddTs').addEventListener('click', () => openAddDialog(load));
    load();
  }

  function stateClass(s) {
    if (!s) return '';
    if (/строю|active|active|on duty/i.test(s)) return 'is-active';
    if (/ремонт|repair/i.test(s)) return 'is-repair';
    if (/списан|decommiss/i.test(s)) return 'is-out';
    return '';
  }

  /* ──────────────────────────────────────────────────────────
     ДИАЛОГ ДОБАВЛЕНИЯ ТС
     ────────────────────────────────────────────────────────── */
  async function openAddDialog(onSaved) {
    const role = window.CURRENT_USER?.rol_nazvanie || '';
    const isAdmin = ['Директор','Главный механик','Диспетчер','Аналитик'].includes(role);

    const [marki, podrazdeleniya] = await Promise.all([
      window.api('/api/transport/dict/marki'),
      isAdmin ? window.api('/api/transport/dict/podrazdeleniya') : Promise.resolve([]),
    ]);

    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `
      <div class="modal" style="width: 560px">
        <h3>${T('transport.add_title')}</h3>
        <div class="form-grid">
          <label>${T('transport.gos_nomer')} *
            <input id="tGos" type="text" placeholder="А123АА77" maxlength="50" />
          </label>
          <label>${T('transport.invent')} *
            <input id="tInv" type="text" placeholder="INV-001" maxlength="50" />
          </label>

          <label>${T('transport.marka')} *
            <div class="combo">
              <select id="tMarka">
                <option value="">— ${T('common.choose')} —</option>
                ${marki.map(m => `<option value="${m.id}">${escape(m.nazvanie)}</option>`).join('')}
                <option value="__new__">+ ${T('transport.new_marka')}</option>
              </select>
              <input id="tMarkaNew" type="text" placeholder="${T('transport.new_marka_ph')}" style="display:none" />
            </div>
          </label>

          <label>${T('transport.model')} *
            <div class="combo">
              <select id="tModel" disabled>
                <option value="">— ${T('transport.pick_marka_first')} —</option>
              </select>
              <input id="tModelNew" type="text" placeholder="${T('transport.new_model_ph')}" style="display:none" />
            </div>
          </label>

          <label>${T('transport.probeg')}, ${T('transport.km')}
            <input id="tProbeg" type="number" min="0" step="100" placeholder="0" />
          </label>
          <label>${T('transport.year_release')}
            <input id="tYear" type="date" />
          </label>

          ${isAdmin ? `
            <label class="full">${T('transport.division')}
              <select id="tPd">
                ${podrazdeleniya.map(p => `<option value="${p.id}" ${p.id === window.CURRENT_USER.podrazdelenie_id ? 'selected' : ''}>${escape(p.nazvanie)}</option>`).join('')}
              </select>
            </label>
          ` : ''}

          <label class="full">${T('transport.state')}
            <select id="tState">
              <option value="В строю">${T('transport.state_active')}</option>
              <option value="На ремонте">${T('transport.state_repair')}</option>
              <option value="Списан">${T('transport.state_out')}</option>
            </select>
          </label>
        </div>
        <div class="modal__actions">
          <button class="btn" id="tCancel">${T('common.cancel')}</button>
          <button class="btn dark" id="tSave">${T('common.save')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(bg);

    // Маски ввода
    maskGosNomer(bg.querySelector('#tGos'));
    maskInvNomer(bg.querySelector('#tInv'));

    bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
    bg.querySelector('#tCancel').onclick = () => bg.remove();

    const elMarka    = bg.querySelector('#tMarka');
    const elMarkaNew = bg.querySelector('#tMarkaNew');
    const elModel    = bg.querySelector('#tModel');
    const elModelNew = bg.querySelector('#tModelNew');

    // ---- Каскад марка → модели ----
    elMarka.addEventListener('change', async () => {
      const v = elMarka.value;
      elModelNew.style.display = 'none';
      elModelNew.value = '';
      if (v === '__new__') {
        elMarkaNew.style.display = 'block';
        elMarkaNew.focus();
        elModel.disabled = false;
        elModel.innerHTML = `<option value="__new__">+ ${T('transport.new_model')}</option>`;
        elModel.value = '__new__';
        elModelNew.style.display = 'block';
        return;
      }
      elMarkaNew.style.display = 'none';
      elMarkaNew.value = '';
      if (!v) {
        elModel.disabled = true;
        elModel.innerHTML = `<option value="">— ${T('transport.pick_marka_first')} —</option>`;
        return;
      }
      const modeli = await window.api(`/api/transport/dict/modeli?marka_id=${v}`);
      elModel.disabled = false;
      elModel.innerHTML = `
        <option value="">— ${T('common.choose')} —</option>
        ${modeli.map(m => `<option value="${m.id}">${escape(m.nazvanie)}</option>`).join('')}
        <option value="__new__">+ ${T('transport.new_model')}</option>
      `;
    });

    elModel.addEventListener('change', () => {
      if (elModel.value === '__new__') {
        elModelNew.style.display = 'block';
        elModelNew.focus();
      } else {
        elModelNew.style.display = 'none';
        elModelNew.value = '';
      }
    });

    // ---- Сохранение ----
    bg.querySelector('#tSave').onclick = async () => {
      const gos = bg.querySelector('#tGos').value.trim();
      const inv = bg.querySelector('#tInv').value.trim();
      if (!gos || !inv) return window.toast(T('transport.fill_required'), 'error');

      // Резолв марки: либо id, либо создать новую
      let markaId = elMarka.value;
      if (markaId === '__new__') {
        const name = elMarkaNew.value.trim();
        if (!name) return window.toast(T('transport.enter_marka'), 'error');
        const created = await window.api('/api/transport/dict/marki', {
          method: 'POST',
          body: JSON.stringify({ nazvanie: name }),
        });
        markaId = created.id;
      }
      if (!markaId) return window.toast(T('transport.pick_marka'), 'error');

      // Резолв модели
      let modelId = elModel.value;
      if (modelId === '__new__') {
        const name = elModelNew.value.trim();
        if (!name) return window.toast(T('transport.enter_model'), 'error');
        const created = await window.api('/api/transport/dict/modeli', {
          method: 'POST',
          body: JSON.stringify({ marka_id: +markaId, nazvanie: name }),
        });
        modelId = created.id;
      }
      if (!modelId) return window.toast(T('transport.pick_model'), 'error');

      const body = {
        gos_nomer: gos,
        invent_nomer: inv,
        model_id: +modelId,
        probeg: +bg.querySelector('#tProbeg').value || null,
        data_vypuska: bg.querySelector('#tYear').value || null,
        tekuschee_sostoyanie: bg.querySelector('#tState').value,
      };
      const pdEl = bg.querySelector('#tPd');
      if (pdEl) body.podrazdelenie_id = +pdEl.value;

      try {
        await window.api('/api/transport', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        window.toast(T('transport.created'), 'success');
        bg.remove();
        onSaved?.();
      } catch (e) { window.toast(e.message, 'error'); }
    };
  }

  /* ──────────────────────────────────────────────────────────
     МАСКИ ВВОДА
     ────────────────────────────────────────────────────────── */
  // Российский гос. номер: буква + 3 цифры + 2 буквы + 2-3 цифры (регион)
  // Допустимые буквы: А В Е К М Н О Р С Т У Х (совпадают с латиницей)
  const GOS_LETTERS = 'АВЕКМНОРСТУХ';
  const GOS_LATIN   = 'ABEKMHOPCTYX'; // латинские дубликаты
  function latinToRus(ch) {
    const idx = GOS_LATIN.indexOf(ch);
    return idx >= 0 ? GOS_LETTERS[idx] : ch;
  }
  function maskGosNomer(input) {
    input.placeholder = 'А123АА77';
    input.maxLength = 9;
    input.addEventListener('input', () => {
      let raw = input.value.toUpperCase();
      let result = '';
      for (let i = 0; i < raw.length && result.length < 9; i++) {
        let ch = latinToRus(raw[i]);
        const pos = result.length;
        if (pos === 0 || pos === 4 || pos === 5) {
          // буква
          if (GOS_LETTERS.includes(ch)) result += ch;
        } else if (pos >= 1 && pos <= 3) {
          // цифры (номер)
          if (/\d/.test(ch)) result += ch;
        } else if (pos >= 6) {
          // цифры (регион)
          if (/\d/.test(ch)) result += ch;
        }
      }
      input.value = result;
    });
  }

  // Инвентарный номер: только заглавные буквы (лат), цифры и дефис
  function maskInvNomer(input) {
    input.placeholder = 'INV-001';
    input.maxLength = 20;
    input.addEventListener('input', () => {
      let v = input.value.toUpperCase().replace(/[^A-Z0-9\-]/g, '');
      if (v.length > 20) v = v.slice(0, 20);
      input.value = v;
    });
  }

  /* ──────────────────────────────────────────────────────────
     ДИАЛОГ РЕДАКТИРОВАНИЯ — все поля
     ────────────────────────────────────────────────────────── */
  async function openEditDialog(id, onSaved) {
    const ts = await window.api(`/api/transport/${id}`);
    const role = window.CURRENT_USER?.rol_nazvanie || '';
    const isAdmin = ['Директор','Главный механик','Диспетчер','Аналитик'].includes(role);

    const [marki, podrazdeleniya] = await Promise.all([
      window.api('/api/transport/dict/marki'),
      isAdmin ? window.api('/api/transport/dict/podrazdeleniya') : Promise.resolve([]),
    ]);

    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `
      <div class="modal" style="width: 580px">
        <h3>${T('transport.edit_title')}: ${escape(ts.gos_nomer)}</h3>
        <div class="form-grid">
          <label>${T('transport.gos_nomer')} *
            <input id="eGos" type="text" value="${escape(ts.gos_nomer)}" maxlength="9" />
          </label>
          <label>${T('transport.invent')} *
            <input id="eInv" type="text" value="${escape(ts.invent_nomer)}" maxlength="20" />
          </label>

          <label>${T('transport.marka')} *
            <div class="combo">
              <select id="eMarka">
                <option value="">— ${T('common.choose')} —</option>
                ${marki.map(m => `<option value="${m.id}" ${m.id === ts.marka_id ? 'selected' : ''}>${escape(m.nazvanie)}</option>`).join('')}
                <option value="__new__">+ ${T('transport.new_marka')}</option>
              </select>
              <input id="eMarkaNew" type="text" placeholder="${T('transport.new_marka_ph')}" style="display:none" />
            </div>
          </label>

          <label>${T('transport.model')} *
            <div class="combo">
              <select id="eModel" disabled>
                <option value="">...</option>
              </select>
              <input id="eModelNew" type="text" placeholder="${T('transport.new_model_ph')}" style="display:none" />
            </div>
          </label>

          <label>${T('transport.probeg')}, ${T('transport.km')}
            <input id="eProbeg" type="number" min="0" step="100" value="${ts.probeg ?? ''}" />
          </label>
          <label>${T('transport.year_release')}
            <input id="eYear" type="date" value="${ts.data_vypuska ? String(ts.data_vypuska).slice(0,10) : ''}" />
          </label>

          ${isAdmin ? `
            <label class="full">${T('transport.division')}
              <select id="ePd">
                ${podrazdeleniya.map(p => `<option value="${p.id}" ${p.id === ts.podrazdelenie_id ? 'selected' : ''}>${escape(p.nazvanie)}</option>`).join('')}
              </select>
            </label>
          ` : ''}

          <label class="full">${T('transport.state')}
            <select id="eState">
              <option value="В строю"    ${ts.tekuschee_sostoyanie === 'В строю' ? 'selected' : ''}>${T('transport.state_active')}</option>
              <option value="На ремонте" ${ts.tekuschee_sostoyanie === 'На ремонте' ? 'selected' : ''}>${T('transport.state_repair')}</option>
              <option value="Списан"     ${ts.tekuschee_sostoyanie === 'Списан' ? 'selected' : ''}>${T('transport.state_out')}</option>
            </select>
          </label>
        </div>
        <div class="modal__actions">
          <button class="btn" id="eCancel">${T('common.cancel')}</button>
          <button class="btn dark" id="eSave">${T('common.save')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(bg);

    // Маски
    maskGosNomer(bg.querySelector('#eGos'));
    maskInvNomer(bg.querySelector('#eInv'));

    bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
    bg.querySelector('#eCancel').onclick = () => bg.remove();

    const elMarka    = bg.querySelector('#eMarka');
    const elMarkaNew = bg.querySelector('#eMarkaNew');
    const elModel    = bg.querySelector('#eModel');
    const elModelNew = bg.querySelector('#eModelNew');

    // Загрузить модели для выбранной марки
    async function loadModels(markaId, selectedModelId) {
      if (!markaId || markaId === '__new__') return;
      const modeli = await window.api(`/api/transport/dict/modeli?marka_id=${markaId}`);
      elModel.disabled = false;
      elModel.innerHTML = `
        <option value="">— ${T('common.choose')} —</option>
        ${modeli.map(m => `<option value="${m.id}" ${m.id === selectedModelId ? 'selected' : ''}>${escape(m.nazvanie)}</option>`).join('')}
        <option value="__new__">+ ${T('transport.new_model')}</option>
      `;
    }

    // Каскад марка → модели
    elMarka.addEventListener('change', async () => {
      const v = elMarka.value;
      elModelNew.style.display = 'none';
      elModelNew.value = '';
      if (v === '__new__') {
        elMarkaNew.style.display = 'block';
        elMarkaNew.focus();
        elModel.disabled = false;
        elModel.innerHTML = `<option value="__new__">+ ${T('transport.new_model')}</option>`;
        elModel.value = '__new__';
        elModelNew.style.display = 'block';
        return;
      }
      elMarkaNew.style.display = 'none';
      elMarkaNew.value = '';
      if (!v) {
        elModel.disabled = true;
        elModel.innerHTML = `<option value="">— ${T('transport.pick_marka_first')} —</option>`;
        return;
      }
      await loadModels(v, null);
    });

    elModel.addEventListener('change', () => {
      if (elModel.value === '__new__') {
        elModelNew.style.display = 'block';
        elModelNew.focus();
      } else {
        elModelNew.style.display = 'none';
        elModelNew.value = '';
      }
    });

    // Инициализировать модели текущей марки
    if (elMarka.value && elMarka.value !== '__new__') {
      await loadModels(elMarka.value, ts.model_id);
    }

    // Сохранение
    bg.querySelector('#eSave').onclick = async () => {
      const gos = bg.querySelector('#eGos').value.trim();
      const inv = bg.querySelector('#eInv').value.trim();
      if (!gos || !inv) return window.toast(T('transport.fill_required'), 'error');

      // Резолв марки
      let markaId = elMarka.value;
      if (markaId === '__new__') {
        const name = elMarkaNew.value.trim();
        if (!name) return window.toast(T('transport.enter_marka'), 'error');
        const created = await window.api('/api/transport/dict/marki', {
          method: 'POST',
          body: JSON.stringify({ nazvanie: name }),
        });
        markaId = created.id;
      }
      if (!markaId) return window.toast(T('transport.pick_marka'), 'error');

      // Резолв модели
      let modelId = elModel.value;
      if (modelId === '__new__') {
        const name = elModelNew.value.trim();
        if (!name) return window.toast(T('transport.enter_model'), 'error');
        const created = await window.api('/api/transport/dict/modeli', {
          method: 'POST',
          body: JSON.stringify({ marka_id: +markaId, nazvanie: name }),
        });
        modelId = created.id;
      }
      if (!modelId) return window.toast(T('transport.pick_model'), 'error');

      const body = {
        gos_nomer: gos,
        invent_nomer: inv,
        model_id: +modelId,
        probeg: +bg.querySelector('#eProbeg').value || null,
        data_vypuska: bg.querySelector('#eYear').value || null,
        tekuschee_sostoyanie: bg.querySelector('#eState').value,
      };
      const pdEl = bg.querySelector('#ePd');
      if (pdEl) body.podrazdelenie_id = +pdEl.value;

      try {
        await window.api(`/api/transport/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        window.toast(T('common.saved'), 'success');
        bg.remove();
        onSaved?.();
      } catch (e) { window.toast(e.message, 'error'); }
    };
  }

  /* ──────────────────────────────────────────────────────────
     УДАЛЕНИЕ ТС
     ────────────────────────────────────────────────────────── */
  async function deleteTs(id, onDone) {
    if (!confirm(T('transport.confirm_delete'))) return;
    try {
      await window.api(`/api/transport/${id}`, { method: 'DELETE' });
      window.toast(T('transport.deleted'), 'success');
      onDone?.();
    } catch (e) { window.toast(e.message, 'error'); }
  }

  /* Регистрация в роутере */
  Object.assign(window.CARVIX_ROUTES, { transport: renderTransport });
})();
