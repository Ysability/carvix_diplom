/**
 * Carvix — экспорт в Excel и PDF.
 *
 *   GET  /api/finance/exports/excel/tco
 *   GET  /api/finance/exports/excel/expenses?from=&to=&kategoriya=
 *   GET  /api/finance/exports/excel/budgets?god=
 *
 *   GET  /api/finance/exports/pdf/receipt/:id
 *   GET  /api/finance/exports/pdf/monthly/:pdId/:god/:m
 *   GET  /api/finance/exports/pdf/writeoff/:remontId
 *
 * Авторизация:
 *   Принимаем токен и из header Authorization: Bearer ..., и из query ?token=...
 *   Это нужно потому, что прямые скачки <a href="..."> не отправляют JWT-заголовок.
 *
 * Кириллица в PDF:
 *   pdfkit использует Helvetica по умолчанию — кириллицы там нет.
 *   Подкладываем DejaVu Sans (public/fonts/). Если шрифта нет — fallback на Helvetica
 *   (русский текст превращается в «????»). Шрифты добавлены в репозиторий.
 */

const express = require('express');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const pool = require('../../db');
const { requireFinanceRead } = require('../../middleware/rbac');

const router = express.Router();

/* =========================================================
   Аутентификация: токен из header или query
   ========================================================= */
function authForExport(req, res, next) {
  let token = null;
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) token = header.slice(7);
  if (!token && req.query && req.query.token) token = String(req.query.token);
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Недействительный токен' });
  }
}

/* =========================================================
   Шрифт для кириллицы в PDF
   ========================================================= */
const FONT_DIR = path.join(__dirname, '..', '..', 'public', 'fonts');
const FONT_REGULAR = path.join(FONT_DIR, 'DejaVuSans.ttf');
const FONT_BOLD    = path.join(FONT_DIR, 'DejaVuSans-Bold.ttf');
const HAS_FONTS = fs.existsSync(FONT_REGULAR) && fs.existsSync(FONT_BOLD);

function applyCyrillicFont(doc) {
  if (HAS_FONTS) {
    doc.registerFont('CyrRegular', FONT_REGULAR);
    doc.registerFont('CyrBold',    FONT_BOLD);
    doc.font('CyrRegular');
  }
}
const setBold    = (doc) => HAS_FONTS ? doc.font('CyrBold')    : doc.font('Helvetica-Bold');
const setRegular = (doc) => HAS_FONTS ? doc.font('CyrRegular') : doc.font('Helvetica');

/* =========================================================
   Утилиты
   ========================================================= */
const KATEGORIYA_LABEL = {
  remont: 'Ремонт', zapchasti: 'Запчасти', topliv: 'Топливо',
  strakhovka: 'Страховка', nalog: 'Налог', moyka: 'Мойка', prochee: 'Прочее',
};
const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

function moneyFmt(v) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(Number(v) || 0) + ' ₽';
}

function styleHeaderRow(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C1B17' } };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF888888' } },
      left: { style: 'thin', color: { argb: 'FF888888' } },
      bottom: { style: 'thin', color: { argb: 'FF888888' } },
      right: { style: 'thin', color: { argb: 'FF888888' } },
    };
  });
  row.height = 26;
}
function applyMoneyFormat(cell) {
  cell.numFmt = '#,##0.00 [$₽-419]';
  cell.alignment = { horizontal: 'right' };
}
function applyBorders(row) {
  row.eachCell(cell => {
    cell.border = {
      top: { style: 'hair', color: { argb: 'FFCCCCCC' } },
      left: { style: 'hair', color: { argb: 'FFCCCCCC' } },
      bottom: { style: 'hair', color: { argb: 'FFCCCCCC' } },
      right: { style: 'hair', color: { argb: 'FFCCCCCC' } },
    };
  });
}

/* =========================================================
   ГЕНЕРАТОРЫ — каждый возвращает { buffer, filename, contentType }.
   ========================================================= */
