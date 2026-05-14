-- =========================================================
-- Carvix — DDL (PostgreSQL)
-- Идемпотентная схема: безопасно выполнять много раз.
-- =========================================================

-- 1. Марка
CREATE TABLE IF NOT EXISTS marka (
  id        SERIAL PRIMARY KEY,
  nazvanie  VARCHAR(255) NOT NULL
);

-- 2. Модель
CREATE TABLE IF NOT EXISTS model (
  id        SERIAL PRIMARY KEY,
  marka_id  INT NOT NULL REFERENCES marka(id),
  nazvanie  VARCHAR(255) NOT NULL
);

-- 3. Подразделение
CREATE TABLE IF NOT EXISTS podrazdelenie (
  id        SERIAL PRIMARY KEY,
  nazvanie  VARCHAR(255) NOT NULL,
  adres     VARCHAR(255)
);

-- 4. Роль
CREATE TABLE IF NOT EXISTS rol (
  id        SERIAL PRIMARY KEY,
  nazvanie  VARCHAR(255) NOT NULL
);

-- 5. Сотрудник
CREATE TABLE IF NOT EXISTS sotrudnik (
  id                SERIAL PRIMARY KEY,
  fio               VARCHAR(255) NOT NULL,
  login             VARCHAR(100) NOT NULL UNIQUE,
  parol_hash        VARCHAR(255) NOT NULL,
  rol_id            INT NOT NULL REFERENCES rol(id),
  podrazdelenie_id  INT NOT NULL REFERENCES podrazdelenie(id)
);

-- 6. Транспортное средство
CREATE TABLE IF NOT EXISTS transportnoe_sredstvo (
  id                    SERIAL PRIMARY KEY,
  gos_nomer             VARCHAR(50) NOT NULL,
  invent_nomer          VARCHAR(50) NOT NULL,
  model_id              INT NOT NULL REFERENCES model(id),
  podrazdelenie_id      INT NOT NULL REFERENCES podrazdelenie(id),
  probeg                INT,
  data_vypuska          DATE,
  tekuschee_sostoyanie  VARCHAR(100),
  sozdatel_id           INT REFERENCES sotrudnik(id)  -- кто создал ТС, для приватности у обычных пользователей
);

-- Миграция для существующих БД (PG 9.6+): добавляем sozdatel_id, если его ещё нет.
ALTER TABLE transportnoe_sredstvo ADD COLUMN IF NOT EXISTS sozdatel_id INT REFERENCES sotrudnik(id);

-- 7. Статус
CREATE TABLE IF NOT EXISTS status (
  id        SERIAL PRIMARY KEY,
  nazvanie  VARCHAR(100) NOT NULL
);

-- 8. Тип ремонта
CREATE TABLE IF NOT EXISTS tip_remonta (
  id          SERIAL PRIMARY KEY,
  nazvanie    VARCHAR(100) NOT NULL,
  kategoriya  VARCHAR(100)
);

-- 9. Поставщик
CREATE TABLE IF NOT EXISTS postavshik (
  id        SERIAL PRIMARY KEY,
  nazvanie  VARCHAR(255) NOT NULL,
  kontakty  VARCHAR(255),
  adres     VARCHAR(255)
);

-- 10. Запчасть
CREATE TABLE IF NOT EXISTS zapchast (
  id                 SERIAL PRIMARY KEY,
  naimenovanie       VARCHAR(255) NOT NULL,
  artikul            VARCHAR(100),
  postavshik_id      INT REFERENCES postavshik(id),
  tsena              NUMERIC(10,2),
  ostatok_na_sklade  INT,
  kategoriya         VARCHAR(100)
);

-- 11. Заявка
CREATE TABLE IF NOT EXISTS zayavka (
  id              SERIAL PRIMARY KEY,
  data_sozdaniya  TIMESTAMP NOT NULL,
  sozdatel_id     INT NOT NULL REFERENCES sotrudnik(id),
  ts_id           INT NOT NULL REFERENCES transportnoe_sredstvo(id),
  tip_remonta_id  INT NOT NULL REFERENCES tip_remonta(id),
  opisanie        TEXT,
  status_id       INT NOT NULL REFERENCES status(id),
  prioritet       INT,
  data_rezhima    TIMESTAMP
);

