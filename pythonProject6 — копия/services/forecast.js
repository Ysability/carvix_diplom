/**
 * Carvix — модуль прогнозирования расходов (Holt-Winters Triple Exponential Smoothing).
 *
 * Методика
 * ========
 * Тройное экспоненциальное сглаживание (Holt-Winters) — классический метод
 * прогнозирования временных рядов с трендом и сезонностью. Подходит для
 * расходов на топливо/запчасти/ремонт, так как они имеют годовую сезонность
 * (зимний расход топлива выше летнего, плановое ТО — весной/осенью).
 *
 * Аддитивная модель (рекомендуется для финансовых рядов в одной валюте):
 *
 *   ŷ_{t+h} = L_t + h · T_t + S_{t-m+((h-1) mod m)+1}
 *
 * где:
 *   • L_t — уровень (сглаженное значение) на шаге t;
 *   • T_t — тренд (наклон) на шаге t;
 *   • S_t — сезонная компонента периода m (для месячных данных m = 12);
 *   • α, β, γ ∈ (0; 1) — коэффициенты сглаживания.
 *
 * Рекуррентные формулы:
 *   L_t = α · (Y_t - S_{t-m})    + (1-α) · (L_{t-1} + T_{t-1})
 *   T_t = β · (L_t - L_{t-1})    + (1-β) · T_{t-1}
 *   S_t = γ · (Y_t - L_t)        + (1-γ) · S_{t-m}
 *
 * Доверительный интервал прогноза:
 *   CI_{t+h} = ŷ_{t+h} ± z · σ̂ · √h,    где σ̂ — RMSE остатков на исторических данных,
 *                                       z = 1.96 для 95 %-го интервала.
 *
 * Литература:
 *   • Hyndman, R.J. & Athanasopoulos, G. (2021). "Forecasting: Principles
 *     and Practice", 3rd ed. Chapter 7.4 — Holt-Winters' method.
 *   • Чёрный А.А. (2020). "Прогнозирование в управлении автотранспортом."
 */

'use strict';

const SEASON_LENGTH_DEFAULT = 12;          // месяцев в периоде
const Z_95 = 1.96;                          // 95 %-й доверительный интервал

/**
 * Holt-Winters Triple Exponential Smoothing (аддитивная модель).
 *
 * @param {number[]} y — историческая серия (>= 2 полных сезона желательно).
 * @param {Object}   opts
 * @param {number}   opts.alpha   — α ∈ (0,1), по умолчанию 0.4
 * @param {number}   opts.beta    — β ∈ (0,1), по умолчанию 0.1
 * @param {number}   opts.gamma   — γ ∈ (0,1), по умолчанию 0.3
 * @param {number}   opts.period  — длина сезона (по умолчанию 12)
 * @param {number}   opts.horizon — на сколько шагов вперёд предсказывать (по умолч. 12)
 * @param {number}   opts.z       — z-score для CI (по умолчанию 1.96 = 95 %)
 *
 * @returns {{
 *   level: number,                        // финальный уровень L_T
 *   trend: number,                        // финальный тренд T_T
 *   season: number[],                     // последние period сезонных коэффициентов
 *   fitted: number[],                     // ŷ_t для каждого исторического t
 *   residuals: number[],                  // (Y_t − ŷ_t)
 *   rmse: number,                         // √(Σ residuals² / n)
 *   forecast: Array<{
 *     step: number,                       // 1, 2, …, horizon
 *     point: number,                      // точечный прогноз ŷ_{T+h}
 *     lower: number,                      // нижняя граница CI
 *     upper: number                       // верхняя граница CI
 *   }>
 * }}
 *
 * @throws {Error} если y.length < period * 2 (мало данных для оценки сезонности)
 *                 или если в серии нет ни одного ненулевого значения.
 */