async function genExcelTco() {
  const { rows } = await pool.pool.query(
    `SELECT v.gos_nomer, v.invent_nomer, v.marka_nazvanie, v.model_nazvanie,
            v.podrazdelenie_nazvanie, v.kolvo_zayavok, v.kolvo_remontov,
            v.itogo_rabot, v.itogo_zapchastey, v.itogo_prochee, v.tco_obshchee
       FROM v_tco_ts v
      ORDER BY v.tco_obshchee DESC`
  );

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Carvix';
  const ws = wb.addWorksheet('TCO', { views: [{ state: 'frozen', ySplit: 4 }] });

  ws.mergeCells('A1:K1');
  ws.getCell('A1').value = 'Carvix — Отчёт TCO по транспортным средствам';
  ws.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF1C1B17' } };
  ws.getCell('A1').alignment = { horizontal: 'center' };
  ws.getRow(1).height = 26;

  ws.mergeCells('A2:K2');
  ws.getCell('A2').value = `Сформировано: ${new Date().toLocaleString('ru-RU')}`;
  ws.getCell('A2').font = { italic: true, size: 10, color: { argb: 'FF888888' } };
  ws.getCell('A2').alignment = { horizontal: 'center' };

  ws.addRow([]);

  const headerRow = ws.addRow([
    'Гос. номер', 'Инв. номер', 'Марка', 'Модель',
    'Подразделение', 'Заявок', 'Ремонтов',
    'Работы, ₽', 'Запчасти, ₽', 'Прочее, ₽', 'TCO итого, ₽',
  ]);
  styleHeaderRow(headerRow);

  let totRabot = 0, totParts = 0, totProchee = 0, totTco = 0;
  rows.forEach(r => {
    const row = ws.addRow([
      r.gos_nomer, r.invent_nomer, r.marka_nazvanie, r.model_nazvanie,
      r.podrazdelenie_nazvanie, r.kolvo_zayavok, r.kolvo_remontov,
      Number(r.itogo_rabot), Number(r.itogo_zapchastey),
      Number(r.itogo_prochee), Number(r.tco_obshchee),
    ]);
    [8, 9, 10, 11].forEach(i => applyMoneyFormat(row.getCell(i)));
    applyBorders(row);
    totRabot   += Number(r.itogo_rabot);
    totParts   += Number(r.itogo_zapchastey);
    totProchee += Number(r.itogo_prochee);
    totTco     += Number(r.tco_obshchee);
  });

  const totalRow = ws.addRow([
    '', '', '', '', 'ИТОГО', '', '', totRabot, totParts, totProchee, totTco,
  ]);
  totalRow.font = { bold: true };
  [8, 9, 10, 11].forEach(i => applyMoneyFormat(totalRow.getCell(i)));
  totalRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5EFE3' } };
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF1C1B17' } },
      bottom: { style: 'medium', color: { argb: 'FF1C1B17' } },
      left: { style: 'thin' }, right: { style: 'thin' },
    };
  });

  [12, 12, 16, 16, 22, 9, 11, 14, 14, 14, 16].forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 11 } };

  const buffer = await wb.xlsx.writeBuffer();
  return {
    buffer,
    filename: `carvix-tco-${new Date().toISOString().slice(0, 10)}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

async function genExcelExpenses({ from, to, kategoriya } = {}) {
  const where = [];
  const params = [];
  const UNIFIED = `
    SELECT 'remont_rabot' AS source, r.id::text AS source_id, r.data_okonchaniya::date AS data,
           'remont' AS kategoriya, r.stoimost_rabot AS summa,
           ts.gos_nomer, pd.nazvanie AS podrazdelenie_nazvanie,
           'Стоимость работ ремонта №'||r.id AS opisanie
      FROM remont r JOIN zayavka z ON z.id=r.zayavka_id
      JOIN transportnoe_sredstvo ts ON ts.id=z.ts_id
      JOIN podrazdelenie pd ON pd.id=ts.podrazdelenie_id
     WHERE r.data_okonchaniya IS NOT NULL AND r.stoimost_rabot>0
    UNION ALL
    SELECT 'remont_zapchasti', r.id::text, r.data_okonchaniya::date, 'zapchasti',
           r.stoimost_zapchastey, ts.gos_nomer, pd.nazvanie,
           'Стоимость запчастей ремонта №'||r.id
      FROM remont r JOIN zayavka z ON z.id=r.zayavka_id
      JOIN transportnoe_sredstvo ts ON ts.id=z.ts_id
      JOIN podrazdelenie pd ON pd.id=ts.podrazdelenie_id
     WHERE r.data_okonchaniya IS NOT NULL AND r.stoimost_zapchastey>0
    UNION ALL
    SELECT 'prochiy', pr.id::text, pr.data, pr.kategoriya, pr.summa,
           ts.gos_nomer, pd.nazvanie, pr.opisanie
      FROM prochiy_raskhod pr
      LEFT JOIN transportnoe_sredstvo ts ON ts.id=pr.ts_id
      LEFT JOIN podrazdelenie pd ON pd.id=COALESCE(pr.podrazdelenie_id, ts.podrazdelenie_id)
  `;
  if (from)       { params.push(from);       where.push(`x.data >= $${params.length}::date`); }
  if (to)         { params.push(to);         where.push(`x.data <= $${params.length}::date`); }
  if (kategoriya) { params.push(kategoriya); where.push(`x.kategoriya = $${params.length}`); }
  const sql = `SELECT * FROM (${UNIFIED}) x ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY x.kategoriya, x.data DESC`;
  const { rows } = await pool.pool.query(sql, params);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Carvix';
  const ws = wb.addWorksheet('Расходы', { views: [{ state: 'frozen', ySplit: 4 }] });

  ws.mergeCells('A1:F1');
  ws.getCell('A1').value = 'Carvix — Реестр расходов';
  ws.getCell('A1').font = { bold: true, size: 16 };
  ws.getCell('A1').alignment = { horizontal: 'center' };
  ws.getRow(1).height = 26;

  ws.mergeCells('A2:F2');
  ws.getCell('A2').value = [
    from ? `с ${from}` : null, to ? `по ${to}` : null,
    kategoriya ? `категория: ${KATEGORIYA_LABEL[kategoriya] || kategoriya}` : null,
  ].filter(Boolean).join('  ·  ') || 'все периоды и категории';
  ws.getCell('A2').font = { italic: true, color: { argb: 'FF888888' } };
  ws.getCell('A2').alignment = { horizontal: 'center' };
  ws.addRow([]);

  const header = ws.addRow(['Дата', 'Гос. №', 'Подразделение', 'Описание', 'Источник', 'Сумма, ₽']);
  styleHeaderRow(header);
  [12, 12, 24, 50, 18, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const byCat = rows.reduce((acc, r) => {
    const k = r.kategoriya || 'prochee';
    (acc[k] = acc[k] || []).push(r);
    return acc;
  }, {});

  let grandTotal = 0;
  Object.keys(byCat).sort().forEach(cat => {
    const grpRow = ws.addRow([KATEGORIYA_LABEL[cat] || cat, '', '', '', '', '']);
    ws.mergeCells(`A${grpRow.number}:F${grpRow.number}`);
    grpRow.font = { bold: true, size: 12, color: { argb: 'FF1C1B17' } };
    grpRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECE2CE' } };
    grpRow.alignment = { horizontal: 'left', indent: 1 };

    let catSum = 0;
    byCat[cat].forEach(r => {
      const row = ws.addRow([
        new Date(r.data),
        r.gos_nomer || '—',
        r.podrazdelenie_nazvanie || '—',
        r.opisanie || '—',
        r.source,
        Number(r.summa),
      ]);
      row.getCell(1).numFmt = 'dd.mm.yyyy';
      applyMoneyFormat(row.getCell(6));
      applyBorders(row);
      catSum += Number(r.summa);
    });

    const subtotal = ws.addRow(['', '', '', '', `Итого «${KATEGORIYA_LABEL[cat] || cat}»:`, catSum]);
    subtotal.font = { bold: true, italic: true };
    applyMoneyFormat(subtotal.getCell(6));
    subtotal.eachCell(c => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5EFE3' } };
    });
    grandTotal += catSum;
  });

  const grand = ws.addRow(['', '', '', '', 'ВСЕГО:', grandTotal]);
  grand.font = { bold: true, size: 12 };
  applyMoneyFormat(grand.getCell(6));
  grand.eachCell(c => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C1B17' } };
    c.font = { ...c.font, color: { argb: 'FFFFFFFF' } };
  });

  const buffer = await wb.xlsx.writeBuffer();
  return {
    buffer,
    filename: `carvix-expenses-${new Date().toISOString().slice(0, 10)}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

async function genExcelBudgets({ god } = {}) {
  const targetGod = parseInt(god, 10) || new Date().getFullYear();
  const { rows } = await pool.pool.query(
    `SELECT v.podrazdelenie_nazvanie, v.god, v.mesyats, v.kategoriya,
            v.plan_summa, v.fakt_summa, v.otklonenie, v.protsent_ispolneniya
       FROM v_byudzhet_plan_fakt v
      WHERE v.god = $1
      ORDER BY v.podrazdelenie_nazvanie, v.mesyats, v.kategoriya`,
    [targetGod]
  );

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Carvix';
  const ws = wb.addWorksheet(`План-факт ${targetGod}`, { views: [{ state: 'frozen', ySplit: 4 }] });

  ws.mergeCells('A1:G1');
  ws.getCell('A1').value = `Carvix — План / факт за ${targetGod} год`;
  ws.getCell('A1').font = { bold: true, size: 16 };
  ws.getCell('A1').alignment = { horizontal: 'center' };
  ws.getRow(1).height = 26;

  ws.mergeCells('A2:G2');
  ws.getCell('A2').value = `Сформировано: ${new Date().toLocaleString('ru-RU')}`;
  ws.getCell('A2').font = { italic: true, size: 10, color: { argb: 'FF888888' } };
  ws.getCell('A2').alignment = { horizontal: 'center' };
  ws.addRow([]);

  const header = ws.addRow([
    'Подразделение', 'Месяц', 'Категория',
    'План, ₽', 'Факт, ₽', 'Отклонение, ₽', '% исполнения',
  ]);
  styleHeaderRow(header);
  [28, 12, 14, 16, 16, 18, 14].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const firstDataRow = ws.rowCount + 1;
  let totPlan = 0, totFakt = 0;
  rows.forEach(r => {
    const plan = Number(r.plan_summa);
    const fakt = Number(r.fakt_summa);
    const dev  = Number(r.otklonenie);
    const pct  = Number(r.protsent_ispolneniya) / 100;
    const row = ws.addRow([
      r.podrazdelenie_nazvanie,
      MONTHS_RU[r.mesyats - 1] || r.mesyats,
      KATEGORIYA_LABEL[r.kategoriya] || r.kategoriya,
      plan, fakt, dev, pct,
    ]);
    [4, 5, 6].forEach(i => applyMoneyFormat(row.getCell(i)));
    row.getCell(7).numFmt = '0.0%';
    applyBorders(row);
    totPlan += plan; totFakt += fakt;
  });
  const lastDataRow = ws.rowCount;

  if (lastDataRow >= firstDataRow) {
    ws.addConditionalFormatting({
      ref: `G${firstDataRow}:G${lastDataRow}`,
      rules: [
        { type: 'cellIs', operator: 'greaterThan', formulae: ['1'], priority: 1, style:
          { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFD2D2' } },
            font: { color: { argb: 'FFB23A3A' }, bold: true } } },
        { type: 'cellIs', operator: 'between', formulae: ['0.8', '1'], priority: 2, style:
          { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFD2E8D6' } },
            font: { color: { argb: 'FF4A7C59' } } } },
        { type: 'cellIs', operator: 'lessThan', formulae: ['0.8'], priority: 3, style:
          { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFEFEFEF' } } } },
      ],
    });
    ws.addConditionalFormatting({
      ref: `F${firstDataRow}:F${lastDataRow}`,
      rules: [
        { type: 'cellIs', operator: 'lessThan', formulae: ['0'], priority: 1, style:
          { font: { color: { argb: 'FFB23A3A' }, bold: true } } },
        { type: 'cellIs', operator: 'greaterThan', formulae: ['0'], priority: 2, style:
          { font: { color: { argb: 'FF4A7C59' } } } },
      ],
    });
  }

  const totalRow = ws.addRow([
    'ИТОГО', '', '', totPlan, totFakt, totPlan - totFakt,
    totPlan ? totFakt / totPlan : 0,
  ]);
  totalRow.font = { bold: true, size: 12 };
  [4, 5, 6].forEach(i => applyMoneyFormat(totalRow.getCell(i)));
  totalRow.getCell(7).numFmt = '0.0%';
  totalRow.eachCell(c => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C1B17' } };
    c.font = { ...c.font, color: { argb: 'FFFFFFFF' } };
  });

  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 7 } };

  const buffer = await wb.xlsx.writeBuffer();
  return {
    buffer,
    filename: `carvix-budgets-${targetGod}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

/* ----------- PDF: helpers ----------- */
function buildPdfBuffer(builder) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    applyCyrillicFont(doc);
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    Promise.resolve(builder(doc)).then(() => doc.end()).catch(reject);
  });
}

async function genPdfReceipt({ id }) {
  id = parseInt(id, 10);
  if (!id) throw new Error('Неверный id');
  const [hdrRows] = await pool.execute(
    `SELECT p.*, ps.nazvanie AS postavshik_nazvanie, ps.kontakty,
            s.fio AS sozdatel_fio
       FROM prikhod_zapchasti p
       JOIN postavshik ps    ON ps.id = p.postavshik_id
       LEFT JOIN sotrudnik s ON s.id = p.sozdatel_id
      WHERE p.id = ?`,
    [id]
  );
  if (!hdrRows.length) { const e = new Error('Накладная не найдена'); e.status = 404; throw e; }
  const hdr = hdrRows[0];

  const [pos] = await pool.execute(
    `SELECT z.naimenovanie, z.artikul, z.edinitsa_izmereniya AS ed_izm,
            pp.kolichestvo, pp.tsena_za_edinicu,
            (pp.kolichestvo * pp.tsena_za_edinicu) AS itogo
       FROM prikhod_zapchasti_pozitsii pp
       JOIN zapchast z ON z.id = pp.zapchast_id
      WHERE pp.prikhod_id = ?
      ORDER BY pp.id`,
    [id]
  );

  const buffer = await buildPdfBuffer(doc => {
    setBold(doc); doc.fontSize(9);
    doc.text('Унифицированная форма № М-15', { align: 'right' });
    doc.text('Утв. Постановлением Госкомстата России от 30.10.97 № 71а', { align: 'right' });
    doc.moveDown(0.5);
    setRegular(doc);

    doc.fontSize(16); setBold(doc);
    doc.text('НАКЛАДНАЯ', { align: 'center' });
    doc.fontSize(13);
    doc.text(`на отпуск материалов на сторону № ${hdr.nomer_nakl || id}`, { align: 'center' });
    setRegular(doc); doc.fontSize(10);
    const dateStr = new Date(hdr.data_prikhoda).toLocaleDateString('ru-RU');
    doc.text(`Дата составления: ${dateStr}`, { align: 'center' });
    doc.moveDown(1);

    const lblW = 130;
    const drawKV = (k, v) => {
      const y = doc.y;
      setBold(doc); doc.text(k, 40, y, { width: lblW });
      setRegular(doc); doc.text(v || '—', 40 + lblW + 4, y);
      doc.moveDown(0.4);
    };
    drawKV('Поставщик:',     hdr.postavshik_nazvanie);
    drawKV('Контакты:',      hdr.kontakty);
    drawKV('Получатель:',    'Carvix — автопарк');
    drawKV('Принял:',        hdr.sozdatel_fio);
    if (hdr.kommentariy) drawKV('Примечание:', hdr.kommentariy);
    doc.moveDown(0.6);

    const tableTop = doc.y;
    const colX = [40, 60, 230, 310, 360, 410, 470, 555];
    const colHeads = ['№', 'Наименование', 'Артикул', 'Ед.изм.', 'Кол-во', 'Цена', 'Сумма'];

    setBold(doc); doc.fontSize(9);
    doc.rect(40, tableTop, 515, 22).fillAndStroke('#1C1B17', '#1C1B17');
    doc.fillColor('white');
    colHeads.forEach((h, i) => {
      doc.text(h, colX[i] + 2, tableTop + 6, { width: colX[i + 1] - colX[i] - 4 });
    });
    doc.fillColor('black'); setRegular(doc);

    let y = tableTop + 22;
    let totalSum = 0;
    pos.forEach((p, idx) => {
      const naimHeight = doc.heightOfString(p.naimenovanie || '', { width: colX[2] - colX[1] - 4 });
      const rowHeight = Math.max(20, naimHeight + 8);
      doc.rect(40, y, 515, rowHeight).stroke('#CCCCCC');
      doc.text(String(idx + 1),                colX[0] + 2, y + 5, { width: colX[1] - colX[0] - 4 });
      doc.text(p.naimenovanie || '',           colX[1] + 2, y + 5, { width: colX[2] - colX[1] - 4 });
      doc.text(p.artikul || '—',               colX[2] + 2, y + 5, { width: colX[3] - colX[2] - 4 });
      doc.text(p.ed_izm || 'шт',               colX[3] + 2, y + 5, { width: colX[4] - colX[3] - 4 });
      doc.text(String(p.kolichestvo),          colX[4] + 2, y + 5, { width: colX[5] - colX[4] - 4, align: 'right' });
      doc.text(moneyFmt(p.tsena_za_edinicu),   colX[5] + 2, y + 5, { width: colX[6] - colX[5] - 4, align: 'right' });
      doc.text(moneyFmt(p.itogo),              colX[6] + 2, y + 5, { width: colX[7] - colX[6] - 4, align: 'right' });
      y += rowHeight;
      totalSum += Number(p.itogo);
      if (y > 740) { doc.addPage(); y = 40; }
    });

    doc.rect(40, y, 515, 24).fillAndStroke('#F5EFE3', '#1C1B17');
    doc.fillColor('black'); setBold(doc);
    doc.text('ИТОГО:', colX[5] - 50, y + 7, { width: 50 + colX[6] - colX[5], align: 'right' });
    doc.text(moneyFmt(totalSum), colX[6] + 2, y + 7,
      { width: colX[7] - colX[6] - 4, align: 'right' });
    setRegular(doc);
    y += 30;

    doc.fontSize(10);
    doc.text(`Сумма к оплате: ${moneyFmt(hdr.summa_obshaya || totalSum)}`, 40, y);
    y += 30;
    doc.text('Сдал: ____________________ / ____________________ /', 40, y);
    y += 25;
    doc.text(`Принял: ${hdr.sozdatel_fio || '____________________'}  / ____________________ /`, 40, y);
    y += 35;
    setBold(doc); doc.fontSize(8); doc.fillColor('#888');
    doc.text(`Документ сформирован системой Carvix · ${new Date().toLocaleString('ru-RU')}`,
      40, y, { align: 'center', width: 515 });
  });

  return {
    buffer,
    filename: `carvix-receipt-m15-${hdr.nomer_nakl || id}.pdf`,
    contentType: 'application/pdf',
  };
}

async function genPdfMonthly({ pdId, god, m }) {
  pdId = parseInt(pdId, 10);
  god  = parseInt(god, 10);
  m    = parseInt(m, 10);
  if (!pdId || !god || !m || m < 1 || m > 12) {
    const e = new Error('Параметры pdId/god/m обязательны'); e.status = 400; throw e;
  }

  const [pdRows] = await pool.execute('SELECT id, nazvanie FROM podrazdelenie WHERE id = ?', [pdId]);
  if (!pdRows.length) { const e = new Error('Подразделение не найдено'); e.status = 404; throw e; }
  const pd = pdRows[0];

  const [budget] = await pool.execute(
    `SELECT kategoriya, plan_summa, fakt_summa, otklonenie, protsent_ispolneniya
       FROM v_byudzhet_plan_fakt
      WHERE podrazdelenie_id = ? AND god = ? AND mesyats = ?`,
    [pdId, god, m]
  );

  const [tsList] = await pool.execute(
    `SELECT v.gos_nomer, v.marka_nazvanie, v.model_nazvanie, v.tco_obshchee, v.kolvo_remontov
       FROM v_tco_ts v
      WHERE v.podrazdelenie_nazvanie = ?
      ORDER BY v.tco_obshchee DESC LIMIT 10`,
    [pd.nazvanie]
  );

  const buffer = await buildPdfBuffer(doc => {
    setBold(doc); doc.fontSize(20);
    doc.fillColor('#1C1B17').text('Carvix', { align: 'left' });
    setRegular(doc); doc.fontSize(10).fillColor('#666666');
    doc.text('Финансовый модуль автопарка', { align: 'left' });
    doc.moveDown(1);

    setBold(doc); doc.fontSize(16).fillColor('black');
    doc.text(`Месячный отчёт — ${pd.nazvanie}`, { align: 'center' });
    setRegular(doc); doc.fontSize(12).fillColor('#666666');
    doc.text(`${MONTHS_RU[m - 1]} ${god}`, { align: 'center' });
    doc.moveDown(1.5);

    setBold(doc); doc.fontSize(13).fillColor('black');
    doc.text('1. План / Факт по категориям', 40);
    doc.moveDown(0.5);
    setRegular(doc); doc.fontSize(10);

    if (!budget.length) {
      doc.fillColor('#888').text('Бюджет на этот период не задан.'); doc.fillColor('black');
    } else {
      const tTop = doc.y;
      const cx = [40, 180, 280, 380, 480, 555];
      doc.rect(40, tTop, 515, 20).fillAndStroke('#1C1B17', '#1C1B17');
      doc.fillColor('white').fontSize(9); setBold(doc);
      ['Категория', 'План', 'Факт', 'Отклонение', '% исп.'].forEach((h, i) => {
        doc.text(h, cx[i] + 2, tTop + 6, { width: cx[i + 1] - cx[i] - 4 });
      });
      setRegular(doc); doc.fillColor('black').fontSize(10);
      let yy = tTop + 20;
      let totPlan = 0, totFakt = 0;
      budget.forEach(b => {
        doc.rect(40, yy, 515, 20).stroke('#CCCCCC');
        doc.text(KATEGORIYA_LABEL[b.kategoriya] || b.kategoriya, cx[0] + 2, yy + 5,
          { width: cx[1] - cx[0] - 4 });
        doc.text(moneyFmt(b.plan_summa), cx[1] + 2, yy + 5,
          { width: cx[2] - cx[1] - 4, align: 'right' });
        doc.text(moneyFmt(b.fakt_summa), cx[2] + 2, yy + 5,
          { width: cx[3] - cx[2] - 4, align: 'right' });
        const dev = Number(b.otklonenie);
        doc.fillColor(dev < 0 ? '#B23A3A' : '#4A7C59');
        doc.text((dev < 0 ? '−' : '+') + moneyFmt(Math.abs(dev)).replace(' ₽', '') + ' ₽',
          cx[3] + 2, yy + 5, { width: cx[4] - cx[3] - 4, align: 'right' });
        doc.fillColor('black');
        doc.text(`${b.protsent_ispolneniya}%`, cx[4] + 2, yy + 5,
          { width: cx[5] - cx[4] - 4, align: 'right' });
        yy += 20;
        totPlan += Number(b.plan_summa);
        totFakt += Number(b.fakt_summa);
      });
      doc.rect(40, yy, 515, 22).fillAndStroke('#F5EFE3', '#1C1B17');
      doc.fillColor('black'); setBold(doc);
      doc.text('ИТОГО', cx[0] + 2, yy + 7, { width: cx[1] - cx[0] - 4 });
      doc.text(moneyFmt(totPlan), cx[1] + 2, yy + 7, { width: cx[2] - cx[1] - 4, align: 'right' });
      doc.text(moneyFmt(totFakt), cx[2] + 2, yy + 7, { width: cx[3] - cx[2] - 4, align: 'right' });
      setRegular(doc);
      doc.y = yy + 30;
    }

    doc.moveDown(1.5);
    setBold(doc); doc.fontSize(13);
    doc.text('2. Топ-10 машин по TCO', 40);
    doc.moveDown(0.5);
    setRegular(doc); doc.fontSize(10);

    if (!tsList.length) {
      doc.fillColor('#888').text('Машин в подразделении нет.'); doc.fillColor('black');
    } else {
      tsList.forEach((t, i) => {
        doc.text(`${i + 1}.  ${t.gos_nomer}  ${t.marka_nazvanie || ''} ${t.model_nazvanie || ''}  ·  ${t.kolvo_remontov} ремонтов  ·  TCO ${moneyFmt(t.tco_obshchee)}`);
      });
    }

    doc.moveDown(2);
    setBold(doc); doc.fontSize(8); doc.fillColor('#888');
    doc.text(`Документ сформирован системой Carvix · ${new Date().toLocaleString('ru-RU')}`,
      40, doc.y, { align: 'center', width: 515 });
  });

  return {
    buffer,
    filename: `carvix-monthly-${pdId}-${god}-${m}.pdf`,
    contentType: 'application/pdf',
  };
}

async function genPdfWriteoff({ remontId }) {
  remontId = parseInt(remontId, 10);
  if (!remontId) { const e = new Error('Неверный remontId'); e.status = 400; throw e; }

  const [rRows] = await pool.execute(
    `SELECT r.id, r.data_okonchaniya, r.stoimost_zapchastey, r.stoimost_rabot,
            z.id AS zayavka_id, ts.gos_nomer, ts.invent_nomer,
            ma.nazvanie AS marka, mo.nazvanie AS model,
            pd.nazvanie AS podrazdelenie,
            tr.nazvanie AS tip_remonta,
            s.fio AS mekhanik
       FROM remont r
       JOIN zayavka z ON z.id = r.zayavka_id
       JOIN transportnoe_sredstvo ts ON ts.id = z.ts_id
       JOIN model mo  ON mo.id = ts.model_id
       JOIN marka ma  ON ma.id = mo.marka_id
       JOIN podrazdelenie pd ON pd.id = ts.podrazdelenie_id
       JOIN tip_remonta tr   ON tr.id = z.tip_remonta_id
       LEFT JOIN sotrudnik s ON s.id = r.mekhanik_id
      WHERE r.id = ?`,
    [remontId]
  );
  if (!rRows.length) { const e = new Error('Ремонт не найден'); e.status = 404; throw e; }
  const r = rRows[0];

  const [parts] = await pool.execute(
    `SELECT z.naimenovanie, z.artikul, z.edinitsa_izmereniya AS ed_izm,
            iz.kolichestvo, iz.tsena_za_edinicu,
            (iz.kolichestvo * iz.tsena_za_edinicu) AS itogo
       FROM ispolzovanie_zapchastey iz
       JOIN zapchast z ON z.id = iz.zapchast_id
      WHERE iz.remont_id = ?`,
    [remontId]
  );

  const buffer = await buildPdfBuffer(doc => {
    setBold(doc); doc.fontSize(9);
    doc.text('Утверждаю', { align: 'right' });
    setRegular(doc);
    doc.text('_______________________ / Директор /', { align: 'right' });
    doc.text(`«____» ____________ ${new Date().getFullYear()} г.`, { align: 'right' });
    doc.moveDown(2);

    setBold(doc); doc.fontSize(18);
    doc.text(`АКТ № ${remontId}`, { align: 'center' });
    doc.fontSize(13);
    doc.text('списания запчастей и материалов', { align: 'center' });
    setRegular(doc); doc.fontSize(10);
    doc.moveDown(1);

    doc.text(`Дата окончания ремонта: ${new Date(r.data_okonchaniya).toLocaleDateString('ru-RU')}`);
    doc.text(`Транспортное средство: ${r.gos_nomer}  ·  инв. № ${r.invent_nomer}  ·  ${r.marka} ${r.model}`);
    doc.text(`Подразделение: ${r.podrazdelenie}`);
    doc.text(`Тип ремонта: ${r.tip_remonta}  ·  заявка № ${r.zayavka_id}`);
    doc.text(`Механик: ${r.mekhanik || '—'}`);
    doc.moveDown(1);

    doc.text('Настоящим актом подтверждается, что в ходе ремонта были использованы и подлежат списанию следующие материалы:');
    doc.moveDown(0.6);

    if (!parts.length) {
      doc.fillColor('#888').text('Запчасти не списывались (ремонт без замены деталей).');
      doc.fillColor('black');
    } else {
      const tTop = doc.y;
      const cx = [40, 60, 240, 320, 360, 415, 475, 555];
      doc.rect(40, tTop, 515, 20).fillAndStroke('#1C1B17', '#1C1B17');
      doc.fillColor('white').fontSize(9); setBold(doc);
      ['№', 'Наименование', 'Артикул', 'Ед.', 'Кол-во', 'Цена', 'Сумма'].forEach((h, i) => {
        doc.text(h, cx[i] + 2, tTop + 6, { width: cx[i + 1] - cx[i] - 4 });
      });
      setRegular(doc); doc.fillColor('black').fontSize(10);
      let yy = tTop + 20;
      let total = 0;
      parts.forEach((p, idx) => {
        doc.rect(40, yy, 515, 20).stroke('#CCCCCC');
        doc.text(String(idx + 1),       cx[0] + 2, yy + 5, { width: cx[1] - cx[0] - 4 });
        doc.text(p.naimenovanie,        cx[1] + 2, yy + 5, { width: cx[2] - cx[1] - 4 });
        doc.text(p.artikul || '—',      cx[2] + 2, yy + 5, { width: cx[3] - cx[2] - 4 });
        doc.text(p.ed_izm || 'шт',      cx[3] + 2, yy + 5, { width: cx[4] - cx[3] - 4 });
        doc.text(String(p.kolichestvo), cx[4] + 2, yy + 5, { width: cx[5] - cx[4] - 4, align: 'right' });
        doc.text(moneyFmt(p.tsena_za_edinicu), cx[5] + 2, yy + 5, { width: cx[6] - cx[5] - 4, align: 'right' });
        doc.text(moneyFmt(p.itogo),     cx[6] + 2, yy + 5, { width: cx[7] - cx[6] - 4, align: 'right' });
        yy += 20; total += Number(p.itogo);
      });
      doc.rect(40, yy, 515, 22).fillAndStroke('#F5EFE3', '#1C1B17');
      doc.fillColor('black'); setBold(doc);
      doc.text('ИТОГО:', cx[5] - 60, yy + 7, { width: 60 + (cx[6] - cx[5]), align: 'right' });
      doc.text(moneyFmt(total), cx[6] + 2, yy + 7, { width: cx[7] - cx[6] - 4, align: 'right' });
      setRegular(doc);
      doc.y = yy + 36;
    }

    doc.moveDown(2);
    doc.text('Перечисленные материалы фактически использованы в ремонте, осмотр выполнен, претензий по качеству нет.');
    doc.moveDown(2);
    doc.text('Сдал (механик):     ____________________  /  ' + (r.mekhanik || '____________________') + '  /');
    doc.moveDown(1);
    doc.text('Принял (кладовщик): ____________________  /  ____________________  /');
    doc.moveDown(2);
    setBold(doc); doc.fontSize(8); doc.fillColor('#888');
    doc.text(`Документ сформирован системой Carvix · ${new Date().toLocaleString('ru-RU')}`,
      { align: 'center' });
  });

  return {
    buffer,
    filename: `carvix-act-writeoff-${remontId}.pdf`,
    contentType: 'application/pdf',
  };
}

/* =========================================================
   Хелпер: отдать буфер как файл
   ========================================================= */
function sendBuffer(res, { buffer, filename, contentType }, disposition = 'inline') {
  res.setHeader('Content-Type', contentType);
  // RFC 5987 для filename* — поддержка кириллицы в имени файла
  res.setHeader('Content-Disposition',
    `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.setHeader('Content-Length', buffer.length);
  res.end(buffer);
}

/* =========================================================
   Маршруты
   ========================================================= */
router.get('/excel/tco', authForExport, requireFinanceRead, async (req, res) => {
  try { sendBuffer(res, await genExcelTco(), 'attachment'); }
  catch (e) { console.error('[exports/excel/tco]', e);
    res.status(e.status || 500).json({ error: e.message }); }
});
router.get('/excel/expenses', authForExport, requireFinanceRead, async (req, res) => {
  try { sendBuffer(res, await genExcelExpenses(req.query), 'attachment'); }
  catch (e) { console.error('[exports/excel/expenses]', e);
    res.status(e.status || 500).json({ error: e.message }); }
});
router.get('/excel/budgets', authForExport, requireFinanceRead, async (req, res) => {
  try { sendBuffer(res, await genExcelBudgets(req.query), 'attachment'); }
  catch (e) { console.error('[exports/excel/budgets]', e);
    res.status(e.status || 500).json({ error: e.message }); }
});

router.get('/pdf/receipt/:id', authForExport, requireFinanceRead, async (req, res) => {
  try { sendBuffer(res, await genPdfReceipt({ id: req.params.id }), 'inline'); }
  catch (e) { console.error('[exports/pdf/receipt]', e);
    res.status(e.status || 500).json({ error: e.message }); }
});
router.get('/pdf/monthly/:pdId/:god/:m', authForExport, requireFinanceRead, async (req, res) => {
  try {
    sendBuffer(res, await genPdfMonthly({
      pdId: req.params.pdId, god: req.params.god, m: req.params.m,
    }), 'inline');
  } catch (e) { console.error('[exports/pdf/monthly]', e);
    res.status(e.status || 500).json({ error: e.message }); }
});
router.get('/pdf/writeoff/:remontId', authForExport, requireFinanceRead, async (req, res) => {
  try { sendBuffer(res, await genPdfWriteoff({ remontId: req.params.remontId }), 'inline'); }
  catch (e) { console.error('[exports/pdf/writeoff]', e);
    res.status(e.status || 500).json({ error: e.message }); }
});

module.exports = router;

