// 19-8: Multi-Signal Trend Engine
//
// 19-7의 Clean Keyword Candidate(source별로 분리된 신호)를 keyword 기준으로
// 결합해, "여러 신호가 서로 다른 타이밍에 상승하기 시작하는가"를 계산합니다.
// 단순히 source value를 더하지 않습니다 - News mention count, Naver DataLab의
// 상대 검색 비율(0~100), Threads의 언급 발생 횟수는 단위와 의미가 전혀 다르므로,
// source 내부에서 먼저 정규화한 뒤에만 결합합니다.
//
// 이 파일은 두 계층으로 나뉩니다:
//   1) computeMultiSignalTrend() - 순수 함수(pure function). DB/시간 의존성이
//      전혀 없고, 완전히 결정적(deterministic)입니다. 대부분의 계산 로직이
//      여기 있어서 단위 테스트가 쉽습니다.
//   2) runMultiSignalEngine() - server/signalHistory.js(기존 19-3 파일, DB
//      schema 변경 없음)를 이용해 이전 스냅샷을 조회하고 이번 값을 기록하는
//      "얇은" 오케스트레이션 계층입니다. 실제 부수효과(DB 읽기/쓰기)는
//      여기에만 있습니다.
//
// 이 파일은 aggregateTrends()/calculateGrowthRate()/determineTrendStage()를
// 전혀 수정하지 않습니다(기존 News trend engine과 완전히 분리된 독립 모듈).
// 기존 signal_history 스키마도 그대로 사용하며, DB schema를 바꾸지 않습니다.
import { calculateSignalGrowth, getPreviousSignalSnapshot, recordSignalSnapshot } from "./signalHistory.js";
import { collectors } from "./collectors/index.js";

// 19-8 MVP용 configurable 값입니다. 아래 숫자들은 "정답"이 아니라 조정
// 가능한 시작점이며, 실제 데이터가 쌓이면 튜닝이 필요합니다.
export const MULTI_SIGNAL_CONFIG = {
  // source 이름별 override(있으면 sourceTypeWeights보다 우선). 지금은 비워
  // 두고 sourceType 단위로만 가중치를 관리합니다 - 새 source가 추가돼도
  // 이미 존재하는 sourceType(buzz/demand/exposure/diffusion 등)을 재사용하면
  // 이 엔진 코드를 고치지 않아도 됩니다.
  sourceWeights: {},
  sourceTypeWeights: {
    buzz: 1.2, // 초기 확산 신호에 조금 더 가중치
    demand: 1.0,
    exposure: 0.8, // 이미 대중 노출된 신호이므로 상대적으로 낮은 가중치
    diffusion: 1.0,
  },
  defaultWeight: 1.0,
  // exposure/buzz/diffusion류(언급 발생 횟수 기반) 정규화 시 "이 정도 언급이면
  // 100점으로 본다"는 기준값입니다. trendAggregator.js의 mentionCount 로그
  // 정규화 방식을 재사용했습니다.
  occurrenceReferenceMax: 20,
  growth: {
    neutralContribution: 50, // 이전 스냅샷이 없어 growth를 계산할 수 없을 때 사용하는 중립값
    scaleDivisor: 4, // growthRate(%)를 0~100 contribution으로 압축할 때 나누는 값
  },
  agreement: {
    // 방향성 있는 신호가 이 값보다 적으면 agreement를 비례해서 낮춥니다
    // (source 1개만으로 100% agreement를 주지 않기 위함).
    minSourcesForFullCredit: 3,
  },
  earlySignal: {
    weights: { buzz: 0.4, demand: 0.35, exposureInverse: 0.25 },
  },
  mainstream: {
    weights: { exposure: 0.5, overallLevel: 0.3, coverage: 0.2 },
  },
  score: {
    weights: { normalized: 0.3, growth: 0.25, coverage: 0.15, agreement: 0.1, early: 0.2 },
  },
};

