// 트렌드 스냅샷 저장소 (18-4: SQLite 영속 저장)
//
// 18-3까지는 프로세스 메모리 Map이었으나, 이번 단계에서 SQLite(trend_history
// 테이블)로 옮겼습니다. 정책(TREND_HISTORY_MIN_INTERVAL_MS, MAX_AGE_MS,
// growthRate 계산에 쓰이는 "이전 스냅샷 선택" 로직)은 전혀 바꾸지 않았고,
// 외부에 노출하는 함수 이름/시그니처/반환 구조도 그대로 유지했습니다.
import { getDb } from "./database.js";

// 같은 키워드에 대해 이 값보다 짧은 간격으로는 새 스냅샷을 추가하지 않습니다.
// (연속/반복 호출로 인해 거의 동일한 시점끼리 비교되어 의미 없는
//  growthRate가 만들어지는 것을 방지하기 위함. 5분이면 사람이 의도적으로
//  기다렸다가 다시 호출하는 것과, 짧은 간격의 반복 폴링을 구분하기에 충분합니다.)
export const TREND_HISTORY_MIN_INTERVAL_MS = 5 * 60 * 1000; // 5분

// 이보다 오래된 스냅샷은 "너무 오래됨"으로 간주해 비교에 사용하지 않습니다.
// (기존 로직이 "최근 24시간"을 기준으로 삼았던 것과 동일한 시간 단위를 유지합니다.)
export const TREND_HISTORY_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24시간

// 키워드 하나당 보관하는 최대 스냅샷 개수 (무한정 증가 방지)
const MAX_SNAPSHOTS_PER_KEYWORD = 20;

function isValidCount(count) {
  return typeof count === "number" && Number.isFinite(count) && count >= 0;
}

/**
 * 키워드의 현재 mentionCount 스냅샷을 기록합니다.
 * 마지막 스냅샷이 TREND_HISTORY_MIN_INTERVAL_MS 이내라면 의미 없는 중복
 * 스냅샷을 쌓지 않기 위해 이번 호출은 기록하지 않고 조용히 무시합니다.
 * (이렇게 해야 마지막 스냅샷의 timestamp가 계속 "지금"으로 갱신되지 않고,
 *  자연스럽게 시간이 지나 유효한 "이전 스냅샷"이 될 수 있습니다.)
 *
 * @param {string} keyword
 * @param {number} count
 * @param {number} [timestamp]
 */
export function recordTrendSnapshot(keyword, count, timestamp = Date.now()) {
  if (!keyword || !isValidCount(count)) {
    return;
  }

  const db = getDb();
  const last = db
    .prepare("SELECT timestamp FROM trend_history WHERE keyword = ? ORDER BY timestamp DESC LIMIT 1")
    .get(keyword);

  if (last && timestamp - last.timestamp < TREND_HISTORY_MIN_INTERVAL_MS) {
    return;
  }

  db.prepare("INSERT INTO trend_history (keyword, mention_count, timestamp) VALUES (?, ?, ?)").run(
    keyword,
    count,
    timestamp
  );

  // 키워드당 최대 개수를 넘으면 오래된 것부터 정리합니다(무한정 증가 방지).
  db.prepare(
    `DELETE FROM trend_history
     WHERE keyword = ?
       AND id NOT IN (
         SELECT id FROM trend_history WHERE keyword = ? ORDER BY timestamp DESC LIMIT ?
       )`
  ).run(keyword, keyword, MAX_SNAPSHOTS_PER_KEYWORD);
}

/**
 * growthRate 계산에 사용할 "이전" 스냅샷을 조회합니다.
 * - currentTimestamp 기준으로 TREND_HISTORY_MIN_INTERVAL_MS 이상 지난 것 중 가장 최근 것
 * - TREND_HISTORY_MAX_AGE_MS보다 오래된 스냅샷만 남아있다면 null
 * - count가 0 이하이거나 유효하지 않은 스냅샷은 건너뜁니다
 *
 * @param {string} keyword
 * @param {number} [currentTimestamp]
 * @returns {{count:number, timestamp:number}|null}
 */
export function getPreviousSnapshot(keyword, currentTimestamp = Date.now()) {
  const db = getDb();
  const snapshots = db
    .prepare(
      "SELECT mention_count as count, timestamp FROM trend_history WHERE keyword = ? ORDER BY timestamp DESC"
    )
    .all(keyword);

  for (const snapshot of snapshots) {
    const age = currentTimestamp - snapshot.timestamp;

    if (age < TREND_HISTORY_MIN_INTERVAL_MS) {
      // 너무 최근(거의 동일 시점) -> 비교에 부적합, 더 이전 것을 찾아봄
      continue;
    }

    if (age > TREND_HISTORY_MAX_AGE_MS) {
      // 최신순 정렬이므로 이보다 더 앞의 것들은 전부 더 오래됨
      return null;
    }

    if (!isValidCount(snapshot.count) || snapshot.count <= 0) {
      continue;
    }

    return snapshot;
  }

  return null;
}

/**
 * 특정 키워드의 전체 스냅샷 배열을 반환합니다(시간순, 오래된 것부터).
 * @param {string} keyword
 * @returns {Array<{count:number, timestamp:number}>}
 */
export function getTrendHistory(keyword) {
  const db = getDb();
  return db
    .prepare("SELECT mention_count as count, timestamp FROM trend_history WHERE keyword = ? ORDER BY timestamp ASC")
    .all(keyword);
}

/**
 * 저장된 모든 트렌드 히스토리를 초기화합니다. (테스트 전용)
 */
export function clearTrendHistory() {
  const db = getDb();
  db.exec("DELETE FROM trend_history");
}

/**
 * TREND_HISTORY_MAX_AGE_MS보다 오래된 스냅샷을 정리합니다.
 * @param {number} [currentTimestamp]
 */
export function cleanupOldSnapshots(currentTimestamp = Date.now()) {
  const db = getDb();
  const cutoff = currentTimestamp - TREND_HISTORY_MAX_AGE_MS;
  db.prepare("DELETE FROM trend_history WHERE timestamp < ?").run(cutoff);
}

/**
 * 개발 전용 상태 확인 함수. 새 공개 API 없이 내부적으로(또는 테스트에서)
 * history 저장소의 현재 규모를 확인하기 위한 용도입니다.
 * @returns {{keywordCount:number, totalSnapshots:number, latestTimestamp:number|null}}
 */
export function getTrendHistoryStats() {
  const db = getDb();
  const keywordCount = db.prepare("SELECT COUNT(DISTINCT keyword) as c FROM trend_history").get().c;
  const totalSnapshots = db.prepare("SELECT COUNT(*) as c FROM trend_history").get().c;
  const latestTimestamp = db.prepare("SELECT MAX(timestamp) as t FROM trend_history").get().t;

  return {
    keywordCount,
    totalSnapshots,
    latestTimestamp: latestTimestamp ?? null,
  };
}

/**
 * 특정 키워드에 저장된 스냅샷 개수만 확인합니다. (개발 전용)
 * @param {string} keyword
 * @returns {number}
 */
export function getKeywordSnapshotCount(keyword) {
  const db = getDb();
  return db.prepare("SELECT COUNT(*) as c FROM trend_history WHERE keyword = ?").get(keyword).c;
}
