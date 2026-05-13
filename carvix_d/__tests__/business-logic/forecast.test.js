/**
 * Carvix — unit-тесты модуля прогнозирования (services/forecast.js).
 *
 * Тесты строятся на синтетических временных рядах, для которых
 * математически известен правильный ответ:
 *
 *   • константный ряд          → прогноз ≈ константа, тренд ≈ 0;
 *   • линейный ряд             → linearTrend.slope ≈ заданный наклон;
 *   • сезонный ряд (sin)       → Holt-Winters восстанавливает амплитуду
 *                                и фазу, RMSE мал;
 *   • реалистичный ряд расхода топлива (зимний пик, летний минимум).
 *
 * Также проверяются граничные кейсы и валидация входа.
 */

const { holtWinters, linearTrend, autoForecast } = require('../../services/forecast');

describe('services/forecast.holtWinters', () => {
  it('константный ряд: прогноз ≈ константе, тренд ≈ 0, RMSE ≈ 0', () => {
    const y = Array(24).fill(1000);  // 2 сезона по 12 точек
    const r = holtWinters(y, { period: 12, horizon: 6 });

    expect(r.rmse).toBeLessThan(1);      // ряд идеально предсказуем
    expect(Math.abs(r.trend)).toBeLessThan(1);
    for (const f of r.forecast) {
      expect(f.point).toBeGreaterThan(990);
      expect(f.point).toBeLessThan(1010);
      // нижняя граница CI неотрицательна (clip к 0)
      expect(f.lower).toBeGreaterThanOrEqual(0);
      // верхняя >= точечного прогноза
      expect(f.upper).toBeGreaterThanOrEqual(f.point);
    }
  });

  it('линейно растущий ряд: тренд положителен, прогноз растёт со временем', () => {
    // На чисто линейном ряде без сезонности Holt-Winters возвращает T > 0,
    // а сами точечные прогнозы могут быть ниже последних наблюдений из-за
    // отрицательных сезонных компонент, унаследованных с инициализации
    // (известное свойство triple smoothing на нон-сезонных данных).
    // Поэтому проверяем именно тренд и монотонность прогноза.
    const y = [];
    for (let i = 0; i < 24; i++) y.push(1000 + i * 50);
    const r = holtWinters(y, { period: 12, horizon: 6 });

    expect(r.trend).toBeGreaterThan(0);
    // Точечный прогноз растёт от шага к шагу
    for (let i = 1; i < r.forecast.length; i++) {
      expect(r.forecast[i].point).toBeGreaterThan(r.forecast[i - 1].point);
    }
  });

  it('сезонный sin-ряд: Holt-Winters восстанавливает сезонность с малым RMSE', () => {
    // y_t = 1000 + 200·sin(2π·t/12)  + небольшой шум
    const y = [];
    for (let t = 0; t < 36; t++) {
      const seasonal = 200 * Math.sin((2 * Math.PI * t) / 12);
      y.push(1000 + seasonal);
    }
    const r = holtWinters(y, { period: 12, horizon: 12 });

    // RMSE должен быть существенно меньше амплитуды сезонности (200)
    expect(r.rmse).toBeLessThan(50);

    // Прогноз должен сохранять сезонность: max(forecast) - min(forecast) ≈ 2*200
    const points = r.forecast.map((f) => f.point);
    const range = Math.max(...points) - Math.min(...points);
    expect(range).toBeGreaterThan(300);  // > 75% от 2·амплитуды
  });

  it('реалистичный ряд расхода топлива: зимой больше, летом меньше', () => {
    // Сезонная модель: январь/декабрь — 1.4×, июль — 0.7×
    const seasonalFactors = [1.4, 1.3, 1.1, 0.9, 0.8, 0.7, 0.7, 0.8, 0.9, 1.1, 1.2, 1.4];
    const baseline = 50_000;
    const y = [];
    for (let year = 0; year < 3; year++) {
      for (let m = 0; m < 12; m++) {
        y.push(baseline * seasonalFactors[m]);
      }
    }
    const r = holtWinters(y, { period: 12, horizon: 12 });

    // Прогноз января (h=1, серия закончилась декабрём → след. месяц = январь, фактор 1.4)
    const jan = r.forecast[0].point;
    const jul = r.forecast[6].point;  // июль через 7 месяцев
    expect(jan).toBeGreaterThan(jul);                       // зима > лета
    expect(jan / jul).toBeGreaterThan(1.5);                 // не ниже 1.5×
  });

  it('бросает Error, если данных меньше 2 сезонов', () => {
    expect(() => holtWinters([1, 2, 3, 4, 5], { period: 12 }))
      .toThrow(/Недостаточно данных/);
  });

  it('бросает Error при не-числе в массиве', () => {
    const y = Array(24).fill(100);
    y[5] = NaN;
    expect(() => holtWinters(y)).toThrow(/не-число/);
  });

  it('бросает Error при не-массиве', () => {
    expect(() => holtWinters('abc')).toThrow(/массивом/);
  });
});

