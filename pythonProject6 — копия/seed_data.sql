-- =========================================================
-- Carvix — полное наполнение БД демо-данными (PostgreSQL)
-- Применять ПОСЛЕ schema.sql.
-- Пароль для всех тестовых сотрудников: "password"
-- Запуск: npm run seed:demo  (или: psql -f seed_data.sql)
-- =========================================================

-- ---------- 0. Очистка всех таблиц ----------
TRUNCATE TABLE
  finansoviy_log,
  remont_normy,
  prochiy_raskhod,
  byudzhet,
  tarif_rabot,
  prikhod_zapchasti_pozitsii,
  prikhod_zapchasti,
  ispolzovanie_zapchastey,
  vlozhenie,
  remont,
  zayavka,
  zapchast,
  postavshik,
  tip_remonta,
  status,
  transportnoe_sredstvo,
  sotrudnik,
  rol,
  podrazdelenie,
  model,
  marka
RESTART IDENTITY CASCADE;

-- ---------- 1. Марки ----------
INSERT INTO marka (id, nazvanie) VALUES
  (1, 'КАМАЗ'),
  (2, 'MAN'),
  (3, 'Volvo'),
  (4, 'Mercedes-Benz'),
  (5, 'ГАЗ'),
  (6, 'МАЗ'),
  (7, 'Scania'),
  (8, 'УАЗ');

-- ---------- 2. Модели ----------
INSERT INTO model (id, marka_id, nazvanie) VALUES
  (1,  1, '65115'),
  (2,  1, '5320'),
  (3,  2, 'TGA 26.430'),
  (4,  2, 'TGS 18.440'),
  (5,  3, 'FH16'),
  (6,  3, 'FM12'),
  (7,  4, 'Actros 1845'),
  (8,  4, 'Sprinter 311'),
  (9,  5, 'Газель Next'),
  (10, 5, 'Соболь Бизнес'),
  (11, 6, '6312'),
  (12, 7, 'R 450'),
  (13, 8, 'Patriot');

-- ---------- 3. Подразделения ----------
INSERT INTO podrazdelenie (id, nazvanie) VALUES
  (1, 'Главное управление'),
  (2, 'Автопарк №1'),
  (3, 'Автопарк №2'),
  (4, 'Ремонтный цех'),
  (5, 'Склад запчастей');

-- ---------- 4. Роли ----------
INSERT INTO rol (id, nazvanie) VALUES
  (1, 'Аналитик'),
  (2, 'Диспетчер'),
  (3, 'Механик'),
  (4, 'Главный механик'),
  (5, 'Директор'),
  (6, 'Пользователь');

-- ---------- 5. Сотрудники (пароль для всех: "password") ----------
INSERT INTO sotrudnik (id, fio, login, parol_hash, rol_id, podrazdelenie_id) VALUES
  (1,  'Иванов Иван Иванович',          'ivanov',    '$2a$10$ZlNgC3Fd6lyC2w2cejPgTeKHBts3OGbrXmo69lCnAbxHuEhWRZANS', 5, 1),
  (2,  'Петров Пётр Петрович',          'petrov',    '$2a$10$ZlNgC3Fd6lyC2w2cejPgTeKHBts3OGbrXmo69lCnAbxHuEhWRZANS', 4, 4),
  (3,  'Сидоров Алексей Олегович',      'sidorov',   '$2a$10$ZlNgC3Fd6lyC2w2cejPgTeKHBts3OGbrXmo69lCnAbxHuEhWRZANS', 3, 4),
  (4,  'Кузнецов Дмитрий Сергеевич',    'kuznetsov', '$2a$10$ZlNgC3Fd6lyC2w2cejPgTeKHBts3OGbrXmo69lCnAbxHuEhWRZANS', 3, 4),
  (5,  'Морозова Анна Викторовна',      'morozova',  '$2a$10$ZlNgC3Fd6lyC2w2cejPgTeKHBts3OGbrXmo69lCnAbxHuEhWRZANS', 2, 1),
  (6,  'Волкова Екатерина Игоревна',    'volkova',   '$2a$10$ZlNgC3Fd6lyC2w2cejPgTeKHBts3OGbrXmo69lCnAbxHuEhWRZANS', 1, 1),
  (7,  'Соколов Михаил Андреевич',      'sokolov',   '$2a$10$ZlNgC3Fd6lyC2w2cejPgTeKHBts3OGbrXmo69lCnAbxHuEhWRZANS', 6, 2),
  (8,  'Лебедев Артём Викторович',      'lebedev',   '$2a$10$ZlNgC3Fd6lyC2w2cejPgTeKHBts3OGbrXmo69lCnAbxHuEhWRZANS', 6, 3),
  (9,  'Новиков Юрий Павлович',         'novikov',   '$2a$10$ZlNgC3Fd6lyC2w2cejPgTeKHBts3OGbrXmo69lCnAbxHuEhWRZANS', 3, 4),
  (10, 'Орлова Светлана Николаевна',    'orlova',    '$2a$10$ZlNgC3Fd6lyC2w2cejPgTeKHBts3OGbrXmo69lCnAbxHuEhWRZANS', 2, 1),
  (11, 'Зайцев Игорь Анатольевич',      'zaytsev',   '$2a$10$ZlNgC3Fd6lyC2w2cejPgTeKHBts3OGbrXmo69lCnAbxHuEhWRZANS', 6, 2),
  (12, 'Фролова Мария Алексеевна',      'frolova',   '$2a$10$ZlNgC3Fd6lyC2w2cejPgTeKHBts3OGbrXmo69lCnAbxHuEhWRZANS', 1, 1);

