// 3-2단계: 네이버 검색어트렌드(NAVER API HUB) 성장률(3d/7d/30d) + Trend Score
//
// 3-2-0단계 조사에서 확인된 제약사항 때문에 YouTube/뉴스와 근본적으로 다른
// 방식으로 설계했습니다:
//   1. ratio(상대 지수)는 "한 요청 안에서 조회된 기간(및 함께 넣은 다른
//      keywordGroups) 중 최댓값을 100으로 잡는" 값이라, 서로 다른 날에
//      따로 수집해 저장한 값끼리는 비교할 수 없습니다(실측: 같은 날짜인데
//      30일 요청과 60일 요청의 ratio가 서로 다르게 나옴). 그래서 매 요청마다
//      필요한 기간(35일치)을 한 번에 통째로 가져와서, 그 안에서 3/7/30일치를
//      비교합니다 - YouTube/뉴스처럼 "일별로 저장해뒀다가 나중에 비교"하는
//      방식이 아닙니다.
//   2. 같은 요청에 여러 keywordGroups를 넣으면 100 기준점이 오염되는 것도
//      실측으로 확인했습니다(예: "무선선풍기"를 "선풍기"와 같이 조회하면
//      같은 날짜의 ratio가 크게 달라짐). 그래서 이 파일은 항상
//      keywordGroups 1개, keywords 1개만 요청에 담습니다.
//   3. DataLab은 당일 데이터를 그 날 안에는 아직 안 줄 수 있습니다(실측:
//      오늘 날짜의 data 포인트가 응답에서 아예 빠져 있었음). 그래서 "오늘"
//      대신 응답에서 실제로 받은 가장 최근 날짜(asOf)를 기준으로 3/7/30일을
//      계산합니다.
//   4. 이 API는 capped 같은 "신뢰도 저하" 개념이 없으므로(뉴스의 30건 제한,
//      유튜브의 조회수 상한 같은 게 없음), dataQuality는 ok/insufficient_data
//      두 가지만 씁니다(unreliable 없음).
//
// 제약사항: server/collectors/naverDataLabCollector.js(/api/trends의
// multi-signal 보강용으로 이미 쓰이고 있음), server/trendAggregator.js,
// /api/trends 라우트는 이 파일에서 전혀 참조/수정하지 않습니다 - 완전히
// 독립된 새 구현입니다. calculateTrendScore()만 youtubeTrendGrowth.js에서
// 그대로 import해서 재사용합니다(복제 금지, 소스 무관 범용 함수이므로).
//
// 저장 방식도 YouTube/뉴스와 다릅니다: 일별 원본 시계열은 저장하지 않고,
// "이 키워드를 오늘 계산한 최종 결과(growth+trendScore)"만 하루 1회
// 캐싱합니다(무료 할당량 보호 목적) - naver_trend_cache 테이블.
import axios from "axios";
import { getSupabaseClient, isSupabaseConfigured } from "./supabase.js";
import { calculateTrendScore } from "./youtubeTrendGrowth.js";

export { calculateTrendScore };

export const NAVER_TREND_CACHE_TABLE = "naver_trend_cache";

// 3-2-0단계 조사에서 공식 문서(api.ncloud-docs.com/docs/naver-api-hub-search-trend)로
// 직접 대조 확인한 값입니다. 구버전 개발자센터 엔드포인트/헤더
// (openapi.naver.com, X-Naver-Client-Id/Secret)와는 다릅니다.
const NAVER_APIHUB_URL = "https://naverapihub.apigw.ntruss.com/search-trend/v1/search";
const GROWTH_PERIODS = [3, 7, 30];
const RANGE_DAYS = 35;

/**
 * NAVER API HUB 인증 정보(Client ID/Secret)가 설정되어 있는지 확인합니다.
 * 구버전 naverDataLabCollector.js의 isNaverConfigured()와 같은 환경변수
 * 이름을 쓰지만(NAVER_CLIENT_ID/NAVER_CLIENT_SECRET), 그 파일을 import하지
 * 않고 이 파일에 독립적으로 둡니다(완전히 새로운 파일로 구현하라는 제약).
 * @returns {boolean}
 */