function holtWinters(y, opts = {}) {
  const alpha   = opts.alpha   ?? 0.4;
  const beta    = opts.beta    ?? 0.1;
  const gamma   = opts.gamma   ?? 0.3;
  const period  = opts.period  ?? SEASON_LENGTH_DEFAULT;
  const horizon = opts.horizon ?? period;
  const z       = opts.z       ?? Z_95;

  if (!Array.isArray(y))      throw new Error('y должен быть массивом чисел');
  if (y.length < period * 2)  throw new Error(`Недостаточно данных: нужно >= ${period * 2}, передано ${y.length}`);
  for (const v of y) if (!Number.isFinite(v)) throw new Error('y содержит не-число');

  // -------------------------------------------------------------------------
  //  ИНИЦИАЛИЗАЦИЯ
  //
  //  L_0  = среднее за первый сезон
  //  T_0  = (среднее 2-го сезона − среднее 1-го сезона) / period
  //  S_i  = Y_i − L_0  (для аддитивной модели), i = 0..period-1
  // -------------------------------------------------------------------------
  const seasonAvg1 = mean(y.slice(0, period));
  const seasonAvg2 = mean(y.slice(period, period * 2));

  let level = seasonAvg1;
  let trend = (seasonAvg2 - seasonAvg1) / period;
  const season = new Array(period);
  for (let i = 0; i < period; i++) {
    season[i] = y[i] - level;
  }

  // -------------------------------------------------------------------------
  //  СГЛАЖИВАНИЕ ПО ВСЕЙ ИСТОРИИ
  // -------------------------------------------------------------------------
  const fitted = new Array(y.length);
  for (let t = 0; t < y.length; t++) {
    const s = season[t % period];

    // Прогноз на шаг вперёд (для оценки RMSE)
    fitted[t] = level + trend + s;

    // Обновление компонент
    const newLevel = alpha * (y[t] - s) + (1 - alpha) * (level + trend);
    const newTrend = beta  * (newLevel - level) + (1 - beta) * trend;
    const newSeason = gamma * (y[t] - newLevel) + (1 - gamma) * s;

    level = newLevel;
    trend = newTrend;
    season[t % period] = newSeason;
  }

  // -------------------------------------------------------------------------
  //  RMSE НА ИСТОРИЧЕСКИХ ОСТАТКАХ
  // -------------------------------------------------------------------------
  const residuals = y.map((v, t) => v - fitted[t]);
  const rmse = Math.sqrt(
    residuals.reduce((acc, r) => acc + r * r, 0) / residuals.length
  );

  // -------------------------------------------------------------------------
  //  ПРОГНОЗ НА horizon ШАГОВ ВПЕРЁД
  //
  //  ŷ_{T+h} = L + h·T + S_{(T + h - 1) mod period}
  //
  //  CI = ŷ ± z · σ̂ · √h
  // -------------------------------------------------------------------------
  const T = y.length;
  const forecast = [];
  for (let h = 1; h <= horizon; h++) {
    const seasonIdx = (T + h - 1) % period;
    const point = level + h * trend + season[seasonIdx];
    const halfWidth = z * rmse * Math.sqrt(h);
    forecast.push({
      step: h,
      point: round2(point),
      lower: round2(Math.max(0, point - halfWidth)),    // отрицательных расходов не бывает
      upper: round2(point + halfWidth),
    });
  }

  return {
    level: round2(level),
    trend: round2(trend),
    season: season.map(round2),
    fitted: fitted.map(round2),
    residuals: residuals.map(round2),
    rmse: round2(rmse),
    forecast,
  };
}

/**
 * Простая линейная регрессия для серий короче, чем 2 сезона
 * (когда Holt-Winters невозможен).
 *
 *   ŷ = a + b·t,  где b = COV(t,y)/VAR(t),  a = ȳ − b·t̄
 *
 * @param {number[]} y
 * @param {Object} opts
 * @param {number} opts.horizon — на сколько шагов вперёд (по умолч. 3)
 * @returns {{ slope: number, intercept: number, rmse: number, forecast: Array<{step, point, lower, upper}> }}
 */
function linearTrend(y, opts = {}) {
  const horizon = opts.horizon ?? 3;
  const z = opts.z ?? Z_95;
  const n = y.length;
  if (n < 2) throw new Error('Линейный тренд требует минимум 2 точки');

  const xs = Array.from({ length: n }, (_, i) => i);
  const xMean = mean(xs);
  const yMean = mean(y);

  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (y[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;

  const fitted = xs.map((x) => intercept + slope * x);
  const residuals = y.map((v, i) => v - fitted[i]);
  const rmse = Math.sqrt(residuals.reduce((a, r) => a + r * r, 0) / n);

  const forecast = [];
  for (let h = 1; h <= horizon; h++) {
    const point = intercept + slope * (n - 1 + h);
    const halfWidth = z * rmse * Math.sqrt(h);
    forecast.push({
      step: h,
      point: round2(point),
      lower: round2(Math.max(0, point - halfWidth)),
      upper: round2(point + halfWidth),
    });
  }

  return {
    slope: round2(slope),
    intercept: round2(intercept),
    rmse: round2(rmse),
    forecast,
  };
}

/**
 * Высокоуровневая обёртка: автоматически выбирает Holt-Winters
 * (если данных >= 2 сезонов) или линейный тренд (иначе).
 *
 * @param {number[]} y
 * @param {Object} opts — те же, что у holtWinters/linearTrend
 * @returns {Object} с дополнительным полем `method: 'holt-winters' | 'linear-trend' | 'mean'`
 */
function autoForecast(y, opts = {}) {
  const period = opts.period ?? SEASON_LENGTH_DEFAULT;

  // Совсем мало данных или все нули — отдаём константный «прогноз» = среднее
  if (!y.length || y.every((v) => v === 0)) {
    const horizon = opts.horizon ?? period;
    const m = y.length ? mean(y) : 0;
    return {
      method: 'mean',
      mean: round2(m),
      forecast: Array.from({ length: horizon }, (_, i) => ({
        step: i + 1,
        point: round2(m),
        lower: round2(m),
        upper: round2(m),
      })),
    };
  }

  if (y.length >= period * 2) {
    return { method: 'holt-winters', ...holtWinters(y, opts) };
  }

  return { method: 'linear-trend', ...linearTrend(y, opts) };
}

/* ============================== utils =================================== */
function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function round2(x) {
  return Math.round(x * 100) / 100;
}

module.exports = { holtWinters, linearTrend, autoForecast };