-- ---------- 6. Транспортные средства ----------
INSERT INTO transportnoe_sredstvo (id, gos_nomer, invent_nomer, model_id, podrazdelenie_id, probeg, data_vypuska, tekuschee_sostoyanie) VALUES
  (1,  'А123ВС777', 'INV-0001', 1,  2, 142500, '2018-04-15', 'В работе'),
  (2,  'В456ЕК777', 'INV-0002', 3,  2,  98000, '2020-02-10', 'На ТО'),
  (3,  'Е789РТ199', 'INV-0003', 5,  3, 215300, '2016-09-22', 'В работе'),
  (4,  'Н321КМ150', 'INV-0004', 7,  3,  67400, '2021-11-05', 'В работе'),
  (5,  'Р654СТ777', 'INV-0005', 9,  2,  45100, '2022-03-19', 'В ремонте'),
  (6,  'У987ВН199', 'INV-0006', 11, 3, 178900, '2017-07-12', 'В работе'),
  (7,  'О246АЕ150', 'INV-0007', 12, 2,  33200, '2023-01-08', 'В работе'),
  (8,  'С135ТУ77',  'INV-0008', 8,  1,  88700, '2019-06-30', 'На ТО'),
  (9,  'К864ОР197', 'INV-0009', 13, 1,  56400, '2020-12-14', 'В работе'),
  (10, 'Т579МН50',  'INV-0010', 4,  3, 124000, '2018-10-25', 'В ремонте'),
  (11, 'М112ХУ77',  'INV-0011', 2,  2, 305000, '2014-08-03', 'В работе'),
  (12, 'А777АА777', 'INV-0012', 6,  3,  72500, '2021-05-21', 'В работе');

-- ---------- 7. Статусы заявок ----------
INSERT INTO status (id, nazvanie) VALUES
  (1, 'Новая'),
  (2, 'В работе'),
  (3, 'Выполнена'),
  (4, 'Отклонена'),
  (5, 'Ожидание запчастей'),
  (6, 'На согласовании');

-- ---------- 8. Типы ремонта ----------
INSERT INTO tip_remonta (id, nazvanie, kategoriya) VALUES
  (1, 'ТО-1',                       'Плановый'),
  (2, 'ТО-2',                       'Плановый'),
  (3, 'Текущий ремонт',             'Внеплановый'),
  (4, 'Капитальный ремонт',         'Плановый'),
  (5, 'Неисправность двигателя',    'Внеплановый'),
  (6, 'Замена тормозных колодок',   'Внеплановый'),
  (7, 'Сезонная замена шин',        'Плановый'),
  (8, 'Электрика',                  'Внеплановый');