describe('services/forecast.linearTrend', () => {
  it('идеальный линейный ряд: slope корректен, RMSE = 0', () => {
    const y = [10, 20, 30, 40, 50];   // slope = 10, intercept = 10
    const r = linearTrend(y, { horizon: 3 });

    expect(r.slope).toBeCloseTo(10, 6);
    expect(r.intercept).toBeCloseTo(10, 6);
    expect(r.rmse).toBeCloseTo(0, 6);
    expect(r.forecast[0].point).toBeCloseTo(60, 6);   // 10 + 10·5
    expect(r.forecast[2].point).toBeCloseTo(80, 6);
  });

  it('ширина CI растёт с горизонтом (∝ √h)', () => {
    const y = [10, 22, 31, 39, 52, 58, 71];   // не идеально линейный
    const r = linearTrend(y, { horizon: 5 });

    const widths = r.forecast.map((f) => f.upper - f.point);
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThan(widths[i - 1]);
    }
  });

  it('бросает Error при единственной точке', () => {
    expect(() => linearTrend([42])).toThrow(/минимум 2 точки/);
  });
});

describe('services/forecast.autoForecast (выбор метода)', () => {
  it('>= 2 сезонов → method = "holt-winters"', () => {
    const y = Array(24).fill(0).map((_, i) => 1000 + 50 * Math.sin(i / 2));
    const r = autoForecast(y, { period: 12, horizon: 3 });
    expect(r.method).toBe('holt-winters');
    expect(r.forecast).toHaveLength(3);
  });

  it('< 2 сезонов → method = "linear-trend"', () => {
    const y = [10, 20, 30, 40, 50, 60];
    const r = autoForecast(y, { period: 12, horizon: 3 });
    expect(r.method).toBe('linear-trend');
    expect(r.forecast).toHaveLength(3);
  });

  it('пустой ряд → method = "mean", прогноз = 0', () => {
    const r = autoForecast([], { horizon: 5 });
    expect(r.method).toBe('mean');
    expect(r.forecast).toHaveLength(5);
    expect(r.forecast[0].point).toBe(0);
  });

  it('ряд из одних нулей → method = "mean", прогноз = 0', () => {
    const r = autoForecast([0, 0, 0, 0], { horizon: 3 });
    expect(r.method).toBe('mean');
    expect(r.forecast.every((f) => f.point === 0)).toBe(true);
  });

  it('передача horizon — длина массива forecast равна horizon', () => {
    const y = Array(24).fill(0).map((_, i) => 1000 + i * 10);
    const r6  = autoForecast(y, { period: 12, horizon: 6 });
    const r18 = autoForecast(y, { period: 12, horizon: 18 });
    expect(r6.forecast).toHaveLength(6);
    expect(r18.forecast).toHaveLength(18);
  });
});

describe('Структура объекта forecast', () => {
  it('каждый элемент forecast содержит step, point, lower, upper', () => {
    const y = Array(24).fill(0).map((_, i) => 100 + i);
    const r = holtWinters(y, { horizon: 3 });

    for (const f of r.forecast) {
      expect(f).toEqual(expect.objectContaining({
        step: expect.any(Number),
        point: expect.any(Number),
        lower: expect.any(Number),
        upper: expect.any(Number),
      }));
      expect(f.lower).toBeLessThanOrEqual(f.point);
      expect(f.upper).toBeGreaterThanOrEqual(f.point);
    }
  });
});