-- 11.1 История статусов заявки (таймлайн)
CREATE TABLE IF NOT EXISTS zayavka_status_istoriya (
  id              SERIAL PRIMARY KEY,
  zayavka_id      INT NOT NULL REFERENCES zayavka(id) ON DELETE CASCADE,
  status_id       INT NOT NULL REFERENCES status(id),
  status_nazvanie VARCHAR(100) NOT NULL,
  sotrudnik_id    INT REFERENCES sotrudnik(id),
  sotrudnik_fio   VARCHAR(255),
  data_izmeneniya TIMESTAMP NOT NULL DEFAULT NOW(),
  kommentariy     TEXT
);
CREATE INDEX IF NOT EXISTS idx_zsi_zayavka ON zayavka_status_istoriya(zayavka_id);

-- 12. Ремонт
CREATE TABLE IF NOT EXISTS remont (
  id                   SERIAL PRIMARY KEY,
  zayavka_id           INT NOT NULL REFERENCES zayavka(id),
  data_nachala         TIMESTAMP,
  data_okonchaniya     TIMESTAMP,
  mekhanik_id          INT REFERENCES sotrudnik(id),
  glavniy_mekhanik_id  INT REFERENCES sotrudnik(id),
  stoimost_rabot       NUMERIC(10,2),
  stoimost_zapchastey  NUMERIC(10,2),
  kommentariy          TEXT,
  itog                 VARCHAR(255),
  garantiyny_srok      INT CHECK (garantiyny_srok >= 0) -- гарантийный срок в днях
);

-- 13. Использование запчастей
CREATE TABLE IF NOT EXISTS ispolzovanie_zapchastey (
  remont_id        INT NOT NULL REFERENCES remont(id),
  zapchast_id      INT NOT NULL REFERENCES zapchast(id),
  kolichestvo      INT NOT NULL,
  tsena_na_moment  NUMERIC(10,2),
  PRIMARY KEY (remont_id, zapchast_id)
);

-- 14. Вложения
CREATE TABLE IF NOT EXISTS vlozhenie (
  id             SERIAL PRIMARY KEY,
  zayavka_id     INT REFERENCES zayavka(id),
  remont_id      INT REFERENCES remont(id),
  put_faila      VARCHAR(255) NOT NULL,
  tip_faila      VARCHAR(50),
  data_zagruzki  TIMESTAMP
);

-- =========================================================
-- ФИНАНСОВЫЙ МОДУЛЬ — таблицы учёта затрат и расходов
-- =========================================================

-- 15. Приход запчастей (заголовок накладной от поставщика)
CREATE TABLE IF NOT EXISTS prikhod_zapchasti (
  id             SERIAL PRIMARY KEY,
  postavshik_id  INT NOT NULL REFERENCES postavshik(id),
  data_prikhoda  DATE NOT NULL,
  nomer_nakl     VARCHAR(50),
  summa_obshaya  NUMERIC(12,2) NOT NULL CHECK (summa_obshaya >= 0),
  kommentariy    TEXT,
  sozdatel_id    INT REFERENCES sotrudnik(id)
);

-- 16. Позиции приходной накладной
CREATE TABLE IF NOT EXISTS prikhod_zapchasti_pozitsii (
  id                SERIAL PRIMARY KEY,
  prikhod_id        INT NOT NULL REFERENCES prikhod_zapchasti(id) ON DELETE CASCADE,
  zapchast_id       INT NOT NULL REFERENCES zapchast(id),
  kolichestvo       INT NOT NULL CHECK (kolichestvo > 0),
  tsena_za_edinicu  NUMERIC(10,2) NOT NULL CHECK (tsena_za_edinicu >= 0)
);

-- 17. Тарифы нормо-часов (по типам ремонта, с историей изменений)
CREATE TABLE IF NOT EXISTS tarif_rabot (
  id              SERIAL PRIMARY KEY,
  tip_remonta_id  INT NOT NULL REFERENCES tip_remonta(id),
  tsena_za_chas   NUMERIC(10,2) NOT NULL CHECK (tsena_za_chas >= 0),
  data_s          DATE NOT NULL,
  data_po         DATE
);

