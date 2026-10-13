// 9-2단계(Trend Detection 1차): 시즌성 판단. Multi-Signal 시계열 확장의 일부지만,
// 급상승 점수(Trend Score)와 섞지 않기 위해 별도 파일로 둡니다 - 결과는
// multiSignalTimeSeries.classifyTrendType()의 SEASONAL 판정에만 쓰입니다.
//
// 판단 방식: 지난 해들의 "같은 날짜 ±windowDays" 평균이 그 해 전후 반년 평균의
// peakRatio배 이상이었던 해가 minYears번 이상이면 시즌성으로 봅니다.
// 키워드 이름("크리스마스" 등)만 보고 시즌성을 추정하지 않습니다 - 실제 과거
// 데이터가 없으면 insufficient_history로 판단을 보류합니다. 현재 저장된 데이터는
// 길어야 수 주 분량이라, 지금은 대부분 insufficient_history가 정상입니다.

const DAY_MS = 24 * 60 * 60 * 1000;

export const SEASONALITY_CONFIG = {
  windowDays: 14,
  surroundingDays: 182,
  minYears: 2,
  maxYearsBack: 5,
  peakRatio: 1.5,
  minSurroundingPoints: 3, // 비교 기준(그 해 전후 반년)에 최소한 이만큼 관측이 있어야 그 해를 판단에 씁니다
};

function toEpochMs(t) {
  const ms = typeof t === "number" ? t : new Date(t).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * @param {Array<{t:number|string|Date, value:number}>} points
 * @param {{now?: Date}} [options]
 * @returns {{seasonal:boolean, reason:string, yearsChecked:number, peakYears:number}}
 */
export function computeSeasonality(points, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const cfg = SEASONALITY_CONFIG;

  const series = (Array.isArray(points) ? points : [])
    .map((p) => ({ t: toEpochMs(p?.t), value: p?.value }))
    .filter((p) => p.t !== null && typeof p.value === "number" && Number.isFinite(p.value));

  let yearsChecked = 0;
  let peakYears = 0;

  for (let y = 1; y <= cfg.maxYearsBack; y++) {
    const target = new Date(now);
    target.setFullYear(now.getFullYear() - y);
    const center = target.getTime();

    const inWindow = series.filter((p) => Math.abs(p.t - center) <= cfg.windowDays * DAY_MS);
    const surrounding = series.filter((p) => Math.abs(p.t - center) <= cfg.surroundingDays * DAY_MS);
    const outsideWindow = surrounding.length - inWindow.length;

    if (inWindow.length === 0 || outsideWindow < cfg.minSurroundingPoints) {
      continue;
    }

    yearsChecked += 1;
    const surroundingMean = mean(surrounding.map((p) => p.value));
    if (surroundingMean > 0 && mean(inWindow.map((p) => p.value)) >= cfg.peakRatio * surroundingMean) {
      peakYears += 1;
    }
  }

  if (yearsChecked < cfg.minYears) {
    return { seasonal: false, reason: "insufficient_history", yearsChecked, peakYears };
  }

  const seasonal = peakYears >= cfg.minYears;
  return { seasonal, reason: seasonal ? "recurring_peak" : "no_recurring_peak", yearsChecked, peakYears };
}