function clamp(value, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function getSourceWeight(source, sourceType) {
  if (typeof source === "string" && typeof MULTI_SIGNAL_CONFIG.sourceWeights[source] === "number") {
    return MULTI_SIGNAL_CONFIG.sourceWeights[source];
  }
  if (typeof sourceType === "string" && typeof MULTI_SIGNAL_CONFIG.sourceTypeWeights[sourceType] === "number") {
    return MULTI_SIGNAL_CONFIG.sourceTypeWeights[sourceType];
  }
  return MULTI_SIGNAL_CONFIG.defaultWeight;
}

/**
 * source의 현재 값을 0~100 범위로 정규화합니다. sourceType에 따라 값의
 * 의미가 다르므로 서로 다른 방식을 사용합니다:
 * - "demand"(Naver DataLab/Google Trends): 이미 0~100 상대 지수이므로 clamp만.
 * - 그 외(exposure/buzz/diffusion 등): 언급 발생 횟수 같은 상한 없는 값이므로
 *   로그 스케일로 압축합니다(한두 개의 극단값이 정규화 결과를 독점하지 않도록).
 *
 * @param {number} currentValue
 * @param {string} sourceType
 * @returns {number} 0~100
 */
export function normalizeSignalValue(currentValue, sourceType) {
  if (typeof currentValue !== "number" || !Number.isFinite(currentValue) || currentValue < 0) {
    return 0;
  }

  if (sourceType === "demand") {
    return clamp(Math.round(currentValue), 0, 100);
  }

  const referenceMax = MULTI_SIGNAL_CONFIG.occurrenceReferenceMax;
  const scaled = (Math.log(currentValue + 1) / Math.log(referenceMax + 1)) * 100;
  return clamp(Math.round(scaled), 0, 100);
}

/**
 * growthRate(%, 무한대로 커질 수 있음)를 0~100 범위의 contribution으로
 * 압축합니다. 50을 중립(growth 0%)으로 두고, scaleDivisor로 나눈 만큼
 * 위아래로 움직이되 0~100을 벗어나지 않습니다. history가 없어 growth를
 * 계산할 수 없으면 중립값을 반환합니다(불이익도 가점도 주지 않음).
 *
 * @param {number|null} growthRate
 * @param {boolean} growthAvailable
 * @returns {number}
 */
export function computeGrowthContribution(growthRate, growthAvailable) {
  if (!growthAvailable || typeof growthRate !== "number" || !Number.isFinite(growthRate)) {
    return MULTI_SIGNAL_CONFIG.growth.neutralContribution;
  }
  return clamp(Math.round(50 + growthRate / MULTI_SIGNAL_CONFIG.growth.scaleDivisor), 0, 100);
}

function weightedAverage(items, valueFn) {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const item of items) {
    const weight = getSourceWeight(item.source, item.sourceType);
    weightedSum += valueFn(item) * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : null;
}

function averageBySourceType(signals, type, valueFn, fallback) {
  const matching = signals.filter((s) => s.sourceType === type);
  if (matching.length === 0) {
    return fallback;
  }
  const avg = weightedAverage(matching, valueFn);
  return avg === null ? fallback : avg;
}

/**
 * 하나의 keyword에 대한 여러 source signal을 결합해 Multi-Signal Trend
 * 결과를 계산하는 순수 함수입니다. DB/시간(Date.now())에 의존하지 않아
 * 같은 입력에는 항상 같은 결과를 반환합니다.
 *
 * @param {string} keyword
 * @param {Array<{source:string, sourceType:string, currentValue:number, previousValue:number|null}>} rawSignals
 * @param {Object} [options]
 * @param {number} [options.totalKnownSources] - coverage 계산 분모. 생략하면
 *   입력 signals에 등장한 distinct source 수를 사용합니다(최소 1).
 * @returns {Object} Multi-Signal Trend 결과
 */
export function computeMultiSignalTrend(keyword, rawSignals, options = {}) {
  const inputSignals = Array.isArray(rawSignals) ? rawSignals : [];

  const signals = inputSignals
    .filter(
      (s) => s && typeof s === "object" && typeof s.source === "string" && typeof s.sourceType === "string"
    )
    .map((s) => {
      const currentValue =
        typeof s.currentValue === "number" && Number.isFinite(s.currentValue) ? s.currentValue : 0;
      const previousValue =
        typeof s.previousValue === "number" && Number.isFinite(s.previousValue) && s.previousValue > 0
          ? s.previousValue
          : null;

      const growth =
        previousValue !== null
          ? calculateSignalGrowth(currentValue, previousValue)
          : { growthRate: null, growthAvailable: false };

      return {
        source: s.source,
        sourceType: s.sourceType,
        currentValue,
        previousValue,
        growthRate: growth.growthAvailable ? growth.growthRate : null,
        growthAvailable: growth.growthAvailable === true,
        normalizedValue: normalizeSignalValue(currentValue, s.sourceType),
      };
    });

  if (signals.length === 0) {
    return {
      keyword,
      multiSignalScore: 0,
      signalCoverage: 0,
      signalAgreement: 0,
      earlySignalScore: 0,
      mainstreamScore: 0,
      signals: [],
    };
  }

  const totalKnownSources =
    typeof options.totalKnownSources === "number" && options.totalKnownSources > 0
      ? options.totalKnownSources
      : Math.max(1, new Set(signals.map((s) => s.source)).size);

  // ---- Signal Coverage ----
  const distinctSources = new Set(signals.map((s) => s.source)).size;
  const signalCoverage = clamp(distinctSources / totalKnownSources, 0, 1);

  // ---- Signal Agreement ----
  const directions = signals
    .map((s) => (s.growthAvailable ? Math.sign(s.growthRate) : 0))
    .filter((d) => d !== 0);

  let signalAgreement = 0;
  if (directions.length > 0) {
    const positive = directions.filter((d) => d > 0).length;
    const negative = directions.filter((d) => d < 0).length;
    const rawAgreement = Math.max(positive, negative) / directions.length;
    // source 1~2개만으로 100% agreement를 주지 않도록 표본 크기로 감쇠합니다.
    const dampening = Math.min(1, directions.length / MULTI_SIGNAL_CONFIG.agreement.minSourcesForFullCredit);
    signalAgreement = clamp(rawAgreement * dampening, 0, 1);
  }

  // ---- 종합 지표 ----
  const overallNormalizedAvg = weightedAverage(signals, (s) => s.normalizedValue) ?? 0;
  const overallGrowthContributionAvg =
    weightedAverage(signals, (s) => computeGrowthContribution(s.growthRate, s.growthAvailable)) ??
    MULTI_SIGNAL_CONFIG.growth.neutralContribution;

  const buzzGrowth = averageBySourceType(
    signals,
    "buzz",
    (s) => computeGrowthContribution(s.growthRate, s.growthAvailable),
    MULTI_SIGNAL_CONFIG.growth.neutralContribution
  );
  const demandGrowth = averageBySourceType(
    signals,
    "demand",
    (s) => computeGrowthContribution(s.growthRate, s.growthAvailable),
    MULTI_SIGNAL_CONFIG.growth.neutralContribution
  );
  // exposure 신호가 아예 없으면 "낮다/높다"를 판단할 근거가 없으므로 중립(50)을 사용합니다.
  const exposureLevel = averageBySourceType(signals, "exposure", (s) => s.normalizedValue, 50);

  // ---- Early Signal ----
  // 이것은 "미래 유행을 예측하는 확률"이 아니라, 현재 신호 구조가 초기
  // 확산 단계와 얼마나 유사한 패턴(buzz/demand 상승 + exposure 낮음)을
  // 보이는지 나타내는 경험적(heuristic) 지표입니다.
  const earlyWeights = MULTI_SIGNAL_CONFIG.earlySignal.weights;
  const earlySignalScore = clamp(
    Math.round(
      buzzGrowth * earlyWeights.buzz +
        demandGrowth * earlyWeights.demand +
        (100 - exposureLevel) * earlyWeights.exposureInverse
    ),
    0,
    100
  );

  // ---- Mainstream Signal ----
  const coverageContribution = signalCoverage * 100;
  const mainstreamWeights = MULTI_SIGNAL_CONFIG.mainstream.weights;
  const mainstreamScore = clamp(
    Math.round(
      exposureLevel * mainstreamWeights.exposure +
        overallNormalizedAvg * mainstreamWeights.overallLevel +
        coverageContribution * mainstreamWeights.coverage
    ),
    0,
    100
  );

  // ---- Multi-Signal Score ----
  // 단순 source value 합산이 아니라, 정규화된 신호 수준 + growth + coverage +
  // agreement + early signal을 각각 0~100으로 압축한 뒤 가중합합니다.
  const scoreWeights = MULTI_SIGNAL_CONFIG.score.weights;
  const multiSignalScore = clamp(
    Math.round(
      overallNormalizedAvg * scoreWeights.normalized +
        overallGrowthContributionAvg * scoreWeights.growth +
        coverageContribution * scoreWeights.coverage +
        signalAgreement * 100 * scoreWeights.agreement +
        earlySignalScore * scoreWeights.early
    ),
    0,
    100
  );

  return {
    keyword,
    multiSignalScore,
    signalCoverage,
    signalAgreement,
    earlySignalScore,
    mainstreamScore,
    signals,
  };
}

function isUsableCandidate(candidate) {
  return (
    candidate &&
    typeof candidate === "object" &&
    typeof candidate.keyword === "string" &&
    candidate.keyword.length > 0 &&
    typeof candidate.source === "string" &&
    typeof candidate.sourceType === "string"
  );
}

/**
 * 19-7 Clean Keyword Candidate 배열을 (keyword, source) 기준으로 묶습니다.
 * 같은 (keyword, source) 조합이 여러 번 등장하면(예: 같은 기사에서 나온
 * 단어 candidate와 phrase candidate가 우연히 같은 keyword로 겹치는 경우는
 * 없지만, 여러 기사가 같은 단어를 포함하는 경우는 흔함) occurrence를
 * 누적하고, 숫자 value가 있으면 함께 모아둡니다.
 *
 * @param {Array<Object>} cleanCandidates
 * @returns {Map<string, {keyword:string, source:string, sourceType:string, extractionType:string, occurrences:number, values:number[]}>}
 */
function groupCleanCandidates(cleanCandidates) {
  const groups = new Map();

  for (const candidate of Array.isArray(cleanCandidates) ? cleanCandidates : []) {
    if (!isUsableCandidate(candidate)) {
      continue;
    }

    const key = `${candidate.keyword}::${candidate.source}`;

    if (!groups.has(key)) {
      groups.set(key, {
        keyword: candidate.keyword,
        source: candidate.source,
        sourceType: candidate.sourceType,
        extractionType: candidate.extractionType,
        occurrences: 0,
        values: [],
      });
    }

    const group = groups.get(key);
    group.occurrences += 1;

    if (typeof candidate.value === "number" && Number.isFinite(candidate.value)) {
      group.values.push(candidate.value);
    }
  }

  return groups;
}

/**
 * (keyword, source) 그룹의 "이번 수집에서의 현재 값"을 결정합니다.
 *
 * - sourceType이 "demand"이고 숫자 value가 있으면(Naver DataLab/Google
 *   Trends의 검색 지수) 그 값(여러 개면 평균)을 그대로 사용합니다.
 * - 그 외(News/Threads처럼 value가 없거나 sourceType이 exposure/buzz/
 *   diffusion 등인 경우)는 "이번 배치에서 이 keyword가 몇 번 관찰되었는가"
 *   (occurrence count)를 현재 값으로 사용합니다. News의 개별 candidate
 *   value(1)를 그대로 쓰지 않고 개수를 세는 이유는, "몇 건의 기사/게시물이
 *   이 키워드를 언급했는가"가 실제로 의미 있는 노출/확산 신호이기 때문입니다.
 *
 * @param {{sourceType:string, occurrences:number, values:number[]}} group
 * @returns {number}
 */
function resolveCurrentValue(group) {
  if (group.sourceType === "demand" && group.values.length > 0) {
    const sum = group.values.reduce((a, b) => a + b, 0);
    return sum / group.values.length;
  }
  return group.occurrences;
}

/**
 * 19-7 Clean Keyword Candidate 배열을 받아 실제 signal_history(19-3에서
 * 만든 기존 테이블, schema 변경 없음)를 조회/기록하면서 keyword별
 * Multi-Signal Trend 결과를 계산합니다. 이 함수만 DB에 접근합니다
 * (computeMultiSignalTrend()는 순수 함수로 유지).
 *
 * @param {Array<Object>} cleanCandidates - 19-7 filterKeywordCandidates() 등의 결과
 * @param {Object} [options]
 * @param {Date} [options.now] - 기준 시각(테스트용, 생략 시 현재 시각)
 * @param {boolean} [options.record=true] - false면 signal_history에 기록하지
 *   않고 조회만 합니다(반복 호출로 인한 스냅샷 오염을 피하고 싶을 때 사용).
 * @returns {Array<Object>} keyword별 Multi-Signal Trend 결과 배열
 */
export function runMultiSignalEngine(cleanCandidates, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const shouldRecord = options.record !== false;
  const timestamp = now.getTime();

  const groups = groupCleanCandidates(cleanCandidates);

  const totalKnownSources = Math.max(
    1,
    new Set([...Object.keys(collectors), ...[...groups.values()].map((g) => g.source)]).size
  );

  // source별 signal_history 조회/기록은 항상 group.keyword(원본 대소문자)를
  // 그대로 사용합니다 - 각 source 내부의 시계열 연속성에는 영향을 주지 않습니다.
  // 다만 서로 다른 source를 keyword 기준으로 "같은 키워드"로 묶는 단계에서는
  // 대소문자를 구분하지 않습니다. News 같은 text 추출 소스는 tokenizeTitle()이
  // 소문자화하지만, Naver DataLab/Google Trends 같은 explicit 소스는 원문
  // 대소문자를 보존하므로("AI" vs "ai"), 대소문자를 그대로 비교하면 같은
  // 개념의 키워드가 서로 다른 그룹으로 쪼개져 signal이 합쳐지지 않습니다.
  const byKeyword = new Map(); // lowerKeyword -> { displayKeyword, signals }

  for (const group of groups.values()) {
    const currentValue = resolveCurrentValue(group);
    const previousSnapshot = getPreviousSignalSnapshot(group.source, group.keyword, timestamp);
    const previousValue = previousSnapshot ? previousSnapshot.value : null;

    if (shouldRecord) {
      recordSignalSnapshot(group.source, group.keyword, currentValue, timestamp);
    }

    const lowerKeyword = group.keyword.toLowerCase();

    if (!byKeyword.has(lowerKeyword)) {
      byKeyword.set(lowerKeyword, { displayKeyword: group.keyword, signals: [] });
    }

    const entry = byKeyword.get(lowerKeyword);

    // explicit source(원문 대소문자를 의도적으로 보존)의 표기를 최종 keyword로
    // 우선 채택합니다 - text 추출 소스의 소문자화는 tokenizeTitle()의 부산물일
    // 뿐, 사용자가 실제로 검색/입력한 원래 형태가 아니기 때문입니다.
    if (group.extractionType === "explicit") {
      entry.displayKeyword = group.keyword;
    }

    entry.signals.push({
      source: group.source,
      sourceType: group.sourceType,
      currentValue,
      previousValue,
    });
  }

  const results = [];
  for (const { displayKeyword, signals } of byKeyword.values()) {
    results.push(computeMultiSignalTrend(displayKeyword, signals, { totalKnownSources }));
  }

  return results;
}
