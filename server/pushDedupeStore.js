// 18-4: Push dedupe(하루 1회 중복 발송 방지) 기록의 SQLite 영속 저장소.
// trendNotifier.js가 기존에 메모리 Map(sentTrendPushLog)으로 관리하던 것을
// 그대로 옮긴 것으로, dedupe key 형식(type:trendId:date)이나 "하루 1회" 정책은
// 전혀 바꾸지 않았습니다.
import { getDb } from "./database.js";

/**
 * 이 dedupe key가 이미 기록되어 있는지 확인합니다(읽기 전용, 빠른 사전 필터용).
 * 실제 중복 방지 보장은 recordDedupeKeyIfAbsent()의 UNIQUE 제약이 담당합니다.
 * @param {string} dedupeKey
 * @returns {boolean}
 */
export function hasDedupeKey(dedupeKey) {
  const db = getDb();
  const row = db.prepare("SELECT 1 FROM push_dedupe WHERE dedupe_key = ?").get(dedupeKey);
  return Boolean(row);
}

/**
 * dedupe key를 원자적으로 기록합니다. 이미 존재하면(동시 요청 등으로 먼저
 * 선점된 경우 포함) UNIQUE 제약으로 INSERT가 실패하며, 이 함수는 false를
 * 반환합니다 - 이 경우 호출자는 발송을 건너뛰어야 합니다.
 *
 * @param {string} dedupeKey
 * @param {string} type
 * @param {string} trendId
 * @param {string} notificationDate - YYYY-MM-DD (trendNotifier.js의 todayString())
 * @returns {boolean} true면 이번 호출이 새로 기록(선점)한 것, false면 이미 존재했음
 */
export function recordDedupeKeyIfAbsent(dedupeKey, type, trendId, notificationDate) {
  const db = getDb();

  try {
    db.prepare(
      "INSERT INTO push_dedupe (dedupe_key, type, trend_id, notification_date, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(dedupeKey, type, trendId, notificationDate, Date.now());
    return true;
  } catch {
    // UNIQUE constraint failed -> 이미 기록되어 있음
    return false;
  }
}

/**
 * 저장된 모든 dedupe 기록을 삭제합니다. (테스트 전용)
 */
export function clearDedupeStore() {
  const db = getDb();
  db.exec("DELETE FROM push_dedupe");
}
