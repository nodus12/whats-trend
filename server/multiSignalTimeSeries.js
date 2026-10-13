// 9-2단계(Trend Detection 1차): Multi-Signal 계층의 시계열 확장.
//
// 기존 multiSignalTrendEngine.js는 "현재값 vs 직전값" 한 쌍만 보고 점수를
// 냅니다. 이 파일은 같은 Multi-Signal 계층 안에서 "시간순 여러 관측값"을
// 받아 Growth / Velocity / Acceleration / Novelty / Spread / Volume을 계산하고,
// 이를 묶어 Trend Score, Opportunity Score, Trend Stage, Trend Type을 냅니다.
//
// 1차 범위: 순수 함수만 둡니다. DB/외부 API/현재 시각에 의존하지 않으므로
// 같은 입력엔 항상 같은 결과가 나옵니다. 기존 computeMultiSignalTrend()와
// /api/trends 응답은 이 파일 때문에 바뀌지 않습니다 - 실제 파이프라인 연결은
// 2차 작업입니다. 기존 엔진에서는 소스별 값 정규화(normalizeSignalValue)만
// 재사용합니다.
//
// 출력 필드명은 기존 계층과 섞이지 않게 둡니다(CLAUDE.md §21): growthRate는
// Legacy 전용이므로 여기서는 growthRatePct, 단계는 stage가 아니라 trendStage.
// API에 붙일 때는 detection 같은 하위 객체로 감싸야 합니다.
import { normalizeSignalValue } from "./multiSignalTrendEngine.js";

// 모든 숫자는 시작값이며, 실제 데이터가 쌓이면 조정 대상입니다.
export const TREND_DETECTION_CONFIG = {
  // 직전값이 이보다 작으면 이 값을 분모로 씁니다 - 0→1이 "무한대 성장"이
  // 되지 않게 하는 절대량 보정값입니다(0→1 = 20%, 10→100 = 900%).
  minimumBaseline: 5,
  growth: { referenceRate: 5 }, // 성장률 500%(=5배 증가)를 100점으로 보는 로그 압축 기준
  velocity: { windowDeltas: 3, referenceRelative: 1.0 }, // 최근 구간 평균 변화량이 평균 수준과 같으면 100점
  acceleration: { referenceRelative: 0.5 },
  novelty: {
    recentPoints: 3, // 마지막 N개 관측값을 "최근"으로 봅니다
    lookbackMs: 7 * 24 * 60 * 60 * 1000, // 그 이전 7일을 "과거"로 봅니다
    referenceRatio: 10, // 최근 평균이 과거 평균의 10배면 100점
  },
  spread: {
    pointsPerRisingSource: 20, // 1개 20 / 2개 40 / ... / 5개 이상 100
    minRisingGrowthPct: 10, // 이보다 작은 상승은 "상승 중인 소스"로 세지 않습니다
  },
  trendScoreWeights: {
    growth: 0.25,
    velocity: 0.2,
    acceleration: 0.15,
    novelty: 0.15,
    spread: 0.15,
    volume: 0.1,
  },
  opportunityWeights: {
    trend: 0.3,
    novelty: 0.25,
    growth: 0.15,
    spread: 0.1,
    persistence: 0.1,
    freshness: 0.1, // = 100 - 포화도
  },
  stage: {
    thresholds: [
      [85, "VIRAL"],
      [70, "HOT"],
      [50, "RISING"],
      [25, "EARLY"],
    ],
    minObservations: 2, // 이보다 적으면 무조건 WATCH
    fullObservations: 3, // 이보다 적으면 최대 EARLY
    minSourcesForHot: 2, // 이보다 적은 소스면 최대 RISING
  },
  type: {
    newNoveltyMin: 60,
    risingMomentumMin: 20,
    saturatedMin: 70,
    saturatedMomentumMax: 20,
  },
};

const STAGE_ORDER = ["WATCH", "EARLY", "RISING", "HOT", "VIRAL"];

function clamp(value, min = 0, max = 100) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function mean(values) {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function toEpochMs(t) {
  if (typeof t === "number" && Number.isFinite(t)) {
    return t;
  }
  if (typeof t === "string" || t instanceof Date) {
    const ms = new Date(t).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/**
 * 관측값 배열을 시간순으로 정리합니다. 값/시각이 유효하지 않은 점은 버리고,
 * 같은 시각에 여러 값이 있으면 마지막 값을 씁니다.
 * @param {Array<{t:number|string|Date, value:number}>} points
 * @returns {Array<{t:number, value:number}>}
 */
export function toSortedSeries(points) {
  const byTime = new Map();
  for (const p of Array.isArray(points) ? points : []) {
    const t = toEpochMs(p?.t);
    if (t === null || typeof p.value !== "number" || !Number.isFinite(p.value)) {
      continue;
    }
    byTime.set(t, p.value);
  }
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([t, value]) => ({ t, value }));
}

function deltas(values) {
  const out = [];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] - values[i - 1]);
  }
  return out;
}

