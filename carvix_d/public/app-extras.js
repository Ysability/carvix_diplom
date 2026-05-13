/* ============================================================
   Carvix — расширения SPA: экспорт, расширенный CRUD.
   Файл подключается ПОСЛЕ app.js и расширяет существующие рендереры
   через MutationObserver: после каждой смены раздела добавляем кнопки
   экспорта, инлайн-редактирование, виджет CSV-импорта и т.д.
   ============================================================ */
(function () {
  'use strict';

  // window.t / window.api / TOKEN — определены в app.js / i18n.js
  const T = (k, v) => window.t(k, v);
  const TOKEN = localStorage.getItem('carvix_token');

  /* =========================================================
     1. Открыть экспорт в новой вкладке (Excel/PDF).
     Токен прокидываем в query — иначе <a href> не пройдёт auth.
     ========================================================= */
  function buildExportUrl(type, params = {}) {
    let path;
    switch (type) {
      case 'excel/tco':      path = '/api/finance/exports/excel/tco'; break;
      case 'excel/expenses': path = '/api/finance/exports/excel/expenses'; break;
      case 'excel/budgets':  path = '/api/finance/exports/excel/budgets'; break;
      case 'excel/audit':    path = '/api/finance/exports/excel/audit'; break;
      case 'excel/analyst':  path = '/api/finance/exports/excel/analyst'; break;
      case 'pdf/receipt':    path = `/api/finance/exports/pdf/receipt/${params.id}`; break;
      case 'pdf/monthly':    path = `/api/finance/exports/pdf/monthly/${params.pdId}/${params.god}/${params.m}`; break;
      case 'pdf/writeoff':   path = `/api/finance/exports/pdf/writeoff/${params.remontId}`; break;
      default: throw new Error('Unknown export type: ' + type);
    }
    const qs = new URLSearchParams();
    qs.set('token', TOKEN);
    Object.keys(params).forEach(k => {
      if (params[k] != null && k !== 'id' && k !== 'pdId' && k !== 'god' && k !== 'm' && k !== 'remontId')
        qs.set(k, params[k]);
    });
    return `${path}?${qs.toString()}`;
  }
  function openExportInNewTab(type, params = {}) {
    window.open(buildExportUrl(type, params), '_blank');
  }

  /* =========================================================
     2. Кнопка «Экспорт» (прямое скачивание).
        Возвращает HTMLElement — можно вставить в section__head.
     ========================================================= */
  function buildExportButton(type, params, label) {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-3px; margin-right:6px">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      ${label || T('export.menu')}`;
    btn.onclick = () => openExportInNewTab(type, params);
    return btn;
  }

  /* =========================================================
     4. После каждого рендера секции — добавляем нужные кнопки.
     Подвешиваем на hashchange + observer на #content
     (renderXxx заменяет content.innerHTML).
     ========================================================= */
  function getCurrentSection() {
    return (location.hash.replace('#', '') || 'dashboard');
  }

  function decorateSection() {
    const section = getCurrentSection();
    const content = document.getElementById('content');
    if (!content) return;
    const head = content.querySelector('.section__head');
    if (!head) return;

    // не дублируем кнопки если уже добавлены
    if (head.dataset.extrasInjected === section) return;
    head.dataset.extrasInjected = section;

    switch (section) {
      case 'dashboard':  decorateDashboard(head); break;
      case 'expenses':   decorateExpenses(head, content); break;
      case 'budgets':    decorateBudgets(head, content); break;
      case 'tco':        decorateTco(head, content); break;
      case 'receipts':   decorateReceipts(head, content); break;
      case 'audit':      decorateAudit(head); break;
    }
  }

  // Гарантируем что hash-роутинг ловится; navigate() уже вызывается в app.js.
  window.addEventListener('hashchange', () => setTimeout(decorateSection, 50));
  document.addEventListener('langchange', () => {
    // сбросить флаг чтобы при перерисовке кнопки переподписались
    const head = document.querySelector('.section__head');
    if (head) delete head.dataset.extrasInjected;
    setTimeout(decorateSection, 50);
  });

  // MutationObserver — реагируем на любую замену #content
  const contentEl = () => document.getElementById('content');
  const observe = () => {
    const root = contentEl();
    if (!root) { setTimeout(observe, 100); return; }
    const mo = new MutationObserver(() => {
      const head = root.querySelector('.section__head');
      if (head && !head.dataset.extrasInjected) decorateSection();
    });
    mo.observe(root, { childList: true, subtree: true });
    setTimeout(decorateSection, 100); // первый запуск
  };
  document.addEventListener('DOMContentLoaded', observe);
  if (document.readyState !== 'loading') observe();

  /* =========================================================
     5. ДАШБОРД — кнопка «Месячный отчёт PDF» в шапке
     ========================================================= */
  async function decorateDashboard(head) {
    try {
      const role = window.CURRENT_USER?.rol_nazvanie;

      // Контейнер кнопок справа
      let actions = head.querySelector('.section__actions');
      if (!actions) {
        actions = document.createElement('div');
        actions.className = 'section__actions';
        head.appendChild(actions);
      }

      // Аналитик — кнопка экспорта
      if (role === 'Аналитик') {
        const exportBtn = document.createElement('button');
        exportBtn.className = 'btn';
        exportBtn.innerHTML = `📊 ${T('export.analyst') || 'Скачать Excel-отчёт'}`;
        exportBtn.onclick = () => openExportInNewTab('excel/analyst', { god: new Date().getFullYear() });
        actions.appendChild(exportBtn);
        return;
      }

      // Директор — месячный PDF
      const pds = await window.api('/api/auth/podrazdeleniya');
      if (!pds.length) return;

      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.innerHTML = `📄 ${T('dashboard.monthly_pdf')}`;
      btn.onclick = () => openMonthlyDialog(pds);
      actions.appendChild(btn);
    } catch {}
  }

  function openMonthlyDialog(pds) {
    const now = new Date();
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `
      <div class="modal" style="width: 460px">
        <h3>${T('dashboard.monthly_pdf')}</h3>
        <div class="form-grid">
          <label class="full">${T('budgets.division')}
            <select id="mPd">${pds.map(p => `<option value="${p.id}">${p.nazvanie}</option>`).join('')}</select>
          </label>
          <label>${T('budgets.year')}
            <input type="number" id="mYear" value="${now.getFullYear()}" />
          </label>
          <label>${T('filter.month') || 'Месяц'}
            <select id="mMonth">
              ${[...Array(12).keys()].map(i => `<option value="${i+1}" ${i+1 === now.getMonth()+1 ? 'selected':''}>${i+1}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn" id="mCanc">${T('common.cancel')}</button>
          <button class="btn dark" id="mDownload">⬇ PDF</button>
        </div>
      </div>`;
    document.body.appendChild(bg);
    window.trapFocus(bg.querySelector('.modal'));
    bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
    bg.querySelector('#mCanc').onclick = () => bg.remove();
    const collect = () => ({
      pdId: bg.querySelector('#mPd').value,
      god:  bg.querySelector('#mYear').value,
      m:    bg.querySelector('#mMonth').value,
    });
    bg.querySelector('#mDownload').onclick = () => {
      openExportInNewTab('pdf/monthly', collect()); bg.remove();
    };
  }

  /* =========================================================
     6. РАСХОДЫ — кнопки экспорта, импорт CSV, inline-edit
     ========================================================= */
  function decorateExpenses(head, content) {
    let actions = head.querySelector('.section__actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'section__actions';
      // вставляем перед существующей кнопкой «+ Добавить»
      const addBtn = head.querySelector('#addExpenseBtn');
      if (addBtn) head.insertBefore(actions, addBtn);
      else head.appendChild(actions);
    }

    // CSV-импорт
    const csvBtn = document.createElement('button');
    csvBtn.className = 'btn';
    csvBtn.textContent = T('csv.import');
    csvBtn.onclick = openCsvImportDialog;
    actions.appendChild(csvBtn);

    // Экспорт (читает текущие фильтры)
    const getFilters = () => ({
      from: document.querySelector('#fFrom')?.value || '',
      to:   document.querySelector('#fTo')?.value || '',
      kategoriya: document.querySelector('#fKat')?.value || '',
    });
    const exportBtn = buildExportButton(
      'excel/expenses', null,
      `📊 ${T('export.excel')}`
    );
    // подменим handler на динамический (читает текущие фильтры)
    exportBtn.onclick = () => openExportInNewTab('excel/expenses', getFilters());
    actions.appendChild(exportBtn);

    // Inline-edit для записей prochiy_raskhod (источник = prochiy)
    setTimeout(() => attachExpenseEditing(content), 200);
    // Перевешиваем после load() (там новые data-del) — наблюдаем за #expensesTbl
    const tbl = content.querySelector('#expensesTbl');
    if (tbl) {
      const mo = new MutationObserver(() => attachExpenseEditing(content));
      mo.observe(tbl, { childList: true, subtree: true });
    }
  }

  function attachExpenseEditing(content) {
    const tbl = content.querySelector('#expensesTbl table tbody');
    if (!tbl) return;
    tbl.querySelectorAll('tr').forEach(tr => {
      if (tr.dataset.editAttached) return;
      const cells = tr.querySelectorAll('td');
      // последний td — кнопка удаления (только для prochiy)
      const lastTd = cells[cells.length - 1];
      const delBtn = lastTd?.querySelector('button[data-del]');
      if (!delBtn) return;
      tr.dataset.editAttached = '1';
      const id = delBtn.dataset.del;

      const editBtn = document.createElement('button');
      editBtn.className = 'btn';
      editBtn.style.marginRight = '6px';
      editBtn.textContent = '✎';
      editBtn.title = T('common.edit');
      editBtn.onclick = () => openExpenseEdit(id, tr);
      lastTd.insertBefore(editBtn, delBtn);
    });
  }

  async function openExpenseEdit(id, tr) {
    // данные читаем из ячеек строки + спрашиваем актуальное у API через /expenses?source=prochiy
    const cells = tr.querySelectorAll('td');
    const dateText = cells[0]?.textContent.trim();
    const summText = cells[5]?.textContent.replace(/[^\d.,-]/g, '').replace(',', '.');
    const desc     = cells[4]?.textContent.trim();

    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `
      <div class="modal" style="width: 480px">
        <h3>${T('common.edit')}: ${T('expenses.col_cat')}</h3>
        <div class="form-grid">
          <label>${T('expenses.col_date')}
            <input type="date" id="eDate" />
          </label>
          <label>${T('expenses.col_sum')}, ₽
            <input type="number" id="eSum" min="1" step="100" value="${summText || ''}" />
          </label>
          <label class="full">${T('expenses.col_cat')}
            <select id="eKat">
              <option value="topliv">${T('cat.topliv')}</option>
              <option value="strakhovka">${T('cat.strakhovka')}</option>
              <option value="nalog">${T('cat.nalog')}</option>
              <option value="moyka">${T('cat.moyka')}</option>
              <option value="prochee">${T('cat.prochee')}</option>
            </select>
          </label>
          <label class="full">${T('expenses.col_desc')}
            <textarea id="eDesc" rows="2">${desc !== '—' ? desc : ''}</textarea>
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn" id="eCanc">${T('common.cancel')}</button>
          <button class="btn dark" id="eSave">${T('common.save')}</button>
        </div>
      </div>`;
    document.body.appendChild(bg);
    window.trapFocus(bg.querySelector('.modal'));
    bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
    bg.querySelector('#eCanc').onclick = () => bg.remove();

    // Дата → ISO yyyy-mm-dd: пытаемся через текущую локаль, иначе сегодня
    try {
      const parts = dateText.split('.');
      if (parts.length === 3) bg.querySelector('#eDate').value =
        `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
    } catch {}

    bg.querySelector('#eSave').onclick = async () => {
      try {
        const body = {
          data: bg.querySelector('#eDate').value,
          summa: +bg.querySelector('#eSum').value,
          kategoriya: bg.querySelector('#eKat').value,
          opisanie: bg.querySelector('#eDesc').value || null,
        };
        await window.api('/api/finance/expenses/' + id, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        window.toast(T('toast.expense_updated'), 'success');
        bg.remove();
        // Триггерим перезагрузку таблицы — кликаем «Применить»
        document.querySelector('#applyBtn')?.click();
      } catch (e) { window.toast(e.message, 'error'); }
    };
  }

  /* =========================================================
     7. CSV-импорт
     ========================================================= */
  function openCsvImportDialog() {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `
      <div class="modal" style="width: 540px">
        <h3>${T('csv.title')}</h3>
        <p style="color: var(--c-muted); font-size: 13px; line-height: 1.5; margin: 0 0 14px">
          ${T('csv.hint')}
        </p>
        <button class="btn" id="csvSample" type="button" style="margin-bottom:14px">
          📄 ${T('csv.example')}
        </button>
        <input type="file" id="csvFile" accept=".csv,text/csv" />
        <div id="csvResult" style="margin-top: 14px; font-size: 13px"></div>
        <div class="modal-actions" style="margin-top:16px">
          <button class="btn" id="csvCanc">${T('common.cancel')}</button>
          <button class="btn dark" id="csvSend">${T('csv.upload')}</button>
        </div>
      </div>`;
    document.body.appendChild(bg);
    bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
    bg.querySelector('#csvCanc').onclick = () => bg.remove();
    bg.querySelector('#csvSample').onclick = () => {
      const sample =
        'data,kategoriya,summa,gos_nomer,opisanie\n' +
        '2026-04-15,topliv,4500,А123АА77,Заправка АЗС Лукойл\n' +
        '2026-04-16,moyka,800,А123АА77,Мойка кузова\n' +
        '2026-04-20,strakhovka,18000,Б456ВВ77,ОСАГО годовой\n';
      const blob = new Blob([sample], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'carvix-expenses-sample.csv';
      a.click(); URL.revokeObjectURL(url);
    };
    bg.querySelector('#csvSend').onclick = async () => {
      const file = bg.querySelector('#csvFile').files[0];
      if (!file) return window.toast('Выберите файл', 'error');
      const fd = new FormData();
      fd.append('file', file);
      const btn = bg.querySelector('#csvSend');
      btn.disabled = true; btn.textContent = '...';
      try {
        const res = await fetch('/api/finance/expenses/import-csv', {
          method: 'POST',
          headers: { Authorization: `Bearer ${TOKEN}` },
          body: fd,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

        const result = bg.querySelector('#csvResult');
        if (data.skipped) {
          window.toast(T('toast.import_partial', { n: data.inserted, skipped: data.skipped }), '');
          result.innerHTML = `
            <div style="color: var(--c-good)">✓ ${data.inserted} строк импортировано</div>
            <div style="color: var(--c-bad); margin-top: 6px">⚠ ${data.skipped} пропущено:</div>
            <ul style="margin: 4px 0 0 18px; max-height: 180px; overflow: auto">
              ${(data.errors || []).map(er => `<li>Строка ${er.row}: ${er.reason}</li>`).join('')}
            </ul>`;
        } else {
          window.toast(T('toast.imported', { n: data.inserted }), 'success');
          bg.remove();
          document.querySelector('#applyBtn')?.click();
        }
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        btn.disabled = false; btn.textContent = T('csv.upload');
      }
    };
  }

  /* =========================================================
     8. БЮДЖЕТЫ — редактор-матрица + copy-from-prev + Excel
     ========================================================= */
  async function decorateBudgets(head, content) {
    let actions = head.querySelector('.section__actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'section__actions';
      head.appendChild(actions);
    }

    // Кнопка «Прогноз расходов»
    const fcBtn = document.createElement('button');
    fcBtn.className = 'btn';
    fcBtn.innerHTML = `📈 ${T('forecast.btn')}`;
    fcBtn.onclick = openForecastDialog;
    actions.appendChild(fcBtn);

    // Кнопка «Редактор бюджетов»
    const editBtn = document.createElement('button');
    editBtn.className = 'btn dark';
    editBtn.textContent = '✎ ' + T('budgets.editor');
    editBtn.onclick = openBudgetEditor;
    actions.appendChild(editBtn);

    // Кнопка экспорта Excel
    const expBtn = buildExportButton(
      'excel/budgets',
      null,
      `📊 ${T('budgets.export_excel')}`
    );
    expBtn.onclick = () => openExportInNewTab('excel/budgets', {
      god: document.querySelector('#bGod')?.value || new Date().getFullYear(),
    });
    actions.appendChild(expBtn);
  }

  /* =========================================================
     8.b ПРОГНОЗ РАСХОДОВ — модалка с Chart.js (Holt-Winters)
     ========================================================= */
  async function openForecastDialog() {
    const KATS = [
      { id: '',          label: T('forecast.all_categories') || 'Все категории' },
      { id: 'topliv',    label: T('cat.topliv')    || 'Топливо' },
      { id: 'remont',    label: T('cat.remont')    || 'Ремонт' },
      { id: 'zapchasti', label: T('cat.zapchasti') || 'Запчасти' },
      { id: 'prochee',   label: T('cat.prochee')   || 'Прочее' },
    ];

    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `
      <div class="modal modal--wide forecast-modal">
        <div class="be-head">
          <h3>📈 ${T('forecast.title') || 'Прогноз расходов (Holt-Winters)'}</h3>
          <button class="btn-close" id="fcClose" aria-label="Закрыть">×</button>
        </div>
        <p class="be-intro">${T('forecast.intro') || 'Прогноз построен методом тройного экспоненциального сглаживания на основе исторических расходов за последние 3 года. Серая зона — 95% доверительный интервал.'}</p>

        <div class="be-toolbar">
          <label>${T('forecast.category') || 'Категория'}
            <select id="fcKat">
              ${KATS.map(k => `<option value="${k.id}">${k.label}</option>`).join('')}
            </select>
          </label>
          <label>${T('forecast.horizon') || 'Горизонт (мес.)'}
            <input type="number" id="fcHorizon" value="12" min="1" max="24" style="width:90px" />
          </label>
          <span class="spacer"></span>
          <span id="fcMethodBadge" class="be-status"></span>
          <button class="btn dark" id="fcRefresh">🔄 ${T('forecast.refresh') || 'Обновить'}</button>
        </div>

        <div class="forecast-chart-wrap">
          <canvas id="fcChart"></canvas>
        </div>

        <div class="forecast-summary" id="fcSummary"></div>
      </div>`;
    document.body.appendChild(bg);
    window.trapFocus(bg.querySelector('.modal'));
    bg.addEventListener('click', e => { if (e.target === bg) close(); });
    bg.querySelector('#fcClose').onclick = close;

    let chart = null;
    function close() {
      if (chart) { chart.destroy(); chart = null; }
      bg.remove();
    }

    async function load() {
      const kat = bg.querySelector('#fcKat').value;
      const horizon = +bg.querySelector('#fcHorizon').value || 12;
      const badge = bg.querySelector('#fcMethodBadge');
      const summary = bg.querySelector('#fcSummary');
      badge.textContent = T('forecast.loading') || 'Загрузка…';
      summary.innerHTML = '';

      try {
        const qs = new URLSearchParams({ horizon: String(horizon) });
        if (kat) qs.set('kategoriya', kat);

        const data = await window.api(`/api/finance/reports/forecast?${qs}`);

        const methodLabels = {
          'holt-winters': T('forecast.method.hw')    || 'Holt-Winters (тройное экспоненциальное сглаживание)',
          'linear-trend': T('forecast.method.lin')   || 'Линейная регрессия',
          'mean':         T('forecast.method.mean')  || 'Среднее',
          'no-data':      T('forecast.method.empty') || 'Нет исторических данных',
        };
        badge.textContent = methodLabels[data.method] || data.method;

        if (!data.history.length) {
          summary.innerHTML = `<div class="forecast-empty">${T('forecast.no_history') || 'Нет исторических данных за выбранный период. Введите расходы или измените фильтры.'}</div>`;
          if (chart) { chart.destroy(); chart = null; }
          return;
        }

        renderChart(data);
        renderSummary(data, horizon);
      } catch (e) {
        badge.textContent = '';
        summary.innerHTML = `<div class="forecast-empty" style="color:var(--c-bad)">${e.message}</div>`;
      }
    }

    function fmtMonth(g, m) {
      const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
      return `${months[m - 1]} ${String(g).slice(2)}`;
    }
    function fmtMoney(n) {
      return Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
    }

    function renderChart(data) {
      const labels  = [
        ...data.history.map(p => fmtMonth(p.god, p.mesyats)),
        ...data.forecast.map(p => fmtMonth(p.god, p.mesyats)),
      ];
      const histLen = data.history.length;
      const histData     = [...data.history.map(p => Number(p.summa)), ...new Array(data.forecast.length).fill(null)];
      const fcData       = [
        ...new Array(histLen - 1).fill(null),
        // соединительная точка — последнее значение истории
        Number(data.history[histLen - 1].summa),
        ...data.forecast.map(p => p.point),
      ];
      const lowerBand    = [
        ...new Array(histLen - 1).fill(null),
        Number(data.history[histLen - 1].summa),
        ...data.forecast.map(p => p.lower),
      ];
      const upperBand    = [
        ...new Array(histLen - 1).fill(null),
        Number(data.history[histLen - 1].summa),
        ...data.forecast.map(p => p.upper),
      ];

      const isDark = document.documentElement.dataset.theme === 'dark';
      const accent     = '#b89460';
      const fcColor    = '#10b981';
      const bandColor  = 'rgba(16, 185, 129, 0.12)';
      const gridColor  = isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
      const textColor  = isDark ? '#e9e2d3' : '#33312c';

      if (chart) chart.destroy();
      chart = new Chart(bg.querySelector('#fcChart'), {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: T('forecast.history') || 'Факт',
              data: histData,
              borderColor: accent,
              backgroundColor: 'transparent',
              tension: 0.3,
              spanGaps: false,
              pointRadius: 2,
              pointHoverRadius: 5,
            },
            {
              label: T('forecast.forecast_label') || 'Прогноз',
              data: fcData,
              borderColor: fcColor,
              borderDash: [6, 4],
              backgroundColor: 'transparent',
              tension: 0.3,
              spanGaps: false,
              pointRadius: 2,
              pointHoverRadius: 5,
            },
            {
              label: T('forecast.upper') || 'Верхняя граница CI',
              data: upperBand,
              borderColor: 'transparent',
              backgroundColor: bandColor,
              fill: '+1',                       // заливка ДО следующего dataset (нижней границы)
              tension: 0.3,
              pointRadius: 0,
            },
            {
              label: T('forecast.lower') || 'Нижняя граница CI',
              data: lowerBand,
              borderColor: 'transparent',
              backgroundColor: bandColor,
              fill: false,
              tension: 0.3,
              pointRadius: 0,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              labels: {
                color: textColor,
                filter: (item) => !/CI$/.test(item.text), // не показывать обе границы CI
              },
            },
            tooltip: {
              callbacks: {
                label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y == null ? '—' : fmtMoney(ctx.parsed.y)}`,
              },
            },
          },
          scales: {
            x: { ticks: { color: textColor }, grid: { color: gridColor } },
            y: {
              ticks: { color: textColor, callback: (v) => fmtMoney(v) },
              grid:  { color: gridColor },
              beginAtZero: true,
            },
          },
        },
      });
    }

    function renderSummary(data, horizon) {
      const sumForecast = data.forecast.reduce((s, p) => s + p.point, 0);
      const lastYearSum = data.history.slice(-12).reduce((s, p) => s + Number(p.summa), 0);
      const deltaPct = lastYearSum
        ? Math.round(((sumForecast - lastYearSum) / lastYearSum) * 1000) / 10
        : null;

      const peakIdx = data.forecast.reduce((bi, p, i) => p.point > data.forecast[bi].point ? i : bi, 0);
      const peak = data.forecast[peakIdx];

      const cards = [
        {
          label: T('forecast.sum') || `Прогноз на ${horizon} мес.`,
          value: fmtMoney(sumForecast),
          hint: data.method === 'holt-winters' ? `RMSE ≈ ${fmtMoney(data.rmse)}` : '',
        },
        {
          label: T('forecast.delta_yoy') || 'YoY (год к году)',
          value: deltaPct == null ? '—' : (deltaPct > 0 ? `+${deltaPct}%` : `${deltaPct}%`),
          hint: T('forecast.delta_hint') || 'Прогноз vs последние 12 мес.',
          color: deltaPct == null ? '' : (deltaPct > 5 ? 'bad' : (deltaPct < -5 ? 'good' : '')),
        },
        {
          label: T('forecast.peak') || 'Пиковый месяц',
          value: peak ? fmtMonth(peak.god, peak.mesyats) : '—',
          hint: peak ? fmtMoney(peak.point) : '',
        },
      ];

      bg.querySelector('#fcSummary').innerHTML = cards.map(c => `
        <div class="forecast-card ${c.color || ''}">
          <div class="forecast-card__label">${c.label}</div>
          <div class="forecast-card__value">${c.value}</div>
          ${c.hint ? `<div class="forecast-card__hint">${c.hint}</div>` : ''}
        </div>
      `).join('');
    }

    bg.querySelector('#fcRefresh').onclick = load;
    bg.querySelector('#fcKat').onchange = load;
    bg.querySelector('#fcHorizon').onchange = load;
    load();
  }

  async function openBudgetEditor() {
    const [pds, currentYear] = await Promise.all([
      window.api('/api/auth/podrazdeleniya'),
      Promise.resolve(new Date().getFullYear()),
    ]);

    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `
      <div class="modal modal--wide">
        <div class="be-head">
          <h3>${T('budgets.editor')}</h3>
          <button class="btn-close" id="beClose" aria-label="Закрыть">×</button>
        </div>
        <p class="be-intro">${T('budgets.editor_intro')}</p>

        <div class="be-toolbar">
          <label>${T('budgets.year')}
            <input type="number" id="beYear" value="${currentYear}" min="2020" max="2100" style="width:100px" />
          </label>
          <label>${T('budgets.division')}
            <select id="bePd">
              ${pds.map(p => `<option value="${p.id}">${p.nazvanie}</option>`).join('')}
            </select>
          </label>
          <span class="spacer"></span>
          <details class="be-copy">
            <summary class="btn">↺ ${T('budgets.copy_from_prev')}</summary>
            <div class="be-copy__pop">
              <label>${T('budgets.copy_koeff')}
                <input type="number" id="beKoef" value="1.10" step="0.01" min="0.1" />
              </label>
              <button class="btn dark" id="beDoCopy">${T('budgets.copy_btn')}</button>
            </div>
          </details>
          <span id="beStatus" class="be-status">${T('budgets.no_changes')}</span>
          <button class="btn dark" id="beSave" disabled>${T('budgets.save_all')}</button>
        </div>

        <div class="be-grid-wrap">
          <table class="be-grid" id="beGrid">
            <thead><tr><th>${T('expenses.col_cat')}</th>
              ${[...Array(12)].map((_, i) => `<th>${i + 1}</th>`).join('')}
              <th>Σ</th>
            </tr></thead>
            <tbody id="beBody"></tbody>
          </table>
        </div>
      </div>`;
    document.body.appendChild(bg);

    const cats = ['remont', 'zapchasti', 'topliv', 'prochee'];
    const yearEl = bg.querySelector('#beYear');
    const pdEl   = bg.querySelector('#bePd');
    const body   = bg.querySelector('#beBody');
    const status = bg.querySelector('#beStatus');
    const saveBtn= bg.querySelector('#beSave');

    let original = {}; // кэш «как пришло с сервера» для подсветки изменений

    async function load() {
      body.innerHTML = `<tr><td colspan="14"><div class="loading-screen"><div class="spinner"></div></div></td></tr>`;
      const data = await window.api(
        `/api/finance/budgets?god=${yearEl.value}&podrazdelenie_id=${pdEl.value}`
      );
      // raw data → matrix [cat][month] = plan_summa
      const matrix = {};
      cats.forEach(c => matrix[c] = Array(13).fill(0));
      data.forEach(r => { matrix[r.kategoriya][r.mesyats] = Number(r.plan_summa); });
      original = JSON.parse(JSON.stringify(matrix));

      body.innerHTML = cats.map(c => `
        <tr data-cat="${c}">
          <td class="be-cat">${T('cat.' + c)}</td>
          ${[...Array(12)].map((_, i) =>
            `<td><input type="number" data-m="${i+1}" value="${matrix[c][i+1] || ''}" min="0" step="100" /></td>`
          ).join('')}
          <td class="be-sum">0</td>
        </tr>
      `).join('');

      recalcSums(); updateChangeStatus();
      body.querySelectorAll('input').forEach(i => {
        i.addEventListener('input', () => { recalcSums(); updateChangeStatus(); });
      });
    }

    function recalcSums() {
      body.querySelectorAll('tr[data-cat]').forEach(tr => {
        const inputs = tr.querySelectorAll('input');
        let sum = 0;
        inputs.forEach(i => sum += Number(i.value) || 0);
        tr.querySelector('.be-sum').textContent =
          new Intl.NumberFormat(window.getLang() === 'en' ? 'en-US' : 'ru-RU').format(sum) + ' ₽';
      });
    }
    function collect() {
      const out = [];
      body.querySelectorAll('tr[data-cat]').forEach(tr => {
        const cat = tr.dataset.cat;
        tr.querySelectorAll('input').forEach(i => {
          const m = +i.dataset.m;
          const v = Number(i.value) || 0;
          if (v !== Number(original[cat][m] || 0)) {
            out.push({
              podrazdelenie_id: +pdEl.value,
              god: +yearEl.value,
              mesyats: m,
              kategoriya: cat,
              plan_summa: v,
            });
          }
        });
      });
      return out;
    }
    function updateChangeStatus() {
      const changed = collect().length;
      status.textContent = changed ? T('budgets.changed', { n: changed }) : T('budgets.no_changes');
      saveBtn.disabled = !changed;
    }

    yearEl.onchange = pdEl.onchange = load;

    saveBtn.onclick = async () => {
      const items = collect();
      if (!items.length) return;
      saveBtn.disabled = true;
      try {
        const r = await window.api('/api/finance/budgets/bulk', {
          method: 'POST',
          body: JSON.stringify({ items }),
        });
        window.toast(T('toast.budget_saved', r), 'success');
        await load();
      } catch (e) {
        window.toast(e.message, 'error');
        saveBtn.disabled = false;
      }
    };

    bg.querySelector('#beDoCopy').onclick = async () => {
      const koeff = +bg.querySelector('#beKoef').value || 1.1;
      try {
        const r = await window.api('/api/finance/budgets/copy-from-prev-year', {
          method: 'POST',
          body: JSON.stringify({ god: +yearEl.value, koeff }),
        });
        window.toast(T('toast.copied', { n: r.copied }), 'success');
        bg.querySelector('details.be-copy').open = false;
        load();
      } catch (e) { window.toast(e.message, 'error'); }
    };

    bg.querySelector('#beClose').onclick = () => bg.remove();
    bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });

    load();
  }

  /* =========================================================
     9. TCO — кнопка экспорта Excel
     ========================================================= */
  function decorateTco(head) {
    let actions = head.querySelector('.section__actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'section__actions';
      head.appendChild(actions);
    }
    const exp = buildExportButton('excel/tco', {}, `📊 ${T('tco.export_excel')}`, 'Carvix — TCO');
    actions.appendChild(exp);
  }

  /* =========================================================
     9b. АУДИТ — кнопка экспорта Excel
     ========================================================= */
  function decorateAudit(head) {
    let actions = head.querySelector('.section__actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'section__actions';
      head.appendChild(actions);
    }
    const exp = buildExportButton('excel/audit', {}, `📊 ${T('export.excel')}`);
    actions.appendChild(exp);
  }

  /* =========================================================
     10. ПРИХОДЫ — кнопка добавления, печать M-15.
     ========================================================= */
  function decorateReceipts(head, content) {
    let actions = head.querySelector('.section__actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'section__actions';
      head.appendChild(actions);
    }
    const addBtn = document.createElement('button');
    addBtn.className = 'btn dark';
    addBtn.textContent = T('receipts.add');
    addBtn.onclick = openReceiptCreate;
    actions.appendChild(addBtn);

    // У каждой строки — добавим кнопку «Печать PDF M-15»
    setTimeout(() => attachReceiptPrint(content), 200);
    const list = content.querySelector('#rList');
    if (list) {
      const mo = new MutationObserver(() => attachReceiptPrint(content));
      mo.observe(list, { childList: true, subtree: true });
    }
  }

  function attachReceiptPrint(content) {
    const tbl = content.querySelector('#rList table tbody');
    if (!tbl) return;
    tbl.querySelectorAll('tr[data-id]').forEach(tr => {
      if (tr.dataset.printAttached) return;
      tr.dataset.printAttached = '1';
      const id = tr.dataset.id;
      // вставляем мини-кнопку в последнюю колонку
      const lastTd = tr.querySelector('td:last-child');
      if (!lastTd) return;
      const wrap = document.createElement('span');
      wrap.style.marginLeft = '8px';
      wrap.innerHTML = `<button class="btn" title="PDF M-15">📄</button>`;
      const btn = wrap.querySelector('button');
      btn.onclick = (e) => {
        e.stopPropagation();
        openExportInNewTab('pdf/receipt', { id });
      };
      lastTd.appendChild(wrap);
    });
  }

  /* =========================================================
     11. Создание накладной
     ========================================================= */
  async function openReceiptCreate() {
    const [postavshiki, zapchasti] = await Promise.all([
      window.api('/api/finance/parts/receipts/dictionary/postavshiki'),
      window.api('/api/finance/parts/receipts/dictionary/zapchasti'),
    ]);

    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `
      <div class="modal modal--wide">
        <div class="be-head">
          <h3>${T('receipts.modal_title')}</h3>
          <button class="btn-close" id="rcClose" aria-label="Закрыть">×</button>
        </div>

        <div class="form-grid">
          <label>${T('receipts.supplier')}
            <select id="rcSup">${postavshiki.map(p => `<option value="${p.id}">${p.nazvanie}</option>`).join('')}</select>
          </label>
          <label>${T('receipts.date')}
            <input type="date" id="rcDate" value="${new Date().toISOString().slice(0,10)}" />
          </label>
          <label>${T('receipts.number')}
            <input type="text" id="rcNum" placeholder="ТН-2026/04" />
          </label>
          <label class="full">${T('receipts.comment')}
            <textarea id="rcComm" rows="2"></textarea>
          </label>
        </div>

        <h4 style="margin: 18px 0 8px">${T('receipts.positions')}</h4>
        <table class="rc-grid" id="rcPos">
          <thead><tr>
            <th>${T('receipts.part')}</th>
            <th style="width:90px">${T('receipts.qty')}</th>
            <th style="width:120px">${T('receipts.price')}</th>
            <th style="width:140px">${T('receipts.subtotal')}</th>
            <th style="width:42px"></th>
          </tr></thead>
          <tbody id="rcPosBody"></tbody>
          <tfoot><tr>
            <td colspan="3" style="text-align:right"><strong>${T('receipts.total')}:</strong></td>
            <td><strong id="rcTotal">0 ₽</strong></td>
            <td></td>
          </tr></tfoot>
        </table>
        <button class="btn" id="rcAddPos" style="margin-top:8px">${T('receipts.add_position')}</button>

        <div class="modal-actions" style="margin-top:18px">
          <button class="btn" id="rcCanc">${T('common.cancel')}</button>
          <button class="btn dark" id="rcSave">${T('common.save')}</button>
        </div>
      </div>`;
    document.body.appendChild(bg);
    window.trapFocus(bg.querySelector('.modal'));
    bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
    bg.querySelector('#rcClose').onclick = () => bg.remove();
    bg.querySelector('#rcCanc').onclick = () => bg.remove();

    const body = bg.querySelector('#rcPosBody');
    const totalEl = bg.querySelector('#rcTotal');

    function fmt(v) {
      return new Intl.NumberFormat(window.getLang() === 'en' ? 'en-US' : 'ru-RU')
        .format(Number(v) || 0) + ' ₽';
    }
    function recalcRow(tr) {
      const q = +tr.querySelector('.rc-q').value || 0;
      const p = +tr.querySelector('.rc-p').value || 0;
      tr.querySelector('.rc-sub').textContent = fmt(q * p);
    }
    function recalcTotal() {
      let total = 0;
      body.querySelectorAll('tr').forEach(tr => {
        const q = +tr.querySelector('.rc-q').value || 0;
        const p = +tr.querySelector('.rc-p').value || 0;
        total += q * p;
      });
      totalEl.textContent = fmt(total);
    }

    function addRow() {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <select class="rc-z">
            <option value="">— ${T('receipts.part')} —</option>
            ${zapchasti.map(z => `<option value="${z.id}">${z.naimenovanie}${z.artikul ? ' ('+z.artikul+')' : ''}</option>`).join('')}
          </select>
        </td>
        <td><input type="number" class="rc-q" min="1" step="1" value="1" /></td>
        <td><input type="number" class="rc-p" min="0" step="0.01" /></td>
        <td class="rc-sub">0 ₽</td>
        <td><button class="btn danger rc-del">×</button></td>
      `;
      body.appendChild(tr);
      tr.querySelector('.rc-del').onclick = () => { tr.remove(); recalcTotal(); };
      tr.querySelector('.rc-q').oninput = () => { recalcRow(tr); recalcTotal(); };
      tr.querySelector('.rc-p').oninput = () => { recalcRow(tr); recalcTotal(); };
      // Автоподстановка последней цены при выборе запчасти
      tr.querySelector('.rc-z').onchange = (e) => {
        const id = +e.target.value;
        const z = zapchasti.find(x => x.id === id);
        const priceInput = tr.querySelector('.rc-p');
        if (z && z.posledniaya_tsena && !priceInput.value) {
          priceInput.value = Number(z.posledniaya_tsena).toFixed(2);
          recalcRow(tr); recalcTotal();
        }
      };
    }
    addRow();
    bg.querySelector('#rcAddPos').onclick = addRow;

    bg.querySelector('#rcSave').onclick = async () => {
      const pozitsii = [];
      body.querySelectorAll('tr').forEach(tr => {
        const z  = tr.querySelector('.rc-z').value;
        const q  = +tr.querySelector('.rc-q').value;
        const p  = +tr.querySelector('.rc-p').value;
        if (z && q > 0 && p >= 0) {
          pozitsii.push({ zapchast_id: +z, kolichestvo: q, tsena_za_edinicu: p });
        }
      });
      if (!pozitsii.length) return window.toast(T('receipts.empty_pos'), 'error');

      const body_ = {
        postavshik_id: +bg.querySelector('#rcSup').value,
        data_prikhoda: bg.querySelector('#rcDate').value,
        nomer_nakl:    bg.querySelector('#rcNum').value || null,
        kommentariy:   bg.querySelector('#rcComm').value || null,
        pozitsii,
      };
      try {
        const created = await window.api('/api/finance/parts/receipts', {
          method: 'POST',
          body: JSON.stringify(body_),
        });
        window.toast(T('toast.receipt_saved'), 'success');
        bg.remove();
        // Перерисуем раздел
        if (location.hash.startsWith('#receipts')) {
          location.reload();
        }
        // Сразу предложим открыть PDF M-15
        setTimeout(async () => {
          if (await window.confirmDialog('Открыть PDF приходной накладной М-15?', { icon: '📄', danger: false, title: 'PDF M-15' })) {
            openExportInNewTab('pdf/receipt', { id: created.id });
          }
        }, 600);
      } catch (e) { window.toast(e.message, 'error'); }
    };
  }
})();
