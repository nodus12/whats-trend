// 19-3: 검색/수치형 Trend Signal(예: Naver DataLab)의 시계열 스냅샷 저장소
//
// 기존 trend_history 테이블(뉴스 mentionCount 전용, server/trendHistory.js)은
// 전혀 건드리지 않습니다. News growthRate 계산이 이 파일의 영향을 절대 받지
// 않도록, 완전히 분리된 새 테이블(signal_history)만 사용합니다.
//
// signal_history는 source 컬럼을 포함해서 (source, keyword) 조합으로
// 스냅샷을 구분합니다. 지금은 naver_datalab 하나뿐이지만, 이후 소스가
// 늘어나도 같은 keyword("AI" 등)끼리 source가 다르면 서로 다른 계열로
// 취급되어 growth 계산이 섞이지 않습니다.
import { getDb } from "./database.js";
import { calculateGrowthRate } from "./trendAggregator.js";
import { TREND_HISTORY_MIN_INTERVAL_MS, TREND_HISTORY_MAX_AGE_MS } from "./trendHistory.js";

// News와 동일한 정책(5분 최소 간격 / 24시간 최대 비교 범위)을 그대로
// 재사용합니다. Naver DataLab 데이터는 보통 하루 단위로만 갱신되어 이 값보다
// 훨씬 느리게 바뀌지만, 정책 자체를 새로 만들 이유가 없어 재사용했습니다.
const MIN_INTERVAL_MS = TREND_HISTORY_MIN_INTERVAL_MS;
const MAX_AGE_MS = TREND_HISTORY_MAX_AGE_MS;

// (source, keyword) 조합당 보관하는 최대 스냅샷 개수 (무한정 증가 방지)
const MAX_SNAPSHOTS_PER_KEY = 20;

function isValidValue(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * (source, keyword)의 현재 value 스냅샷을 기록합니다.
 * 마지막 스냅샷이 MIN_INTERVAL_MS 이내라면 기록하지 않고 조용히 무시합니다
 * (trendHistory.recordTrendSnapshot()과 동일한 정책).
 *
 * @param {string} source - 예: "naver_datalab"
 * @param {string} keyword
 * @param {number} value
 * @param {number} [timestamp]
 */
export function recordSignalSnapshot(source, keyword, value, timestamp = Date.now()) {
  if (!source || !keyword || !isValidValue(value)) {
    return;
  }

  const db = getDb();
  const last = db
    .prepare(
      "SELECT timestamp FROM signal_history WHERE source = ? AND keyword = ? ORDER BY timestamp DESC LIMIT 1"
    )
    .get(source, keyword);

  if (last && timestamp - last.timestamp < MIN_INTERVAL_MS) {
    return;
  }

  db.prepare(
    "INSERT INTO signal_history (source, keyword, value, timestamp) VALUES (?, ?, ?, ?)"
  ).run(source, keyword, value, timestamp);

  db.prepare(
    `DELETE FROM signal_history
     WHERE source = ? AND keyword = ?
       AND id NOT IN (
         SELECT id FROM signal_history WHERE source = ? AND keyword = ? ORDER BY timestamp DESC LIMIT ?
       )`
  ).run(source, keyword, source, keyword, MAX_SNAPSHOTS_PER_KEY);
}

/**
 * growth 계산에 사용할 "이전" 스냅샷을 조회합니다. trendHistory.getPreviousSnapshot()과
 * 동일한 정책입니다(최소 간격 이상 지났고, 최대 보관 기간 이내이며, 유효한 값만).
 *
 * @param {string} source
 * @param {string} keyword
 * @param {number} [currentTimestamp]
 * @returns {{value:number, timestamp:number}|null}
 */
export function getPreviousSignalSnapshot(source, keyword, currentTimestamp = Date.now()) {
  const db = getDb();
  const snapshots = db
    .prepare(
      "SELECT value, timestamp FROM signal_history WHERE source = ? AND keyword = ? ORDER BY timestamp DESC"
    )
    .all(source, keyword);

  for (const snapshot of snapshots) {
    const age = currentTimestamp - snapshot.timestamp;

    if (age < MIN_INTERVAL_MS) {
      continue;
    }

    if (age > MAX_AGE_MS) {
      return null;
    }

    if (!isValidValue(snapshot.value)) {
      continue;
    }

    return snapshot;
  }

  return null;
}

/**
 * 특정 (source, keyword)의 전체 스냅샷 배열을 반환합니다(시간순).
 * @param {string} source
 * @param {string} keyword
 * @returns {Array<{value:number, timestamp:number}>}
 */
export function getSignalHistory(source, keyword) {
  const db = getDb();
  return db
    .prepare(
      "SELECT value, timestamp FROM signal_history WHERE source = ? AND keyword = ? ORDER BY timestamp ASC"
    )
    .all(source, keyword);
}

/**
 * 저장된 모든 signal history를 초기화합니다. (테스트 전용)
 */
export function clearSignalHistory() {
  const db = getDb();
  db.exec("DELETE FROM signal_history");
}

/**
 * 검색/수치형 신호의 growth를 계산합니다.
 * server/trendAggregator.js가 이미 export하고 있는 calculateGrowthRate()를
 * 그대로 재사용합니다 - "이전 값이 0 이하이거나 없으면 growthAvailable=false"
 * 정책이 News와 완전히 동일하므로 새 계산식을 만들지 않았습니다.
 *
 * @param {number} currentValue
 * @param {number} previousValue
 * @returns {{growthRate:number|null, growthAvailable:boolean}}
 */
export function calculateSignalGrowth(currentValue, previousValue) {
  return calculateGrowthRate(currentValue, previousValue);
}

/**
 * 주어진 (source, keyword)의 이번 수집 값을 이전 스냅샷과 비교해 growth를
 * 계산하고, 다음 비교를 위해 이번 값을 기록합니다.
 * (server/trendAggregator.js 내부의 getHistoryBasedMetrics()와 동일한 패턴:
 *  비교에 사용한 뒤에 기록해야 이번 스냅샷이 스스로와 비교되지 않습니다.)
 *
 * @param {string} source
 * @param {string} keyword
 * @param {number} value
 * @param {Date} [now]
 * @returns {{previousValue:number, growthRate:number|null, growthAvailable:boolean}}
 */
export function getSignalGrowthMetrics(source, keyword, value, now = new Date()) {
  if (!isValidValue(value)) {
    return { previousValue: 0, growthRate: null, growthAvailable: false };
  }

  const timestamp = now.getTime();
  const previousSnapshot = getPreviousSignalSnapshot(source, keyword, timestamp);
  const previousValue = previousSnapshot ? previousSnapshot.value : 0;

  const growth = calculateSignalGrowth(value, previousValue);

  recordSignalSnapshot(source, keyword, value, timestamp);

  return { previousValue, ...growth };
}