-- ---------- 9. Поставщики ----------
INSERT INTO postavshik (id, nazvanie, kontakty, adres) VALUES
  (1, 'АвтоЗапчасть-Сервис', '+7 (495) 123-45-67, info@az-service.ru',  'г. Москва, ул. Промышленная, 14'),
  (2, 'ТруКамаз',            '+7 (843) 222-33-44, sales@trukamaz.ru',   'г. Казань, ул. Заводская, 9'),
  (3, 'Volvo Parts RU',      '+7 (812) 555-66-77, ru@volvoparts.com',   'г. Санкт-Петербург, Софийская ул., 60'),
  (4, 'AutoOil Group',       '+7 (495) 777-88-99, oil@autooil.ru',      'г. Москва, Дмитровское ш., 100'),
  (5, 'ШинТорг',             '+7 (499) 100-20-30, sales@shintorg.ru',   'г. Москва, МКАД 41 км'),
  (6, 'ЭлектроАвто',         '+7 (495) 321-32-13, info@elektroauto.ru', 'г. Подольск, ул. Кирова, 25');

-- ---------- 10. Запчасти ----------
INSERT INTO zapchast (id, naimenovanie, artikul, postavshik_id, tsena, ostatok_na_sklade, kategoriya) VALUES
  (1,  'Масло моторное 10W-40, 5 л',     'AO-1040-5',   4,  2400.00,  35, 'Масло'),
  (2,  'Фильтр масляный',                'OF-K65115',   2,   850.00,  80, 'Фильтр'),
  (3,  'Фильтр воздушный',               'AF-MAN-TGA',  1,  1300.00,  42, 'Фильтр'),
  (4,  'Тормозные колодки передние',     'BP-V-FH16-F', 3,  5200.00,  18, 'Тормозные колодки'),
  (5,  'Тормозные колодки задние',       'BP-V-FH16-R', 3,  4800.00,  22, 'Тормозные колодки'),
  (6,  'Шина 315/80 R22.5',              'TR-31580225', 5, 18900.00,  24, 'Шины'),
  (7,  'Аккумулятор 190 А·ч',            'BAT-190',     6, 17500.00,   6, 'Электрика'),
  (8,  'Стартер',                        'ST-K65115',   2, 22300.00,   4, 'Электрика'),
  (9,  'Ремень ГРМ',                     'BG-MB-A',     1,  3100.00,  12, 'Ремни'),
  (10, 'Антифриз G12, 5 л',              'AF-G12-5',    4,  1200.00,  50, 'Жидкости'),
  (11, 'Тосол, 10 л',                    'AF-T-10',     4,  1900.00,  28, 'Жидкости'),
  (12, 'Лампа H7',                       'LMP-H7',      6,   350.00, 100, 'Электрика'),
  (13, 'Свечи зажигания (комплект 4 шт)','SP-4-NGK',    6,  2200.00,  40, 'Электрика'),
  (14, 'Диск тормозной передний',        'BD-V-F',      3,  6800.00,  10, 'Тормозная система'),
  (15, 'Сцепление в сборе',              'CL-MB-A',     1, 38500.00,   3, 'Трансмиссия');

-- ---------- 11. Заявки ----------
INSERT INTO zayavka (id, data_sozdaniya, sozdatel_id, ts_id, tip_remonta_id, opisanie, status_id, prioritet, data_rezhima) VALUES
  (1,  '2026-01-12 09:15:00', 7,  1, 1, 'Плановое ТО-1, пробег 142 500 км',         3, 3, '2026-01-12 10:00:00'),
  (2,  '2026-01-20 11:42:00', 8,  3, 5, 'Двигатель плохо запускается на холодную',  3, 2, '2026-01-20 12:30:00'),
  (3,  '2026-02-05 08:20:00', 7,  2, 6, 'Скрип передних тормозов',                  3, 4, '2026-02-05 09:10:00'),
  (4,  '2026-02-15 14:05:00', 5,  6, 4, 'Стук в двигателе, требуется капремонт',    3, 1, '2026-02-15 15:00:00'),
  (5,  '2026-02-28 10:30:00', 8,  4, 7, 'Замена шин на летние',                     3, 5, '2026-02-28 11:00:00'),
  (6,  '2026-03-08 13:15:00', 7,  7, 1, 'ТО-1',                                     3, 3, '2026-03-08 14:00:00'),
  (7,  '2026-03-15 09:00:00', 5,  8, 8, 'Не работает фара ближнего света',          3, 4, '2026-03-15 09:30:00'),
  (8,  '2026-03-22 16:40:00', 8,  9, 2, 'Плановое ТО-2',                            3, 3, '2026-03-22 17:00:00'),
  (9,  '2026-04-05 08:50:00', 7, 11, 5, 'Падает давление масла',                    3, 1, '2026-04-05 09:30:00'),
  (10, '2026-04-12 12:00:00', 5, 10, 4, 'Капитальный ремонт КПП',                   2, 1, '2026-04-12 12:30:00'),
  (11, '2026-04-18 09:20:00', 8,  1, 6, 'Замена задних колодок',                    1, 3, NULL),
  (12, '2026-04-22 11:00:00', 7,  3, 3, 'Течь антифриза',                           1, 2, NULL),
  (13, '2026-04-05 10:15:00', 11,11, 3, 'Стук в подвеске',                          4, 4, '2026-04-05 11:00:00'),
  (14, '2026-04-08 15:00:00', 7, 12, 2, 'Плановое ТО-2 (пробег 70 000)',            3, 3, '2026-04-08 16:00:00'),
  (15, '2026-04-25 10:00:00', 8,  5, 3, 'Не заводится после простоя',               2, 2, '2026-04-25 11:00:00');

