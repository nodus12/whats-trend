import axios from "axios";

const YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";

/**
 * YOUTUBE_API_KEY가 환경변수에 설정되어 있는지 확인합니다.
 * @returns {boolean}
 */
export function isYoutubeConfigured() {
  return Boolean(process.env.YOUTUBE_API_KEY);
}

/**
 * axios 에러에서 요청 설정(쿼리 파라미터에 포함된 API 키 등)을 걷어내고,
 * 상태 코드/메시지만 담은 안전한 Error를 만듭니다. axios 에러 객체를 그대로
 * 전파하면 error.config.params에 API 키가 그대로 남아 로그 등으로 유출될
 * 수 있기 때문입니다.
 * @param {*} error
 * @returns {Error & {statusCode: number|null, code: string}}
 */
function toSanitizedYoutubeError(error) {
  const statusCode =
    error && error.response && typeof error.response.status === "number" ? error.response.status : null;

  const isTimeout = error?.code === "ECONNABORTED";

  const sanitized = new Error(
    isTimeout
      ? "YouTube Data API 요청 시간 초과(timeout)"
      : statusCode
        ? `YouTube Data API 요청 실패 (status ${statusCode})`
        : `YouTube Data API 요청 실패: ${error?.message ?? "unknown_error"}`
  );
  sanitized.statusCode = statusCode;
  sanitized.code = isTimeout ? "youtube_timeout" : "youtube_request_failed";
  return sanitized;
}

const DEFAULT_MAX_RESULTS = 10;
// YouTube Data API v3 search.list 한 번의 호출에서 허용하는 최대 결과 수.
// 이 값을 넘겨받아도 여기서 clamp하여, 호출하는 쪽의 실수로 여러 페이지를
// 도는 등 quota를 불필요하게 낭비하지 않도록 합니다.
//
// quota에 대한 정확한 설명(공식 문서 기준, 20-10에서 재확인):
// https://developers.google.com/youtube/v3/determine_quota_cost 에 따르면
// "The search.list and videos.insert methods have their own quota buckets.
//  Each of these methods has a default daily limit of 100 per day."
// 즉 search.list는 프로젝트 전체 10,000 unit 풀에서 매 호출마다 100 unit씩
// 차감되는 구조가 아니라, **search.list 자신만의 별도 quota bucket**을 가지며
// 기본 일일 한도는 "하루 100회 호출"입니다. maxResults 값을 10에서 50으로
// 올려도 이 bucket 소비량(호출 1회 = 1회 차감)에는 영향이 없습니다 - 오직
// "몇 번 호출했는가"만 이 bucket을 소비시킵니다.
const MAX_ALLOWED_RESULTS = 50;

function resolveMaxResults(options) {
  const requested = typeof options?.maxResults === "number" ? options.maxResults : DEFAULT_MAX_RESULTS;
  return Math.min(Math.max(1, Math.round(requested)), MAX_ALLOWED_RESULTS);
}

/**
 * YouTube Data API v3 search.list 호출의 실제 구현입니다. 원본 응답에서
 * 영상 목록뿐 아니라 pageInfo.totalResults(이 검색어에 매칭되는 전체 결과
 * 수 - YouTube 측 추정치)도 함께 돌려줍니다. fetchYoutubeVideos()와
 * searchYoutubeVideosWithMeta() 둘 다 이 함수 하나만 사용하므로 axios 호출/
 * 에러 처리/API 키 사용 로직이 중복되지 않습니다.
 *
 * @param {string} query
 * @param {Object} [options]
 * @param {number} [options.maxResults=10]
 * @returns {Promise<{videos: Array<{videoId:string, title:string, channelTitle:string, publishedAt:string, thumbnail:string}>, totalResults: number|null}>}
 */
async function performYoutubeSearch(query, options = {}) {
  if (!query || typeof query !== "string" || !query.trim()) {
    const error = new Error("YouTube 검색에는 유효한 검색어가 필요합니다.");
    error.code = "youtube_invalid_query";
    throw error;
  }

  if (!isYoutubeConfigured()) {
    const error = new Error("YOUTUBE_API_KEY가 설정되지 않았습니다.");
    error.code = "youtube_not_configured";
    throw error;
  }

  let response;
  try {
    response = await axios.get(YOUTUBE_SEARCH_URL, {
      params: {
        part: "snippet",
        q: query.trim(),
        type: "video",
        maxResults: resolveMaxResults(options),
        order: "date",
        regionCode: "KR",
        relevanceLanguage: "ko",
        key: process.env.YOUTUBE_API_KEY,
      },
      timeout: 10000,
    });
  } catch (error) {
    throw toSanitizedYoutubeError(error);
  }

  const items = Array.isArray(response.data?.items) ? response.data.items : [];

  const videos = items.map((item) => ({
    videoId: item?.id?.videoId ?? "",
    title: item?.snippet?.title ?? "",
    channelTitle: item?.snippet?.channelTitle ?? "",
    publishedAt: item?.snippet?.publishedAt ?? "",
    thumbnail:
      item?.snippet?.thumbnails?.high?.url ?? item?.snippet?.thumbnails?.default?.url ?? "",
  }));

  const totalResults =
    typeof response.data?.pageInfo?.totalResults === "number" ? response.data.pageInfo.totalResults : null;

  return { videos, totalResults };
}

/**
 * YouTube Data API v3 search.list를 호출해 한국 최신 영상 목록을 가져옵니다.
 * API 키는 .env의 YOUTUBE_API_KEY만 사용하며, 코드에 하드코딩하지 않습니다.
 *
 * 기존 /api/youtube/search(20-8)는 이 함수를 옵션 없이 그대로 호출하므로
 * maxResults 기본값(10)과 반환 형태(영상 배열)가 20-9/20-10 이후에도 완전히
 * 동일하게 유지됩니다 - 이 함수의 시그니처/반환 타입은 바뀌지 않았습니다.
 *
 * @param {string} query - 검색어
 * @param {Object} [options]
 * @param {number} [options.maxResults=10] - 1~50 사이로 clamp됨
 * @returns {Promise<Array<{videoId:string, title:string, channelTitle:string, publishedAt:string, thumbnail:string}>>}
 */
export async function fetchYoutubeVideos(query, options = {}) {
  const { videos } = await performYoutubeSearch(query, options);
  return videos;
}

/**
 * fetchYoutubeVideos()와 동일한 요청을 보내지만, YouTube가 함께 돌려주는
 * pageInfo.totalResults(이 검색어에 매칭되는 전체 결과 수 추정치)도 같이
 * 반환합니다. youtubeTrend.js(20-10)가 "이번 페이지(최대 50개)에 실제
 * 전체 결과가 다 담겼는지"를 판단(=capped 여부)하는 데 사용합니다.
 * API 호출은 fetchYoutubeVideos()와 동일하게 1회만 발생합니다 - 이 함수를
 * 별도로 호출한다고 quota가 추가로 소모되지 않습니다.
 *
 * @param {string} query
 * @param {Object} [options]
 * @param {number} [options.maxResults=10]
 * @returns {Promise<{videos: Array<{videoId:string, title:string, channelTitle:string, publishedAt:string, thumbnail:string}>, totalResults: number|null}>}
 */
export async function searchYoutubeVideosWithMeta(query, options = {}) {
  return performYoutubeSearch(query, options);
}