-- 18. Бюджеты подразделений (план) — по месяцам и категориям
CREATE TABLE IF NOT EXISTS byudzhet (
  id                SERIAL PRIMARY KEY,
  podrazdelenie_id  INT NOT NULL REFERENCES podrazdelenie(id),
  god               INT NOT NULL CHECK (god BETWEEN 2020 AND 2100),
  mesyats           INT NOT NULL CHECK (mesyats BETWEEN 1 AND 12),
  kategoriya        VARCHAR(50) NOT NULL,    -- remont | zapchasti | topliv | prochee
  plan_summa        NUMERIC(12,2) NOT NULL CHECK (plan_summa >= 0),
  UNIQUE (podrazdelenie_id, god, mesyats, kategoriya)
);

-- 19. Прочие расходы автопарка (топливо, страховка, налоги, мойка...)
CREATE TABLE IF NOT EXISTS prochiy_raskhod (
  id                SERIAL PRIMARY KEY,
  ts_id             INT REFERENCES transportnoe_sredstvo(id),
  podrazdelenie_id  INT REFERENCES podrazdelenie(id),
  data              DATE NOT NULL,
  kategoriya        VARCHAR(50) NOT NULL,    -- topliv | strakhovka | nalog | moyka | prochee
  summa             NUMERIC(10,2) NOT NULL CHECK (summa >= 0),
  opisanie          TEXT
);

-- 20. Нормо-часы по конкретному ремонту (труд механиков)
CREATE TABLE IF NOT EXISTS remont_normy (
  remont_id    INT NOT NULL REFERENCES remont(id) ON DELETE CASCADE,
  mekhanik_id  INT NOT NULL REFERENCES sotrudnik(id),
  chasy        NUMERIC(5,2) NOT NULL CHECK (chasy > 0),
  tarif_id     INT REFERENCES tarif_rabot(id),
  PRIMARY KEY (remont_id, mekhanik_id)
);

-- 21. Аудит финансовых операций (audit log)
CREATE TABLE IF NOT EXISTS finansoviy_log (
  id              SERIAL PRIMARY KEY,
  data_operatsii  TIMESTAMP NOT NULL DEFAULT NOW(),
  sotrudnik_id    INT REFERENCES sotrudnik(id),
  tip_operatsii   VARCHAR(50) NOT NULL,
  obyekt_tablitsa VARCHAR(50),
  obyekt_id       INT,
  summa           NUMERIC(12,2),
  kommentariy     TEXT
);

-- Индексы под аналитические запросы
CREATE INDEX IF NOT EXISTS idx_prochiy_raskhod_data       ON prochiy_raskhod(data);
CREATE INDEX IF NOT EXISTS idx_prochiy_raskhod_ts         ON prochiy_raskhod(ts_id);
CREATE INDEX IF NOT EXISTS idx_byudzhet_period            ON byudzhet(god, mesyats);
CREATE INDEX IF NOT EXISTS idx_remont_data_okonchaniya    ON remont(data_okonchaniya);
CREATE INDEX IF NOT EXISTS idx_finansoviy_log_data        ON finansoviy_log(data_operatsii);