-- ---------- 12. Ремонты ----------
INSERT INTO remont (id, zayavka_id, data_nachala, data_okonchaniya, mekhanik_id, glavniy_mekhanik_id, stoimost_rabot, stoimost_zapchastey, kommentariy, itog) VALUES
  (1,  1,  '2026-01-12 11:00:00', '2026-01-12 14:30:00', 3, 2,  3600.00,  3250.00, 'Замена масла и фильтров. Всё штатно.',                'Проблема устранена'),
  (2,  2,  '2026-01-20 13:00:00', '2026-01-21 18:00:00', 4, 2, 14400.00,  3500.00, 'Чистка форсунок, замена свечей',                      'Проблема устранена'),
  (3,  3,  '2026-02-05 10:00:00', '2026-02-05 15:00:00', 9, 2,  4000.00, 10000.00, 'Замена передних колодок и одного диска',              'Проблема устранена'),
  (4,  4,  '2026-02-16 09:00:00', '2026-02-22 17:00:00', 3, 2, 75000.00, 95000.00, 'Капитальный ремонт ДВС: ГБЦ, поршневая, ГРМ',         'Проблема устранена'),
  (5,  5,  '2026-02-28 12:00:00', '2026-02-28 17:00:00', 4, 2,  2800.00, 75600.00, 'Замена 4 шин 315/80 R22.5 на летние',                 'Проблема устранена'),
  (6,  6,  '2026-03-08 15:00:00', '2026-03-08 18:00:00', 9, 2,  3200.00,  3100.00, 'ТО-1 по регламенту',                                  'Проблема устранена'),
  (7,  7,  '2026-03-15 10:00:00', '2026-03-15 10:45:00', 9, 2,   650.00,   700.00, 'Замена ламп H7, диагностика проводки',                'Проблема устранена'),
  (8,  8,  '2026-03-23 08:00:00', '2026-03-23 13:30:00', 4, 2,  4500.00,  4550.00, 'ТО-2: масло, фильтры, антифриз, проверка тормозов',  'Проблема устранена'),
  (9,  9,  '2026-04-05 14:00:00', '2026-04-07 16:00:00', 3, 2, 22000.00, 24000.00, 'Замена масляного насоса, ремонт поддона',             'Проблема устранена'),
  (10, 10, '2026-04-13 09:00:00', NULL,                  3, 2,     0.00,     0.00, 'Разборка КПП, дефектовка',                            NULL),
  (11, 14, '2026-04-08 17:00:00', '2026-04-08 21:30:00', 4, 2,  4500.00,  4550.00, 'ТО-2 МАЗ 6312 (пробег 72 500)',                       'Проблема устранена'),
  (12, 15, '2026-04-25 13:00:00', NULL,                  9, 2,     0.00,     0.00, 'Диагностика стартера и АКБ',                          NULL);