/**
 * 직전 관측 대비 성장률. 분모는 max(직전값, minimumBaseline).
 * @returns {{available:boolean, growthRatePct:number|null, score:number}}
 */
export function computeGrowth(series) {
  if (series.length < 2) {
    return { available: false, growthRatePct: null, score: 0 };
  }
  const prev = series[series.length - 2].value;
  const cur = series[series.length - 1].value;
  const rate = (cur - prev) / Math.max(prev, TREND_DETECTION_CONFIG.minimumBaseline);
  const ref = TREND_DETECTION_CONFIG.growth.referenceRate;
  const score = rate <= 0 ? 0 : clamp((100 * Math.log(1 + rate)) / Math.log(1 + ref));
  return { available: true, growthRatePct: round1(rate * 100), score: Math.round(score) };
}

function windowLevel(values, windowDeltas) {
  return Math.max(mean(values.slice(-(windowDeltas + 1))), TREND_DETECTION_CONFIG.minimumBaseline);
}

/**
 * 최근 구간 변화량의 평균. 점수는 키워드마다 규모가 달라서 "평균 수준 대비
 * 변화량"(상대 속도)으로 매깁니다.
 * @returns {{available:boolean, velocity:number|null, relativeVelocity:number|null, score:number}}
 */
export function computeVelocity(series) {
  const { windowDeltas, referenceRelative } = TREND_DETECTION_CONFIG.velocity;
  if (series.length < 2) {
    return { available: false, velocity: null, relativeVelocity: null, score: 0 };
  }
  const values = series.map((p) => p.value);
  const recent = deltas(values).slice(-windowDeltas);
  const velocity = mean(recent);
  const relativeVelocity = velocity / windowLevel(values, windowDeltas);
  const score = relativeVelocity <= 0 ? 0 : clamp((100 * relativeVelocity) / referenceRelative);
  return { available: true, velocity: round1(velocity), relativeVelocity: round1(relativeVelocity * 1000) / 1000, score: Math.round(score) };
}

/**
 * 변화량 자체의 변화(2차 차분) 평균. 관측값 3개 이상 필요.
 * @returns {{available:boolean, acceleration:number|null, relativeAcceleration:number|null, score:number}}
 */
export function computeAcceleration(series) {
  const { windowDeltas } = TREND_DETECTION_CONFIG.velocity;
  const { referenceRelative } = TREND_DETECTION_CONFIG.acceleration;
  if (series.length < 3) {
    return { available: false, acceleration: null, relativeAcceleration: null, score: 0 };
  }
  const values = series.map((p) => p.value);
  const secondDiffs = deltas(deltas(values).slice(-windowDeltas));
  const acceleration = mean(secondDiffs);
  const relativeAcceleration = acceleration / windowLevel(values, windowDeltas);
  const score = relativeAcceleration <= 0 ? 0 : clamp((100 * relativeAcceleration) / referenceRelative);
  return {
    available: true,
    acceleration: round1(acceleration),
    relativeAcceleration: round1(relativeAcceleration * 1000) / 1000,
    score: Math.round(score),
  };
}

/**
 * 신규성: "과거 7일엔 거의 없다가 최근에 급히 늘었는가".
 * 점수 = (최근/과거 배율의 로그 점수) × (과거가 최근 대비 얼마나 조용했는가).
 * 과거 구간에 관측값이 하나도 없으면 계산하지 않습니다 - 관측이 없는 것과
 * 값이 0인 것은 다르기 때문입니다(수집을 안 했을 수도 있음).
 * @returns {{available:boolean, ratio:number|null, quietness:number|null, score:number}}
 */
export function computeNovelty(series) {
  const { recentPoints, lookbackMs, referenceRatio } = TREND_DETECTION_CONFIG.novelty;
  if (series.length <= recentPoints) {
    return { available: false, ratio: null, quietness: null, score: 0 };
  }
  const recent = series.slice(-recentPoints);
  const recentStart = recent[0].t;
  const baseline = series.slice(0, -recentPoints).filter((p) => p.t >= recentStart - lookbackMs);
  if (baseline.length === 0) {
    return { available: false, ratio: null, quietness: null, score: 0 };
  }
  const recentMean = mean(recent.map((p) => p.value));
  const baselineMean = mean(baseline.map((p) => p.value));
  const ratio = recentMean / Math.max(baselineMean, TREND_DETECTION_CONFIG.minimumBaseline);
  const quietness = recentMean > 0 ? clamp(1 - baselineMean / recentMean, 0, 1) : 0;
  const ratioScore = ratio <= 1 ? 0 : clamp((100 * Math.log(ratio)) / Math.log(referenceRatio));
  return {
    available: true,
    ratio: round1(ratio),
    quietness: round1(quietness * 100) / 100,
    score: Math.round(ratioScore * quietness),
  };
}

