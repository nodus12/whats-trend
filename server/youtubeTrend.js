// 20-9~20-10: YouTube 트렌드 수집/분석 1단계
//
// 목표는 검색어와 관련된 "최근 신규 영상 발생량"을 기간별(1d/3d/7d/30d)로
// 계산하는 것입니다. youtube.js의 searchYoutubeVideosWithMeta()가 반환한
// 검색 결과(최대 50개, 한 번의 API 호출)의 publishedAt 값을 실제로 분석해서
// 각 기간 이내에 게시된 영상 개수를 세며, 검색 결과 개수 자체를 그대로
// "발생량"으로 쓰지 않습니다.
//
// 20-10: 50개 제한으로 인한 절단(truncation) 문제를 "capped" 플래그로
// 명시적으로 드러냅니다. 페이지네이션은 이번 단계에서도 추가하지 않습니다
// (search.list 호출 횟수를 최소화하는 것이 우선 - 아래 quota 설명 참고).
import { searchYoutubeVideosWithMeta } from "./youtube.js";

// 한 번의 API 호출로 가져올 최대 영상 수. YouTube Data API v3가 허용하는
// 상한(50)과 동일 - 더 늘릴 수 없으므로 이 값이 곧 이 모듈이 다룰 수 있는
// 영상 표본의 최대치입니다.
const TREND_SEARCH_MAX_RESULTS = 50;

const PERIOD_DEFINITIONS = [
  ["1d", 1],
  ["3d", 3],
  ["7d", 7],
  ["30d", 30],
];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 영상 배열에서 유효한(파싱 가능한) publishedAt 중 가장 오래된 시각(ms)을
 * 찾습니다. 배열의 정렬 순서(order=date가 실제로 내림차순인지)에 의존하지
 * 않도록, 순서를 신뢰하는 대신 전체를 훑어 최솟값을 직접 계산합니다.
 *
 * @param {Array<{publishedAt:string}>} videos
 * @returns {number|null}
 */
function getOldestPublishedMs(videos) {
  let oldest = null;

  for (const video of videos) {
    const ms = Date.parse(video?.publishedAt);

    if (!Number.isFinite(ms)) {
      continue;
    }

    if (oldest === null || ms < oldest) {
      oldest = ms;
    }
  }

  return oldest;
}

/**
 * 주어진 영상 배열에서 publishedAt이 now로부터 days일 이내인 영상 개수를
 * 셉니다("최근 N일 이내 누적 발생량" - 기간끼리 겹치는 누적 집계이며 서로
 * 배타적인 구간이 아닙니다. 예: 3d 값은 1d에 포함된 영상도 포함합니다).
 *
 * @param {Array<{publishedAt:string}>} videos
 * @param {number} nowMs
 * @param {number} days
 * @returns {number}
 */
function countVideosWithinDays(videos, nowMs, days) {
  const thresholdMs = days * DAY_MS;
  let count = 0;

  for (const video of videos) {
    const publishedMs = Date.parse(video?.publishedAt);

    if (!Number.isFinite(publishedMs)) {
      continue;
    }

    const ageMs = nowMs - publishedMs;

    // 미래 시각(시계 오차 등)은 제외하고, 임계값 이내인 경우만 카운트합니다.
    if (ageMs >= 0 && ageMs <= thresholdMs) {
      count += 1;
    }
  }

  return count;
}