-- 22. Сообщения в чате заявки
CREATE TABLE IF NOT EXISTS zayavka_soobshenie (
  id             SERIAL PRIMARY KEY,
  zayavka_id     INT NOT NULL REFERENCES zayavka(id) ON DELETE CASCADE,
  avtor_id       INT NOT NULL REFERENCES sotrudnik(id),
  tekst          TEXT NOT NULL,
  data_sozdaniya TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_zs_zayavka ON zayavka_soobshenie(zayavka_id);

-- =========================================================
-- VIEW для отчётов и аналитики
-- =========================================================

-- TCO (Total Cost of Ownership) по каждому транспортному средству
CREATE OR REPLACE VIEW v_tco_ts AS
SELECT
  ts.id                                                AS ts_id,
  ts.gos_nomer,
  ts.invent_nomer,
  ma.nazvanie                                          AS marka_nazvanie,
  mo.nazvanie                                          AS model_nazvanie,
  pd.nazvanie                                          AS podrazdelenie_nazvanie,
  COUNT(DISTINCT z.id)                                 AS kolvo_zayavok,
  COUNT(DISTINCT r.id)                                 AS kolvo_remontov,
  COALESCE(SUM(r.stoimost_rabot), 0)                   AS itogo_rabot,
  COALESCE(SUM(r.stoimost_zapchastey), 0)              AS itogo_zapchastey,
  COALESCE((SELECT SUM(summa) FROM prochiy_raskhod pr2
              WHERE pr2.ts_id = ts.id), 0)             AS itogo_prochee,
  COALESCE(SUM(r.stoimost_rabot + r.stoimost_zapchastey), 0)
    + COALESCE((SELECT SUM(summa) FROM prochiy_raskhod pr3
                  WHERE pr3.ts_id = ts.id), 0)         AS tco_obshchee
FROM transportnoe_sredstvo ts
LEFT JOIN model         mo ON mo.id = ts.model_id
LEFT JOIN marka         ma ON ma.id = mo.marka_id
LEFT JOIN podrazdelenie pd ON pd.id = ts.podrazdelenie_id
LEFT JOIN zayavka       z  ON z.ts_id = ts.id
LEFT JOIN remont        r  ON r.zayavka_id = z.id
GROUP BY ts.id, ma.nazvanie, mo.nazvanie, pd.nazvanie;

-- Фактические расходы по подразделениям, помесячно, по категориям
CREATE OR REPLACE VIEW v_fakt_po_podrazdeleniyu AS
SELECT
  pd.id                              AS podrazdelenie_id,
  pd.nazvanie                        AS podrazdelenie_nazvanie,
  EXTRACT(YEAR  FROM x.data)::INT    AS god,
  EXTRACT(MONTH FROM x.data)::INT    AS mesyats,
  x.kategoriya                       AS kategoriya,
  SUM(x.summa)                       AS fakt_summa
FROM (
  -- Стоимость работ (закрытые ремонты)
  SELECT
    ts.podrazdelenie_id,
    r.data_okonchaniya::date AS data,
    'remont'                 AS kategoriya,
    r.stoimost_rabot         AS summa
  FROM remont r
  JOIN zayavka z                ON z.id = r.zayavka_id
  JOIN transportnoe_sredstvo ts ON ts.id = z.ts_id
  WHERE r.data_okonchaniya IS NOT NULL AND r.stoimost_rabot > 0

  UNION ALL

  -- Стоимость запчастей (закрытые ремонты)
  SELECT
    ts.podrazdelenie_id,
    r.data_okonchaniya::date AS data,
    'zapchasti'              AS kategoriya,
    r.stoimost_zapchastey    AS summa
  FROM remont r
  JOIN zayavka z                ON z.id = r.zayavka_id
  JOIN transportnoe_sredstvo ts ON ts.id = z.ts_id
  WHERE r.data_okonchaniya IS NOT NULL AND r.stoimost_zapchastey > 0

  UNION ALL

  -- Прочие расходы
  SELECT
    COALESCE(pr.podrazdelenie_id, ts.podrazdelenie_id) AS podrazdelenie_id,
    pr.data                                            AS data,
    pr.kategoriya                                      AS kategoriya,
    pr.summa                                           AS summa
  FROM prochiy_raskhod pr
  LEFT JOIN transportnoe_sredstvo ts ON ts.id = pr.ts_id
) x
JOIN podrazdelenie pd ON pd.id = x.podrazdelenie_id
GROUP BY pd.id, pd.nazvanie,
         EXTRACT(YEAR FROM x.data), EXTRACT(MONTH FROM x.data),
         x.kategoriya;

-- План/факт по бюджетам с процентом исполнения
CREATE OR REPLACE VIEW v_byudzhet_plan_fakt AS
SELECT
  b.id                                              AS byudzhet_id,
  b.podrazdelenie_id,
  pd.nazvanie                                       AS podrazdelenie_nazvanie,
  b.god,
  b.mesyats,
  b.kategoriya,
  b.plan_summa,
  COALESCE(f.fakt_summa, 0)                         AS fakt_summa,
  b.plan_summa - COALESCE(f.fakt_summa, 0)          AS otklonenie,
  CASE
    WHEN b.plan_summa = 0 THEN 0
    ELSE ROUND(COALESCE(f.fakt_summa, 0) / b.plan_summa * 100, 1)
  END                                               AS protsent_ispolneniya
FROM byudzhet b
JOIN podrazdelenie pd ON pd.id = b.podrazdelenie_id
LEFT JOIN v_fakt_po_podrazdeleniyu f
  ON f.podrazdelenie_id = b.podrazdelenie_id
 AND f.god              = b.god
 AND f.mesyats          = b.mesyats
 AND f.kategoriya       = b.kategoriya;
