// 3-1단계: 뉴스 언급량(mentionCount)을 YouTube와 동일한 패턴으로 일별
// 수집/저장합니다.
//
// 절대 수정하지 않은 기존 파일: server/rss.js, server/trendAggregator.js,
// server/trendHistory.js, server/signalHistory.js. 이 파일은 그 함수들을
// "호출만" 하거나(tokenizeTitle), 시그니처를 바꿀 수 없는 경우(fetchGoogleNews는
// count 파라미터가 없고 항상 최대 10건 고정) 이 파일 전용으로 별도 함수를
// 새로 작성했습니다 - server/rss.js의 fetchGoogleNews() 자체는 한 줄도
// 건드리지 않았습니다.
//
// server/youtubeDailyTrend.js와 구조적으로 동일한 패턴(client 조회 없이
// isSupabaseConfigured() 체크 -> upsert)을 쓰지만, "유튜브 파이프라인 코드
// (server/youtube*.js) 수정 금지, 패턴만 참고해서 새로 만들 것"이라는
// 지시에 따라 그 파일들을 import하지 않고 이 파일 안에 독립적으로
// 작성했습니다(toUtcDateString 등 작은 헬퍼도 마찬가지로 별도 구현).
import axios from "axios";
import { parseStringPromise } from "xml2js";
import { tokenizeTitle } from "./trendAggregator.js";
import { getSupabaseClient, isSupabaseConfigured } from "./supabase.js";

export const NEWS_DAILY_TRENDS_TABLE = "news_daily_trends";
const GOOGLE_NEWS_RSS_URL = "https://news.google.com/rss/search";

// 3-1 수정: capped 판정 기준. 8개 키워드(엔비디아/트럼프/텀블러/캠핑의자/
// 코스피/포항 전기차충전소/제주도 게스트하우스 창업/오늘/날씨/뉴스/속보)로
// 실측한 결과 Google News RSS가 실제로 반환한 원본 총 건수의 관측 최댓값은
// 106건이었고(서로 다른 키워드에서 독립적으로 반복 관측됨 - 우연이 아니라
// 구조적 응답 상한으로 추정), 100건 미만인 키워드는 전부 원본 총 건수 자체가
// 낮았다(0~92건). 이 관측치를 바탕으로 100을 안전 마진을 둔 임계값으로
// 삼는다: 원본 RSS 총 건수 >= 100이면 "응답이 Google 쪽 상한에 의해
// 잘렸을 수 있어 정확한 전체 개수를 알 수 없다"는 의미로 capped: true.
// Google이 이 상한을 공식 문서로 명시하지 않으므로 100은 어디까지나 관측
// 기반 추정치다 - 향후 106을 넘는 사례가 실측되면 이 값을 재조정해야 한다.
const CAPPED_THRESHOLD = 100;

/**
 * ISO timestamp(예: "2026-09-23T11:54:05.711Z")에서 UTC 기준 YYYY-MM-DD만
 * 추출합니다. youtubeDailyTrend.js의 toUtcDateString()과 동일한 로직이지만,
 * server/youtube*.js를 import하지 않기 위해 이 파일에 독립적으로 둡니다.
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
 * Google News RSS 응답을 받아온 그대로(잘라내지 않고) 전부 반환합니다.
 * server/rss.js의 fetchGoogleNews()와 동일한 endpoint
 * ("https://news.google.com/rss/search")와 query parameter(q, hl, gl,
 * ceid)를 쓰지만, fetchGoogleNews()는 결과를 항상 10건으로 자르도록
 * 만들어져 있어 그 함수를 고치는 대신 이 파일 전용으로 별도 작성했습니다.
 *
 * 3-1 수정: 이전에는 상위 30건만 잘라서 mention_count를 셌으나(실측 결과
 * 실제 언급량을 최대 3배 이상 과소측정하는 것으로 확인됨), 이제는 별도
 * 클라이언트 측 절단 없이 RSS가 준 전체 항목을 그대로 사용합니다. capped
 * 여부는 이 전체 건수(rawCount)만으로 판정합니다(CAPPED_THRESHOLD 참고).
 *
 * @param {string} query
 * @returns {Promise<{articles: Array<{title:string, link:string, pubDate:string}>, rawCount: number, capped: boolean}>}
 */
async function fetchNewsArticles(query) {
  const normalizedQuery = query?.trim() || "AI";

  const response = await axios.get(GOOGLE_NEWS_RSS_URL, {
    params: {
      q: normalizedQuery,
      hl: "ko",
      gl: "KR",
      ceid: "KR:ko",
    },
    responseType: "text",
    timeout: 10000,
  });

  const parsed = await parseStringPromise(response.data, {
    explicitArray: true,
    trim: true,
  });

  const items = parsed?.rss?.channel?.[0]?.item ?? [];
  const rawCount = items.length;
  const capped = rawCount >= CAPPED_THRESHOLD;

  const articles = items.map((item) => ({
    title: item.title?.[0] ?? "",
    link: item.link?.[0] ?? "",
    pubDate: item.pubDate?.[0] ?? "",
  }));

  return { articles, rawCount, capped };
}