-- ---------- 13. Использование запчастей ----------
INSERT INTO ispolzovanie_zapchastey (remont_id, zapchast_id, kolichestvo, tsena_na_moment) VALUES
  (1, 1,  1, 2400.00),
  (1, 2,  1,  850.00),
  (2, 13, 1, 2200.00),
  (2, 12, 4,  350.00),
  (3, 4,  1, 5200.00),
  (3, 14, 1, 6800.00),
  (4, 9,  2, 3100.00),
  (4, 1,  6, 2400.00),
  (4, 7,  1,17500.00),
  (5, 6,  4,18900.00),
  (6, 1,  1, 2400.00),
  (6, 2,  1,  850.00),
  (7, 12, 2,  350.00),
  (8, 1,  1, 2400.00),
  (8, 2,  1,  850.00),
  (8, 3,  1, 1300.00),
  (9, 1,  4, 2400.00),
  (9, 10, 2, 1200.00),
  (11, 1, 1, 2400.00),
  (11, 2, 1,  850.00),
  (11, 3, 1, 1300.00);

-- ---------- 14. Вложения ----------
INSERT INTO vlozhenie (id, zayavka_id, remont_id, put_faila, tip_faila, data_zagruzki) VALUES
  (1, 4,    NULL, '/uploads/2026/02/15/zayavka_4_engine_knock.jpg', 'jpg', '2026-02-15 14:20:00'),
  (2, NULL, 3,    '/uploads/2026/02/05/remont_3_pads.jpg',          'jpg', '2026-02-05 15:10:00'),
  (3, 9,    NULL, '/uploads/2026/04/05/zayavka_9_oil.jpg',          'jpg', '2026-04-05 09:00:00'),
  (4, NULL, 1,    '/uploads/2026/01/12/remont_1_done.jpg',          'jpg', '2026-01-12 14:35:00'),
  (5, 5,    NULL, '/uploads/2026/02/28/zayavka_5_tires.png',        'png', '2026-02-28 10:35:00'),
  (6, NULL, 8,    '/uploads/2026/03/23/remont_8_to2.jpg',           'jpg', '2026-03-23 13:35:00'),
  (7, 12,   NULL, '/uploads/2026/04/22/zayavka_12_coolant.jpg',     'jpg', '2026-04-22 11:05:00'),
  (8, NULL, 4,    '/uploads/2026/02/22/remont_4_overhaul.pdf',      'pdf', '2026-02-22 17:30:00');

-- =========================================================
-- ФИНАНСОВЫЙ МОДУЛЬ — демо-данные
-- =========================================================

-- ---------- 15. Тарифы нормо-часов (по типам ремонта) ----------
INSERT INTO tarif_rabot (id, tip_remonta_id, tsena_za_chas, data_s, data_po) VALUES
  (1, 1,  800.00, '2026-01-01', NULL),
  (2, 2,  900.00, '2026-01-01', NULL),
  (3, 3, 1200.00, '2026-01-01', NULL),
  (4, 4, 1500.00, '2026-01-01', NULL),
  (5, 5, 1800.00, '2026-01-01', NULL),
  (6, 6, 1000.00, '2026-01-01', NULL),
  (7, 7,  700.00, '2026-01-01', NULL),
  (8, 8, 1300.00, '2026-01-01', NULL);

-- ---------- 16. Нормо-часы по ремонтам ----------
-- Каждому закрытому/идущему ремонту назначаем механика и часы
INSERT INTO remont_normy (remont_id, mekhanik_id, chasy, tarif_id) VALUES
  (1,  3,  4.50, 1),  -- ТО-1, Сидоров, 4.5 ч × 800 = 3 600 ✓
  (2,  4,  8.00, 5),  -- ДВС диагностика+чистка, Кузнецов, 8 ч × 1800 = 14 400 ✓
  (3,  9,  4.00, 6),  -- Колодки, Новиков, 4 ч × 1000 = 4 000 ✓
  (4,  3, 50.00, 4),  -- Капремонт, Сидоров, 50 ч × 1500 = 75 000 ✓
  (4,  4, 25.00, 4),  -- + помощь Кузнецова
  (5,  4,  4.00, 7),  -- Шины, Кузнецов, 4 ч × 700 = 2 800 ✓
  (6,  9,  4.00, 1),  -- ТО-1 Scania, Новиков, 4 ч × 800 = 3 200 ✓
  (7,  9,  0.50, 8),  -- Лампы, Новиков, 0.5 ч × 1300 = 650 ✓
  (8,  4,  5.00, 2),  -- ТО-2, Кузнецов, 5 ч × 900 = 4 500 ✓
  (9,  3, 12.00, 5),  -- Масло-насос, Сидоров, 12 ч × 1800 ≈ 22 000
  (10, 3,  4.00, 4),  -- КПП дефектовка, Сидоров (продолжается)
  (11, 4,  5.00, 2),  -- ТО-2 МАЗ, Кузнецов, 5 ч × 900 = 4 500 ✓
  (12, 9,  2.00, 3);  -- Диагностика стартера, Новиков (продолжается)