function isNaverApiHubConfigured() {
  return Boolean(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET);
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * "YYYY-MM-DD" 문자열에서 UTC 기준 N일 전 날짜를 "YYYY-MM-DD"로 계산합니다.
 * youtubeTrendGrowth.js/newsTrendGrowth.js의 subtractUtcDays()와 동일한
 * 로직이지만, 이 파일도 그 파일들을 import하지 않고 독립적으로 둡니다.
 * @param {string} dateStr
 * @param {number} days
 * @returns {string}
 */
function subtractUtcDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * axios 에러에서 인증 헤더(Client ID/Secret이 담긴 error.config 등)를 걷어내고
 * 상태 코드/메시지만 담은 안전한 Error를 만듭니다. 이번 조사에서 자격증명이
 * 두 차례 노출된 사고가 있었으므로, 이 파일(프로덕션 코드)에서는 절대
 * error 객체 원문을 로그로 남기지 않고 항상 이 함수를 거칩니다.
 * @param {*} error
 * @returns {Error & {statusCode: number|null, code: string}}
 */
function toSanitizedNaverError(error) {
  const statusCode =
    error && error.response && typeof error.response.status === "number" ? error.response.status : null;
  const sanitized = new Error(
    statusCode ? `NAVER API HUB 요청 실패 (status ${statusCode})` : `NAVER API HUB 요청 실패: ${error?.message ?? "unknown_error"}`
  );
  sanitized.statusCode = statusCode;
  sanitized.code = "naver_request_failed";
  return sanitized;
}

/**
 * 최근 RANGE_DAYS(35)일치를 한 번의 요청으로 가져옵니다. keywordGroups는
 * 항상 1개, keywords도 1개만 담습니다(100 기준점 오염 방지 - 3-2-0단계
 * 실측으로 확인된 제약).
 * @param {string} keyword
 * @returns {Promise<Array<{period:string, ratio:number}>>}
 */
async function fetchNaverTrendData(keyword) {
  if (!isNaverApiHubConfigured()) {
    const error = new Error("NAVER API HUB 인증 정보(NAVER_CLIENT_ID/NAVER_CLIENT_SECRET)가 설정되지 않았습니다.");
    error.code = "naver_not_configured";
    throw error;
  }

  const now = new Date();
  const endDate = formatDate(now);
  const startDate = formatDate(new Date(now.getTime() - RANGE_DAYS * 24 * 60 * 60 * 1000));

  let response;
  try {
    response = await axios.post(
      NAVER_APIHUB_URL,
      {
        startDate,
        endDate,
        timeUnit: "date",
        keywordGroups: [{ groupName: keyword, keywords: [keyword] }],
      },
      {
        headers: {
          "X-NCP-APIGW-API-KEY-ID": process.env.NAVER_CLIENT_ID,
          "X-NCP-APIGW-API-KEY": process.env.NAVER_CLIENT_SECRET,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );
  } catch (error) {
    throw toSanitizedNaverError(error);
  }

  return Array.isArray(response.data?.results?.[0]?.data) ? response.data.results[0].data : [];
}

/**
 * 3d/7d/30d 전부 insufficient_data인 growth 객체를 만듭니다(데이터가 아예
 * 없거나, 비교 날짜가 없는 경우 공통으로 씀).
 * @returns {Object}
 */
function buildAllInsufficientGrowth() {
  const growth = {};
  for (const days of GROWTH_PERIODS) {
    growth[`${days}d`] = { compareDate: null, rate: null, dataQuality: "insufficient_data" };
  }
  return growth;
}

/**
 * data 배열(period/ratio 목록)과 기준 날짜(asOf)를 바탕으로 3d/7d/30d
 * growth를 계산합니다. 비교 날짜가 data에 정확히 없으면(근사치 대체 없음)
 * insufficient_data. 비교 날짜는 있는데 ratio가 0이면 나눗셈이 정의되지
 * 않아(0으로 나누기) rate를 계산할 수 없으므로, 이 경우도 insufficient_data로
 * 처리합니다 - 스펙엔 ok/insufficient_data 두 상태만 있다고 명시되어 있고
 * 이 케이스가 별도로 언급되진 않았지만, calculateTrendScore()가 "ok"
 * 항목은 항상 유효한 숫자 rate를 가진다고 가정하고 동작하므로 방어적으로
 * 이렇게 처리했습니다(compareDate는 실제로 찾은 날짜를 그대로 넣어 "날짜가
 * 없어서"가 아니라 "값이 0이라 계산 불가"임을 구분할 수 있게 함).
 * @param {Array<{period:string, ratio:number}>} data
 * @param {string} asOf
 * @param {number} asOfRatio
 * @returns {Object}
 */
function computeGrowthFromData(data, asOf, asOfRatio) {
  const growth = {};

  for (const days of GROWTH_PERIODS) {
    const compareDate = subtractUtcDays(asOf, days);
    const compareEntry = data.find((d) => d.period === compareDate);

    if (!compareEntry) {
      growth[`${days}d`] = { compareDate: null, rate: null, dataQuality: "insufficient_data" };
      continue;
    }

    if (compareEntry.ratio === 0) {
      growth[`${days}d`] = { compareDate: compareEntry.period, rate: null, dataQuality: "insufficient_data" };
      continue;
    }

    const rate = Math.round(((asOfRatio - compareEntry.ratio) / compareEntry.ratio) * 1000) / 10;
    growth[`${days}d`] = { compareDate: compareEntry.period, rate, dataQuality: "ok" };
  }

  return growth;
}

async function getCachedResult(client, keyword, cacheDate) {
  const { data, error } = await client
    .from(NAVER_TREND_CACHE_TABLE)
    .select("as_of, growth, trend_score")
    .eq("keyword", keyword)
    .eq("cache_date", cacheDate)
    .limit(1);

  if (error) {
    const sanitized = new Error(`Supabase 캐시 조회 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_query_failed";
    throw sanitized;
  }

  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

async function saveCacheResult(client, keyword, cacheDate, asOf, growth, trendScore) {
  const { error } = await client.from(NAVER_TREND_CACHE_TABLE).upsert(
    {
      keyword,
      cache_date: cacheDate,
      as_of: asOf,
      growth,
      trend_score: trendScore,
    },
    { onConflict: "keyword,cache_date" }
  );

  if (error) {
    const sanitized = new Error(`Supabase 캐시 저장 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_save_failed";
    throw sanitized;
  }
}

/**
 * keyword의 네이버 검색어트렌드 성장률/Trend Score를 반환합니다. 이 함수는
 * 절대 throw하지 않습니다(graceful failure) - 네이버 API 호출이 실패해도
 * { keyword, error, growth: null, trendScore: null }을 반환해 호출부(route)가
 * 항상 HTTP 200으로 응답할 수 있게 합니다. 상세 에러는 서버 로그에만
 * 남기고, 자격증명 값은 toSanitizedNaverError()를 거쳐 절대 포함되지
 * 않습니다.
 *
 * 캐시 우선 조회 -> 없으면 실시간 계산 -> 계산 성공 시 캐시 저장(실패해도
 * 응답에는 영향 없음, 로그만) 순서로 동작합니다.
 *
 * @param {string} query
 * @returns {Promise<{keyword:string, asOf:string|null, requestedAt:string, growth:Object|null, trendScore:Object|null, cached:boolean, error?:string}>}
 */
export async function getNaverTrendGrowth(query) {
  if (!query || typeof query !== "string" || !query.trim()) {
    const error = new Error("keyword가 필요합니다.");
    error.code = "naver_trend_growth_invalid_query";
    throw error;
  }

  const keyword = query.trim();
  const requestedAt = formatDate(new Date());

  if (isSupabaseConfigured()) {
    try {
      const client = getSupabaseClient();
      const cached = await getCachedResult(client, keyword, requestedAt);
      if (cached) {
        return {
          keyword,
          asOf: cached.as_of,
          requestedAt,
          growth: cached.growth,
          trendScore: cached.trend_score,
          cached: true,
        };
      }
    } catch (cacheError) {
      console.error("Naver trend cache 조회 실패(실시간 계산으로 계속 진행):", cacheError.message);
    }
  }

  let data;
  try {
    data = await fetchNaverTrendData(keyword);
  } catch (fetchError) {
    console.error("Naver API HUB 호출 실패(응답은 graceful하게 처리됨):", fetchError.message);
    return {
      keyword,
      error: "naver_api_unavailable",
      growth: null,
      trendScore: null,
      cached: false,
    };
  }

  let asOf = null;
  let growth;

  if (data.length === 0) {
    growth = buildAllInsufficientGrowth();
  } else {
    const latest = data[data.length - 1];
    asOf = latest.period;
    growth = computeGrowthFromData(data, asOf, latest.ratio);
  }

  const trendScore = calculateTrendScore(growth);

  if (isSupabaseConfigured()) {
    try {
      const client = getSupabaseClient();
      await saveCacheResult(client, keyword, requestedAt, asOf, growth, trendScore);
    } catch (saveError) {
      console.error("Naver trend cache 저장 실패(응답에는 영향 없음):", saveError.message);
    }
  }

  return { keyword, asOf, requestedAt, growth, trendScore, cached: false };
}
