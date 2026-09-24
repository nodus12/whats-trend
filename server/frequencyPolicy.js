// 18-6: 사용자별 알림 빈도(frequency) 정책
//
// 기존 RISING_TREND 판정(src/utils/notifications.js의 shouldNotifyRisingTrend)은
// 전혀 건드리지 않습니다. 이 함수는 그 판정을 "이미 통과한" 트렌드에 대해서만
// "이 사용자가 얼마나 민감하게 알림을 받고 싶어하는가"를 추가로 확인하는
// 순수 함수입니다. trend의 growthRate/stage/nextScore 값 자체는 절대 바꾸지 않고
// 읽기만 합니다. localStorage/window/document/Push API/SQLite에 의존하지 않습니다.
//
// 정책:
// - "high"   : 추가 제한 없음 (RISING_TREND 후보면 전부 허용 - 가장 민감한 설정)
// - "normal" : 추가 제한 없음 (기존 기본 동작과 완전히 동일 - 이 프로젝트의 기본값)
// - "low"    : trend.stage === "폭발 직전"인 경우에만 허용 (알림 피로를 최소화)
// - 그 외 알 수 없는 값(예: "invalid", null, undefined)은 "normal"과 동일하게
//   처리합니다(기존 18-3의 "잘못된 값이면 기본값 normal 사용" 정책과 일치).
//
// "low"의 기준으로 원시 growthRate 대신 이미 계산된 stage를 재사용했습니다.
// server/trendAggregator.js의 determineTrendStage()는 "폭발 직전" 단계를
// growthRate >= 100 이면서 동시에 mentionCount >= 4 && recentMentionCount >= 3
// (충분한 언급량)까지 만족할 때만 부여합니다. 즉 이미 검증된, growthRate 단독
// 임계값보다 더 신뢰할 수 있는 "강한 신호" 판정이라 새로운 계산식을 만들지
// 않고 그대로 재사용했습니다.
const STRONG_STAGE = "폭발 직전";

/**
 * 이미 RISING_TREND 조건을 통과한 trend에 대해, 주어진 frequency 설정을 가진
 * 사용자에게 이번 알림을 보내도 되는지 판단합니다.
 *
 * @param {Object} trend - shouldNotifyRisingTrend()를 이미 통과한 트렌드 객체
 * @param {string} frequency - "high" | "normal" | "low" (그 외 값은 "normal"과 동일)
 * @returns {boolean}
 */
export function shouldNotifyByFrequency(trend, frequency) {
  if (!trend || typeof trend !== "object") {
    return false;
  }

  if (frequency === "low") {
    return trend.stage === STRONG_STAGE;
  }

  // "high", "normal", 그리고 그 외 알 수 없는 값은 RISING_TREND 후보 이상으로
  // 추가 제한하지 않습니다.
  return true;
}