-- ---------- 17. Приходные накладные (заголовки) ----------
INSERT INTO prikhod_zapchasti (id, postavshik_id, data_prikhoda, nomer_nakl, summa_obshaya, kommentariy, sozdatel_id) VALUES
  (1, 4, '2026-01-15', 'AO-2026-001',  96000.00, 'Месячный заказ масла и антифриза',  5),
  (2, 1, '2026-02-03', 'AZ-2026-018',  41500.00, 'Фильтры и ремни',                   5),
  (3, 3, '2026-02-12', 'VP-2026-007', 151200.00, 'Колодки и диски Volvo',             5),
  (4, 5, '2026-03-05', 'ST-2026-021', 453600.00, 'Закупка летних шин (24 шт)',        5),
  (5, 6, '2026-03-18', 'EA-2026-013', 105100.00, 'Аккумуляторы, лампы, свечи',        5),
  (6, 2, '2026-04-02', 'TK-2026-006', 157200.00, 'Запчасти КАМАЗ',                    5),
  (7, 4, '2026-04-08', 'AO-2026-029',  66000.00, 'Дозаказ масла и антифриза',         5),
  (8, 1, '2026-04-20', 'AZ-2026-061',  89400.00, 'Сцепление и ремни',                 5);

-- ---------- 18. Позиции приходных накладных ----------
INSERT INTO prikhod_zapchasti_pozitsii (prikhod_id, zapchast_id, kolichestvo, tsena_za_edinicu) VALUES
  -- Накладная 1 (AutoOil)
  (1,  1, 30, 2400.00),
  (1, 10, 20, 1200.00),
  -- Накладная 2 (АвтоЗапчасть)
  (2,  3, 20, 1300.00),
  (2,  9,  5, 3100.00),
  -- Накладная 3 (Volvo Parts)
  (3,  4, 12, 5200.00),
  (3,  5, 10, 4800.00),
  (3, 14,  6, 6800.00),
  -- Накладная 4 (ШинТорг)
  (4,  6, 24,18900.00),
  -- Накладная 5 (ЭлектроАвто)
  (5,  7,  4,17500.00),
  (5, 12, 50,  350.00),
  (5, 13,  8, 2200.00),
  -- Накладная 6 (ТруКамаз)
  (6,  2, 80,  850.00),
  (6,  8,  4,22300.00),
  -- Накладная 7 (AutoOil)
  (7,  1, 20, 2400.00),
  (7, 10, 15, 1200.00),
  -- Накладная 8 (АвтоЗапчасть)
  (8,  9,  4, 3100.00),
  (8, 15,  2,38500.00);

-- ---------- 19. Бюджеты подразделений (план на 2026, янв-апр) ----------
-- Базовые суммы × коэффициент подразделения. 5 подр × 4 мес × 3 кат = 60 строк
INSERT INTO byudzhet (podrazdelenie_id, god, mesyats, kategoriya, plan_summa)
SELECT
  pd.id,
  2026,
  m.mesyats,
  k.kategoriya,
  ROUND(k.base * pd.koef, 0)
FROM (VALUES
  (1, 0.6),  -- Главное управление: 1 машина (Mercedes Sprinter, УАЗ Patriot)
  (2, 1.5),  -- Автопарк №1: 5 машин (тяжёлая техника)
  (3, 1.4),  -- Автопарк №2: 5 машин
  (4, 0.4),  -- Ремонтный цех: расходники
  (5, 0.2)   -- Склад: только мелочь
) AS pd(id, koef)
CROSS JOIN (VALUES (1),(2),(3),(4)) AS m(mesyats)
CROSS JOIN (VALUES
  ('remont',    80000),
  ('zapchasti', 60000),
  ('topliv',    50000)
) AS k(kategoriya, base);