/**
 * 특정 기간(days)의 카운트가 "50개 제한 때문에 잘렸을 가능성"이 있는지
 * 판단합니다.
 *
 * 판정 기준(요청 사양 그대로):
 * - 이번에 받아온 결과들 중 가장 오래된 영상까지도 해당 기간 이내라면
 *   -> capped = true (그 기간에 더 있었을 수도 있는데 50개 한도 때문에
 *      못 봤을 가능성이 있음 - "적어도 이만큼", 즉 하한값)
 * - 가장 오래된 영상이 해당 기간보다 오래됐다면(=기간의 경계를 이번 페이지
 *   안에서 실제로 확인했다면)
 *   -> capped = false (그 기간에 대해서는 정확한 값)
 *
 * 추가 보강: YouTube가 함께 알려주는 pageInfo.totalResults(전체 매칭 결과
 * 수 추정치)를 사용해, "애초에 전체 결과 수가 50개 이하라 이번 페이지에
 * 이미 전부 들어있는" 경우는 어떤 기간에 대해서도 capped=false로
 * 처리합니다 - 이 경우는 날짜 경계와 무관하게 이미 완전한 데이터이기
 * 때문입니다(50개 요청에 정확히 50개가 온 것과, "이게 전체 결과의 전부"인
 * 것은 다른 상황입니다).
 *
 * @param {number|null} oldestPublishedMs
 * @param {number} nowMs
 * @param {number} days
 * @param {number} videoCount - 이번에 받아온 영상 개수
 * @param {number|null} totalResults - YouTube가 알려준 전체 매칭 결과 수 추정치
 * @returns {boolean}
 */
function isPeriodCapped(oldestPublishedMs, nowMs, days, videoCount, totalResults) {
  if (oldestPublishedMs === null || videoCount === 0) {
    return false;
  }

  const haveEntireResultSet =
    typeof totalResults === "number" && Number.isFinite(totalResults) && videoCount >= totalResults;

  if (haveEntireResultSet) {
    return false;
  }

  const thresholdMs = days * DAY_MS;
  const oldestAgeMs = nowMs - oldestPublishedMs;

  return oldestAgeMs <= thresholdMs;
}

/**
 * 검색어에 대한 YouTube 최근 영상 발생량을 기간별로 계산합니다.
 * searchYoutubeVideosWithMeta()를 그대로 사용하며, API 호출은 1회만
 * 발생합니다.
 *
 * 다음 단계(publishedAfter/publishedBefore로 기간을 직접 지정한 재조회,
 * pageToken을 이용한 다음 페이지 조회, Supabase 저장, 일별 신규 영상 수,
 * 3일/7일/30일 성장률 계산)를 위한 준비로, 이 함수는 원시 영상 배열
 * (videos)과 totalResults를 계산 로직과 분리된 형태로 다루고 있어 향후
 * 이 함수를 확장하거나 별도 저장 계층에 videos를 그대로 넘기기 쉽습니다.
 * 다만 이번 단계에서는 그런 확장을 실제로 구현하지 않았습니다.
 *
 * @param {string} query - 검색어
 * @returns {Promise<{
 *   keyword: string,
 *   collectedAt: string,
 *   periods: {"1d":number, "3d":number, "7d":number, "30d":number},
 *   capped: {"1d":boolean, "3d":boolean, "7d":boolean, "30d":boolean},
 *   dataQuality: {mode:string, maxResults:number, note:string}
 * }>}
 */
export async function calculateYoutubeTrend(query) {
  const collectedAt = new Date();
  const nowMs = collectedAt.getTime();

  // 단 1회의 API 호출로 최대 50개까지 가져옵니다(페이지네이션 없음 - 이번
  // 단계에서는 search.list 호출 횟수를 최소화하는 것을 우선합니다).
  const { videos, totalResults } = await searchYoutubeVideosWithMeta(query, {
    maxResults: TREND_SEARCH_MAX_RESULTS,
  });

  const oldestPublishedMs = getOldestPublishedMs(videos);

  const periods = {};
  const capped = {};

  for (const [label, days] of PERIOD_DEFINITIONS) {
    periods[label] = countVideosWithinDays(videos, nowMs, days);
    capped[label] = isPeriodCapped(oldestPublishedMs, nowMs, days, videos.length, totalResults);
  }

  return {
    keyword: query.trim(),
    collectedAt: collectedAt.toISOString(),
    periods,
    capped,
    dataQuality: {
      mode: "first_page_only",
      maxResults: TREND_SEARCH_MAX_RESULTS,
      note: "각 기간의 값은 검색 결과 첫 페이지 기준이며 capped=true인 기간은 실제 발생량이 더 많을 수 있습니다.",
    },
  };
}
