// 20-11: YouTube 일별 트렌드 데이터를 Supabase(youtube_daily_trends)에 저장
//
// youtubeTrend.js(calculateYoutubeTrend)의 계산 로직은 전혀 건드리지 않고,
// 그 결과를 저장하는 책임만 이 파일이 맡습니다 - database.js의 SQLite
// 연결과 signalHistory.js/trendHistory.js의 관계와 동일한 구조입니다
// (연결/client 생성은 supabase.js, "무엇을 언제 저장할지"는 이 파일).
import { getSupabaseClient, isSupabaseConfigured } from "./supabase.js";

export const YOUTUBE_DAILY_TRENDS_TABLE = "youtube_daily_trends";

/**
 * ISO timestamp(예: "2026-09-22T11:54:05.711Z")에서 UTC 기준 YYYY-MM-DD만
 * 추출합니다. 서버 로컬 시간대에 의존하지 않기 위해, Date 객체의 로컬
 * getter 대신 ISO 문자열 자체를 그대로 잘라 씁니다(ISO 8601 UTC 표기는
 * 항상 YYYY-MM-DD로 시작하므로 안전합니다).
 *
 * @param {string} isoTimestamp
 * @returns {string} YYYY-MM-DD
 */
export function toUtcDateString(isoTimestamp) {
  if (typeof isoTimestamp !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(isoTimestamp)) {
    throw new Error("toUtcDateString에는 유효한 ISO timestamp 문자열이 필요합니다.");
  }
  return isoTimestamp.slice(0, 10);
}

/**
 * YouTube 일별 트렌드 한 건을 Supabase의 youtube_daily_trends 테이블에
 * upsert합니다. (keyword, collected_date) UNIQUE 제약을 기준으로 동작해서,
 * 같은 키워드+날짜로 다시 호출해도 새 행이 중복 생성되지 않고 기존 행이
 * 갱신됩니다.
 *
 * Supabase가 설정되지 않았거나(SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY 없음)
 * 저장이 실패하면 예외를 던집니다 - 이 함수 자체는 실패를 삼키지 않으며,
 * "실패해도 /api/youtube/trend는 정상 응답해야 한다"는 요구사항은 이 함수를
 * 호출하는 쪽(server.js)이 try/catch로 감싸서 처리합니다.
 *
 * @param {Object} params
 * @param {string} params.keyword
 * @param {string} params.collectedDate - YYYY-MM-DD (UTC)
 * @param {number} params.videoCount
 * @param {boolean} params.capped
 * @returns {Promise<Object|null>} upsert된 행(가능한 경우)
 */
export async function saveYoutubeDailyTrend({ keyword, collectedDate, videoCount, capped }) {
  if (!isSupabaseConfigured()) {
    const error = new Error(
      "Supabase가 설정되지 않았습니다(SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY 필요)."
    );
    error.code = "supabase_not_configured";
    throw error;
  }

  if (typeof keyword !== "string" || !keyword.trim()) {
    throw new Error("saveYoutubeDailyTrend: keyword가 필요합니다.");
  }

  if (typeof collectedDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(collectedDate)) {
    throw new Error("saveYoutubeDailyTrend: collectedDate는 YYYY-MM-DD 형식이어야 합니다.");
  }

  if (typeof videoCount !== "number" || !Number.isFinite(videoCount)) {
    throw new Error("saveYoutubeDailyTrend: videoCount가 유효한 숫자여야 합니다.");
  }

  const client = getSupabaseClient();

  const { data, error } = await client
    .from(YOUTUBE_DAILY_TRENDS_TABLE)
    .upsert(
      {
        keyword: keyword.trim(),
        collected_date: collectedDate,
        video_count: videoCount,
        capped: Boolean(capped),
      },
      { onConflict: "keyword,collected_date" }
    )
    .select();

  if (error) {
    // Supabase 클라이언트 에러 객체를 그대로 던지지 않고 message만 뽑아
    // 새 Error로 감쌉니다 - youtube.js의 toSanitizedYoutubeError()와 동일한
    // 이유(내부 구현/설정 세부사항이 로그로 그대로 새는 것을 방지).
    const sanitized = new Error(`Supabase 저장 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_save_failed";
    throw sanitized;
  }

  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}