-- ---------- 20. Прочие расходы (топливо, страховка, налоги) ----------
-- Используем фиксированный seed для воспроизводимости
SELECT setseed(0.42);

-- Топливо: для машин 1-12, ежемесячно (янв-апр 2026)
INSERT INTO prochiy_raskhod (ts_id, podrazdelenie_id, data, kategoriya, summa, opisanie)
SELECT
  ts.id,
  ts.podrazdelenie_id,
  make_date(2026, m.mesyats,
            CASE WHEN m.mesyats IN (2) THEN 25 ELSE 28 END)::date,
  'topliv',
  ROUND( (15000 + (ts.id * 1500) + (random() * 8000))::numeric, -2),
  'Заправка ' || ts.gos_nomer || ' за ' || m.mesyats || '/2026'
FROM transportnoe_sredstvo ts
CROSS JOIN (VALUES (1),(2),(3),(4)) AS m(mesyats);

-- Страховка ОСАГО (раз в год — январь)
INSERT INTO prochiy_raskhod (ts_id, podrazdelenie_id, data, kategoriya, summa, opisanie)
SELECT
  ts.id,
  ts.podrazdelenie_id,
  '2026-01-15',
  'strakhovka',
  CASE
    WHEN ts.id IN (1,3,6,11) THEN 18000.00  -- грузовая
    WHEN ts.id IN (5,9)      THEN  9500.00  -- лёгкая
    ELSE 14500.00
  END,
  'ОСАГО на ' || ts.gos_nomer || ' (2026 г.)'
FROM transportnoe_sredstvo ts;

-- Транспортный налог (квартально)
INSERT INTO prochiy_raskhod (ts_id, podrazdelenie_id, data, kategoriya, summa, opisanie) VALUES
  (1,  2, '2026-03-31', 'nalog',  6500.00, 'Транспортный налог Q1 2026'),
  (3,  3, '2026-03-31', 'nalog',  9200.00, 'Транспортный налог Q1 2026'),
  (6,  3, '2026-03-31', 'nalog',  7800.00, 'Транспортный налог Q1 2026'),
  (11, 2, '2026-03-31', 'nalog',  5400.00, 'Транспортный налог Q1 2026');

-- Мойка и прочее (несколько разовых записей)
INSERT INTO prochiy_raskhod (ts_id, podrazdelenie_id, data, kategoriya, summa, opisanie) VALUES
  (2,  2, '2026-02-10', 'moyka',   1500.00, 'Комплексная мойка'),
  (4,  3, '2026-03-05', 'moyka',   1800.00, 'Мойка после ремонта'),
  (8,  1, '2026-03-12', 'prochee', 4500.00, 'Замена щёток стеклоочистителя и доводчиков'),
  (10, 3, '2026-04-15', 'moyka',   2200.00, 'Мойка КАМАЗ'),
  (NULL, 4, '2026-02-20', 'prochee', 12000.00, 'Закупка мелкого инструмента в цех'),
  (NULL, 4, '2026-03-25', 'prochee',  8500.00, 'Расходники для цеха (ветошь, перчатки, очистители)'),
  (NULL, 5, '2026-04-10', 'prochee',  6700.00, 'Расходные материалы склада');