/**
 * 기사 제목을 trendAggregator.tokenizeTitle()로 토큰화해서, 검색어(query)를
 * 동일하게 토큰화한 결과와 "정확히 일치"하는 기사 수를 셉니다. query가
 * 여러 토큰으로 쪼개지면(예: 공백이 있는 검색어) 그 토큰 전부가(AND) 기사
 * 제목 토큰에 포함돼야 매칭으로 칩니다 - 이 프로젝트의 검색어는 대부분
 * "무선선풍기"처럼 공백 없는 단일 토큰이므로 이 경우는 그 토큰 하나가
 * 정확히 있는지만 봅니다.
 *
 * tokenizeTitle()은 trendAggregator.js에서 그대로 import해서 재사용합니다
 * (같은 프로젝트의 기존 News 파이프라인과 동일한 토큰화 규칙 - 조사 제거,
 * 불용어 제거 등 - 을 새로 만들지 않기 위함이며, trendAggregator.js 자체는
 * 수정하지 않았습니다).
 *
 * @param {Array<{title:string}>} articles
 * @param {string} query
 * @returns {number}
 */
function countExactMentions(articles, query) {
  const queryTokens = tokenizeTitle(query);

  if (queryTokens.length === 0) {
    return 0;
  }

  let count = 0;

  for (const article of articles) {
    const titleTokens = new Set(tokenizeTitle(article?.title ?? ""));
    const isExactMatch = queryTokens.every((token) => titleTokens.has(token));

    if (isExactMatch) {
      count += 1;
    }
  }

  return count;
}

/**
 * 검색어(query)에 대한 오늘 시점 뉴스 언급량을 수집합니다(RSS 호출 1회).
 * YouTube의 calculateYoutubeTrend()와 동일하게 "이번 호출"의 스냅샷만
 * 계산하며, DB 저장은 별도 함수(saveNewsDailyTrend)가 담당합니다.
 *
 * @param {string} query
 * @returns {Promise<{keyword:string, collectedAt:string, mentionCount:number, capped:boolean}>}
 */
export async function collectNewsDailyMentionCount(query) {
  if (!query || typeof query !== "string" || !query.trim()) {
    const error = new Error("collectNewsDailyMentionCount에는 유효한 검색어가 필요합니다.");
    error.code = "news_daily_trend_invalid_query";
    throw error;
  }

  const collectedAt = new Date();
  const trimmedQuery = query.trim();
  const { articles, capped } = await fetchNewsArticles(trimmedQuery);
  const mentionCount = countExactMentions(articles, trimmedQuery);

  return {
    keyword: trimmedQuery,
    collectedAt: collectedAt.toISOString(),
    mentionCount,
    capped,
  };
}

/**
 * news_daily_trends에 (keyword, collected_date) 기준으로 upsert합니다.
 * 동일 패턴: 이미 존재하면 값만 갱신되고 새 row가 중복 생성되지 않습니다.
 *
 * @param {Object} params
 * @param {string} params.keyword
 * @param {string} params.collectedDate - YYYY-MM-DD (UTC)
 * @param {number} params.mentionCount
 * @param {boolean} params.capped
 * @returns {Promise<Object|null>} upsert된 행(가능한 경우)
 */
export async function saveNewsDailyTrend({ keyword, collectedDate, mentionCount, capped }) {
  if (!isSupabaseConfigured()) {
    const error = new Error(
      "Supabase가 설정되지 않았습니다(SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY 필요)."
    );
    error.code = "supabase_not_configured";
    throw error;
  }

  if (typeof keyword !== "string" || !keyword.trim()) {
    throw new Error("saveNewsDailyTrend: keyword가 필요합니다.");
  }

  if (typeof collectedDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(collectedDate)) {
    throw new Error("saveNewsDailyTrend: collectedDate는 YYYY-MM-DD 형식이어야 합니다.");
  }

  // mentionCount는 0도 유효한 값입니다(뉴스에 전혀 없는 키워드) - typeof
  // 체크만으로 판별하고, 0을 falsy로 취급해 거부하지 않습니다.
  if (typeof mentionCount !== "number" || !Number.isFinite(mentionCount)) {
    throw new Error("saveNewsDailyTrend: mentionCount가 유효한 숫자여야 합니다.");
  }

  const client = getSupabaseClient();

  const { data, error } = await client
    .from(NEWS_DAILY_TRENDS_TABLE)
    .upsert(
      {
        keyword: keyword.trim(),
        collected_date: collectedDate,
        mention_count: mentionCount,
        capped: Boolean(capped),
      },
      { onConflict: "keyword,collected_date" }
    )
    .select();

  if (error) {
    const sanitized = new Error(`Supabase 저장 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_save_failed";
    throw sanitized;
  }

  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}