/**
 * 최근 상승 지속성: 최근 구간 변화량 중 양수인 비율(0~100).
 */
export function computePersistence(series) {
  const { windowDeltas } = TREND_DETECTION_CONFIG.velocity;
  if (series.length < 2) {
    return { available: false, score: 0 };
  }
  const recent = deltas(series.map((p) => p.value)).slice(-windowDeltas);
  return { available: true, score: Math.round((100 * recent.filter((d) => d > 0).length) / recent.length) };
}

/**
 * 현재 규모. 소스마다 단위가 달라 기존 Multi-Signal 정규화를 그대로 씁니다.
 */
export function computeVolume(series, sourceType) {
  if (series.length === 0) {
    return { available: false, score: 0 };
  }
  return { available: true, score: normalizeSignalValue(series[series.length - 1].value, sourceType) };
}

/**
 * 확산: 실제 데이터가 있고(관측 2개 이상) 최근 minRisingGrowthPct 이상
 * 오른 소스 수 × 20. 데이터가 없는 소스는 세지 않습니다.
 * @param {Array<{source:string, growth:{available:boolean, growthRatePct:number|null}}>} perSource
 */
export function computeSpread(perSource) {
  const { pointsPerRisingSource, minRisingGrowthPct } = TREND_DETECTION_CONFIG.spread;
  const withData = perSource.filter((s) => s.growth.available);
  const rising = withData.filter((s) => s.growth.growthRatePct >= minRisingGrowthPct).map((s) => s.source);
  return {
    sourceCount: withData.length,
    risingSourceCount: rising.length,
    risingSources: rising,
    score: Math.min(100, rising.length * pointsPerRisingSource),
  };
}

/**
 * 하위 점수(각 0~100) 가중합. 계산할 수 없는 하위 점수는 0으로 둡니다 -
 * 데이터가 없는 것을 상승으로 치지 않기 위함입니다.
 */
export function computeTrendScore(scores) {
  const w = TREND_DETECTION_CONFIG.trendScoreWeights;
  return Math.round(
    clamp(
      (scores.growth ?? 0) * w.growth +
        (scores.velocity ?? 0) * w.velocity +
        (scores.acceleration ?? 0) * w.acceleration +
        (scores.novelty ?? 0) * w.novelty +
        (scores.spread ?? 0) * w.spread +
        (scores.volume ?? 0) * w.volume
    )
  );
}

/**
 * "지금 콘텐츠를 만들 기회가 있는가". Trend Score가 높아도 포화도가 높으면
 * (이미 대중화) 낮아집니다. saturation은 기존 Multi-Signal의 mainstreamScore가
 * 있으면 그 값을, 없으면 volume 점수를 씁니다.
 */
export function computeOpportunityScore({ trendScore, novelty, growth, spread, persistence, saturation }) {
  const w = TREND_DETECTION_CONFIG.opportunityWeights;
  return Math.round(
    clamp(
      trendScore * w.trend +
        novelty * w.novelty +
        growth * w.growth +
        spread * w.spread +
        persistence * w.persistence +
        (100 - clamp(saturation)) * w.freshness
    )
  );
}

/**
 * 점수 구간으로 단계를 정하되, 데이터가 부족하면 올라갈 수 있는 상한을 둡니다.
 * @returns {{trendStage:string, rawStage:string, capped:boolean, capReason:string|null}}
 */
export function classifyTrendStage(trendScore, { observationCount, sourceCount }) {
  const cfg = TREND_DETECTION_CONFIG.stage;
  let rawStage = "WATCH";
  for (const [min, stage] of cfg.thresholds) {
    if (trendScore >= min) {
      rawStage = stage;
      break;
    }
  }

  let cap = "VIRAL";
  let capReason = null;
  if (observationCount < cfg.minObservations) {
    cap = "WATCH";
    capReason = "insufficient_observations";
  } else if (observationCount < cfg.fullObservations) {
    cap = "EARLY";
    capReason = "few_observations";
  } else if (sourceCount < cfg.minSourcesForHot) {
    cap = "RISING";
    capReason = "single_source";
  }

  const trendStage = STAGE_ORDER.indexOf(rawStage) > STAGE_ORDER.indexOf(cap) ? cap : rawStage;
  return { trendStage, rawStage, capped: trendStage !== rawStage, capReason: trendStage !== rawStage ? capReason : null };
}