-- ---------- 21. Аудит финансовых операций ----------
INSERT INTO finansoviy_log (data_operatsii, sotrudnik_id, tip_operatsii, obyekt_tablitsa, obyekt_id, summa, kommentariy) VALUES
  ('2026-01-15 10:30:00', 5, 'PRIKHOD_ZAPCHASTI',     'prikhod_zapchasti',  1,  96000.00, 'Принята накладная AO-2026-001 от AutoOil'),
  ('2026-02-03 14:15:00', 5, 'PRIKHOD_ZAPCHASTI',     'prikhod_zapchasti',  2,  41500.00, 'Принята накладная AZ-2026-018'),
  ('2026-02-22 17:45:00', 2, 'UTVERZHDENIE_REMONTA',  'remont',             4, 170000.00, 'Утверждение капремонта Volvo FM12 (зая. №4)'),
  ('2026-03-05 09:50:00', 5, 'PRIKHOD_ZAPCHASTI',     'prikhod_zapchasti',  4, 453600.00, 'Крупная закупка летних шин'),
  ('2026-03-23 13:40:00', 2, 'ZAKRYTIE_REMONTA',      'remont',             8,   9050.00, 'Закрытие ТО-2 УАЗ Patriot'),
  ('2026-04-07 16:20:00', 2, 'ZAKRYTIE_REMONTA',      'remont',             9,  46000.00, 'Закрытие ремонта МАЗ 5320'),
  ('2026-04-13 09:30:00', 5, 'NACHALO_REMONTA',       'remont',            10,      0.00, 'Старт капремонта КПП'),
  ('2026-04-15 11:00:00', 6, 'PROVERKA_BYUDZHETA',     NULL,             NULL,      0.00, 'Контрольная проверка исполнения бюджета'),
  ('2026-04-20 12:10:00', 5, 'PRIKHOD_ZAPCHASTI',     'prikhod_zapchasti',  8,  89400.00, 'Принят сцепление и ремни'),
  ('2026-04-25 13:05:00', 2, 'NACHALO_REMONTA',       'remont',            12,      0.00, 'Диагностика стартера ГАЗ Газель'),
  ('2026-04-26 09:00:00', 1, 'OTCHET_TCO',             NULL,             NULL,      0.00, 'Сформирован отчёт TCO за Q1'),
  ('2026-04-28 17:30:00', 6, 'OTCHET_PLAN_FAKT',       NULL,             NULL,      0.00, 'Дашборд: проверка отклонений Апрель');

-- =========================================================
-- Сброс sequence-ов под максимальные id (после INSERT с явными ID)
-- =========================================================
SELECT setval(pg_get_serial_sequence('marka', 'id'),                 (SELECT MAX(id) FROM marka));
SELECT setval(pg_get_serial_sequence('model', 'id'),                 (SELECT MAX(id) FROM model));
SELECT setval(pg_get_serial_sequence('podrazdelenie', 'id'),         (SELECT MAX(id) FROM podrazdelenie));
SELECT setval(pg_get_serial_sequence('rol', 'id'),                   (SELECT MAX(id) FROM rol));
SELECT setval(pg_get_serial_sequence('sotrudnik', 'id'),             (SELECT MAX(id) FROM sotrudnik));
SELECT setval(pg_get_serial_sequence('transportnoe_sredstvo', 'id'), (SELECT MAX(id) FROM transportnoe_sredstvo));
SELECT setval(pg_get_serial_sequence('status', 'id'),                (SELECT MAX(id) FROM status));
SELECT setval(pg_get_serial_sequence('tip_remonta', 'id'),           (SELECT MAX(id) FROM tip_remonta));
SELECT setval(pg_get_serial_sequence('postavshik', 'id'),            (SELECT MAX(id) FROM postavshik));
SELECT setval(pg_get_serial_sequence('zapchast', 'id'),              (SELECT MAX(id) FROM zapchast));
SELECT setval(pg_get_serial_sequence('zayavka', 'id'),               (SELECT MAX(id) FROM zayavka));
SELECT setval(pg_get_serial_sequence('remont', 'id'),                (SELECT MAX(id) FROM remont));
SELECT setval(pg_get_serial_sequence('vlozhenie', 'id'),             (SELECT MAX(id) FROM vlozhenie));
-- финансовый модуль
SELECT setval(pg_get_serial_sequence('tarif_rabot', 'id'),           (SELECT MAX(id) FROM tarif_rabot));
SELECT setval(pg_get_serial_sequence('prikhod_zapchasti', 'id'),     (SELECT MAX(id) FROM prikhod_zapchasti));
SELECT setval(pg_get_serial_sequence('prikhod_zapchasti_pozitsii', 'id'),
                                                                     (SELECT MAX(id) FROM prikhod_zapchasti_pozitsii));
SELECT setval(pg_get_serial_sequence('byudzhet', 'id'),              (SELECT MAX(id) FROM byudzhet));
SELECT setval(pg_get_serial_sequence('prochiy_raskhod', 'id'),       (SELECT MAX(id) FROM prochiy_raskhod));
SELECT setval(pg_get_serial_sequence('finansoviy_log', 'id'),        (SELECT MAX(id) FROM finansoviy_log));