/**
 * 트렌드 유형. 시즌성은 점수에 섞지 않고 여기서만 반영합니다.
 * 우선순위: SEASONAL > NEW > HOT > RISING > SATURATED > STABLE.
 * 관측값이 2개 미만이면 null(판단 보류).
 */
export function classifyTrendType({ observationCount, noveltyScore, growthScore, velocityScore, trendStage, saturation, seasonal }) {
  const cfg = TREND_DETECTION_CONFIG.type;
  if (observationCount < TREND_DETECTION_CONFIG.stage.minObservations) {
    return null;
  }
  if (seasonal) {
    return "SEASONAL";
  }
  if (noveltyScore >= cfg.newNoveltyMin && growthScore > 0) {
    return "NEW";
  }
  if (trendStage === "HOT" || trendStage === "VIRAL") {
    return "HOT";
  }
  const momentum = Math.max(growthScore, velocityScore);
  if (momentum >= cfg.risingMomentumMin) {
    return "RISING";
  }
  if (saturation >= cfg.saturatedMin && momentum < cfg.saturatedMomentumMax) {
    return "SATURATED";
  }
  return "STABLE";
}

/**
 * 키워드 하나의 소스별 시계열을 받아 Trend Detection 결과를 계산합니다.
 *
 * @param {string} keyword
 * @param {Array<{source:string, sourceType:string, points:Array<{t:number|string, value:number}>}>} sources
 * @param {Object} [options]
 * @param {number} [options.mainstreamScore] - 기존 Multi-Signal 결과(있으면 포화도로 사용)
 * @param {{seasonal:boolean}} [options.seasonality] - multiSignalSeasonality.computeSeasonality() 결과
 */
export function computeTrendDetection(keyword, sources, options = {}) {
  const perSource = (Array.isArray(sources) ? sources : [])
    .filter((s) => s && typeof s.source === "string")
    .map((s) => {
      const series = toSortedSeries(s.points);
      return {
        source: s.source,
        sourceType: s.sourceType,
        times: series.map((p) => p.t),
        observationCount: series.length,
        growth: computeGrowth(series),
        velocity: computeVelocity(series),
        acceleration: computeAcceleration(series),
        novelty: computeNovelty(series),
        persistence: computePersistence(series),
        volume: computeVolume(series, s.sourceType),
      };
    })
    .filter((s) => s.observationCount > 0);

  const avgScore = (metric) => {
    const available = perSource.filter((s) => s[metric].available);
    return available.length === 0 ? 0 : Math.round(mean(available.map((s) => s[metric].score)));
  };

  const growthPcts = perSource.filter((s) => s.growth.available).map((s) => s.growth.growthRatePct);
  const spread = computeSpread(perSource);
  // "서로 다른 시간대" 개수 - 소스가 달라도 같은 시각이면 하나로 셉니다.
  const observationCount = new Set(perSource.flatMap((s) => s.times)).size;

  const scores = {
    growth: avgScore("growth"),
    velocity: avgScore("velocity"),
    acceleration: avgScore("acceleration"),
    novelty: avgScore("novelty"),
    persistence: avgScore("persistence"),
    volume: avgScore("volume"),
    spread: spread.score,
  };

  const trendScore = computeTrendScore(scores);
  const saturation = typeof options.mainstreamScore === "number" ? options.mainstreamScore : scores.volume;
  const opportunityScore = computeOpportunityScore({
    trendScore,
    novelty: scores.novelty,
    growth: scores.growth,
    spread: scores.spread,
    persistence: scores.persistence,
    saturation,
  });
  const stage = classifyTrendStage(trendScore, { observationCount, sourceCount: spread.sourceCount });
  const trendType = classifyTrendType({
    observationCount,
    noveltyScore: scores.novelty,
    growthScore: scores.growth,
    velocityScore: scores.velocity,
    trendStage: stage.trendStage,
    saturation,
    seasonal: options.seasonality?.seasonal === true,
  });

  return {
    keyword,
    trendScore,
    opportunityScore,
    growthRatePct: growthPcts.length === 0 ? null : round1(mean(growthPcts)),
    growthScore: scores.growth,
    velocityScore: scores.velocity,
    accelerationScore: scores.acceleration,
    noveltyScore: scores.novelty,
    spreadScore: scores.spread,
    volumeScore: scores.volume,
    persistenceScore: scores.persistence,
    saturation,
    trendStage: stage.trendStage,
    rawStage: stage.rawStage,
    stageCapReason: stage.capReason,
    trendType,
    observationCount,
    sourceCount: spread.sourceCount,
    sources: perSource.map((s) => s.source),
    risingSources: spread.risingSources,
    perSource: perSource.map(({ times: _times, ...rest }) => rest),
  };
}
