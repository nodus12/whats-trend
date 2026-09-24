// 20-1: GDELT DOC 2.0 API Collector
//
// 공식 문서 확인 결과(2026-09-18 기준, 근거는 20-1 완료 보고서 "1. GDELT 공식
// API 확인" 참고):
//   - Endpoint: https://api.gdeltproject.org/api/v2/doc/doc (GET, 인증/API Key
//     불필요 - 공식 블로그 "GDELT DOC 2.0 API Debuts!"
//     https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/ 어디에도 인증
//     방식이 언급되지 않음. 따라서 이 파일은 .env에 GDELT용 API Key를
//     추가하지 않습니다 - 불필요한 key를 만들지 말라는 지시를 따랐습니다).
//   - 이번 단계는 mode=ArtList만 사용합니다. ArtList는 공식 문서에 반환
//     필드가 명시되어 있습니다: url, url_mobile, title, seendate, socialimage,
//     domain, language, sourcecountry. (TimelineVol 등 다른 모드는 응답의
//     정확한 JSON 필드 구조가 공식 1차 문서에 명시되어 있지 않아 이번
//     단계에서는 사용하지 않습니다 - "확인 안 되면 추측 금지" 원칙)
//   - maxrecords: ArtList 기본값 75, 최대 250(공식 문서 상한).
//   - timespan: 기본 최근 3개월, 분/시간/일/주 단위 지정 가능.
//   - 상업 이용: 공식 About 페이지(https://www.gdeltproject.org/about.html)에
//     "all datasets released by the GDELT Project are available for
//     unlimited and unrestricted use for any academic, commercial, or
//     governmental use of any kind without fee"라고 명시되어 있습니다.
//   - Attribution 요구: 같은 페이지에 "any use or redistribution of the data
//     must include a citation to the GDELT Project and a link to this
//     website"라고 명시되어 있습니다. 이번 단계는 UI에 GDELT 데이터를
//     노출하지 않으므로(기존 signals[] 필드와 동일하게 API 응답에만 존재)
//     지금 당장 화면에 citation을 넣지 않았습니다 - 실제로 UI에 노출하는
//     단계가 오면 반드시 citation을 추가해야 합니다.
//   - Rate limit: 공식 블로그 문서에는 숫자로 명시돼 있지 않지만, 실제 API가
//     응답 본문으로 "Please limit requests to one every 5 seconds"라고 직접
//     안내합니다(2026-09-18 실측 확인, 소스: api.gdeltproject.org 응답 본문
//     자체). 이 collector는 collect() 호출 1회당 정확히 1회의 요청만
//     보내도록 설계했고, 상위 trendMonitor.js는 10분 주기로 한 번만 호출하는
//     구조라 이 제한을 자연히 지킵니다 - 별도의 재시도/버스트 로직을
//     추가하지 않았습니다.
//   - JSON 응답의 최상위 wrapper 키("articles" 등)는 공식 1차 문서에서
//     명시적으로 확인하지 못했습니다(3rd-party 클라이언트들이 공통적으로
//     참조하는 필드 목록은 확보했지만, wrapper 구조까지 검증된 1차 자료는
//     찾지 못했고, 실제 API 호출은 이번 세션 네트워크 환경에서 rate limit에
//     막혀 재확인하지 못했습니다). 그래서 normalizeGdeltArticles()는 여러
//     가능한 형태(최상위가 바로 배열인 경우 / raw.articles가 배열인 경우)를
//     방어적으로 모두 시도하고, 어느 쪽도 아니면 예외를 던지지 않고 빈
//     배열을 반환합니다 - 잘못 추측한 필드명 때문에 시스템이 깨지는 대신
//     "이번엔 신호 없음"으로 안전하게 넘어갑니다. 실제 서비스에 연결하기
//     전에 반드시 GDELT_LIVE=1 node verify_20_1.mjs로 실응답 구조를
//     재확인해야 합니다(아래 "무료 한도" 섹션 및 20-1 최종 보고서 참고).
import axios from "axios";

export const GDELT_SOURCE = "gdelt";
const GDELT_DOC_API_URL = "https://api.gdeltproject.org/api/v2/doc/doc";

// ArtList 결과 개수. 공식 상한은 250이지만, News collector와 비슷한 규모로
// 제한해 한 번의 collect() 호출이 만드는 후속 처리량(keyword 추출 등)을
// News와 비슷한 수준으로 맞춥니다.
const DEFAULT_MAX_RECORDS = 20;
const DEFAULT_TIMESPAN = "1d";

/**
 * axios 에러에서 요청 설정(헤더 등)을 걷어내고, 상태 코드/메시지만 담은
 * 안전한 Error를 만듭니다. GDELT는 API Key를 쓰지 않으므로 유출 위험이 있는
 * 민감정보는 없지만, naverDataLabCollector.js/googleTrendsCollector.js와
 * 동일한 패턴을 유지해 로그 형식을 일관되게 둡니다.
 * @param {*} error
 * @returns {Error & {statusCode: number|null, code: string}}
 */
function toSanitizedGdeltError(error) {
  const statusCode =
    error && error.response && typeof error.response.status === "number" ? error.response.status : null;

  const isTimeout = error?.code === "ECONNABORTED";

  const sanitized = new Error(
    isTimeout
      ? "GDELT DOC API 요청 시간 초과(timeout)"
      : statusCode
        ? `GDELT DOC API 요청 실패 (status ${statusCode})`
        : `GDELT DOC API 요청 실패: ${error?.message ?? "unknown_error"}`
  );
  sanitized.statusCode = statusCode;
  sanitized.code = isTimeout ? "gdelt_timeout" : "gdelt_request_failed";
  return sanitized;
}

/**
 * GDELT DOC 2.0 API(mode=ArtList)를 호출합니다. 인증/API Key가 필요 없는
 * 공식 공개 endpoint이므로 별도의 "설정되지 않음" 가드가 없습니다(Naver/
 * Google Trends collector와의 유일한 구조적 차이 - 이 프로젝트에는 GDELT용
 * 환경변수가 없습니다).
 *
 * @param {string} query
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=10000]
 * @param {number} [options.maxRecords=20]
 * @param {string} [options.timespan="1d"]
 * @returns {Promise<*>} GDELT 원본 JSON 응답(형태 미확정 - 방어적으로 처리해야 함)
 */
export async function fetchGdeltArticles(query, options = {}) {
  if (!query || typeof query !== "string") {
    throw new Error("GDELT 요청에는 유효한 query 문자열이 필요합니다.");
  }

  const timeout = typeof options.timeoutMs === "number" ? options.timeoutMs : 10000;
  const maxrecords = typeof options.maxRecords === "number" ? options.maxRecords : DEFAULT_MAX_RECORDS;
  const timespan = typeof options.timespan === "string" ? options.timespan : DEFAULT_TIMESPAN;

  try {
    const response = await axios.get(GDELT_DOC_API_URL, {
      params: {
        query,
        mode: "ArtList",
        format: "json",
        maxrecords,
        timespan,
      },
      timeout,
    });

    return response.data;
  } catch (error) {
    throw toSanitizedGdeltError(error);
  }
}

/**
 * GDELT ArtList 원본 응답 하나에서 기사 배열을 방어적으로 추출합니다.
 * 위 파일 상단 주석 참고 - wrapper 키가 공식 1차 문서로 확정되지 않았으므로
 * 여러 형태를 시도하고, 어느 것도 배열이 아니면 빈 배열을 반환합니다
 * (예외를 던지지 않음 - naverDataLabCollector.normalizeNaverResponse()와
 * 동일한 "형태가 다르면 조용히 건너뛴다" 정책).
 *
 * @param {*} raw
 * @returns {Array<Object>}
 */
function extractArticleList(raw) {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (raw && Array.isArray(raw.articles)) {
    return raw.articles;
  }
  return [];
}

/**
 * GDELT ArtList 원본 응답을 공통 TrendSignal 배열로 변환합니다.
 *
 * 설계 근거: GDELT ArtList는 News RSS와 마찬가지로 "이 키워드를 언급한
 * 기사 목록"을 반환합니다(공식 문서상 title/url이 기사 단위로 존재하며,
 * 기사별 수치 점수는 제공되지 않습니다). newsCollector.toTrendSignals()가
 * 기사 1건 = value 1(occurrence 1건)로 다루는 것과 정확히 같은 의미이므로,
 * GDELT도 동일하게 value: 1을 사용합니다 - GDELT가 실제로 제공하지 않는
 * 점수를 임의로 만들어내지 않기 위함입니다("value의 의미가 GDELT 실제 값과
 * 정확히 일치해야 한다"는 지시를 따름).
 *
 * sourceType: "exposure"를 사용합니다. GDELT ArtList는 전세계(65개 언어
 * 기계번역 포함) 뉴스/미디어가 이 키워드를 얼마나 다뤘는지를 나타내는
 * 매체 노출 신호이며, 이는 이미 이 프로젝트가 News에 사용 중인 "exposure"
 * 정의(매체 노출)와 정확히 같은 성격입니다. 따라서 지시받은 대로 별도
 * 보고 없이 exposure를 그대로 사용했습니다.
 *
 * keyword가 아니라 text를 채웁니다 - Naver DataLab/Google Trends처럼 이미
 * 정제된 keyword가 주어지는 소스가 아니라, News처럼 "기사 제목 원문"만
 * 주어지는 소스이기 때문입니다. 이렇게 하면 keywordExtraction.toKeywordCandidates()가
 * 자동으로 "text" 추출 경로(News와 동일한 tokenizeTitle() 기반)를 타므로,
 * keywordFiltering.js/keywordExtraction.js를 전혀 수정하지 않고 그대로
 * 재사용할 수 있습니다.
 *
 * @param {*} raw - fetchGdeltArticles()의 원본 응답
 * @param {number} [collectedAt]
 * @returns {Array<import('./signal.js').TrendSignal>}
 */
export function normalizeGdeltResponse(raw, collectedAt = Date.now()) {
  const articles = extractArticleList(raw);

  const signals = [];

  for (const article of articles) {
    if (!article || typeof article !== "object") {
      continue;
    }

    const title = typeof article.title === "string" ? article.title.trim() : "";
    if (!title) {
      continue;
    }

    signals.push({
      source: GDELT_SOURCE,
      sourceType: "exposure",
      text: title,
      url: typeof article.url === "string" ? article.url : "",
      value: 1,
      collectedAt,
    });
  }

  return signals;
}

/**
 * keyword 하나를 수집해 공통 TrendSignal 배열로 반환합니다(0개 이상).
 * naverDataLabCollector.collect()/googleTrendsCollector.collect()/
 * newsCollector.collect()와 동일하게 Collector 인터페이스
 * (collect(query) -> Promise<Array>)를 통일합니다.
 *
 * @param {string} query
 * @param {Object} [options] - fetchGdeltArticles()에 그대로 전달됩니다.
 * @returns {Promise<Array<import('./signal.js').TrendSignal>>}
 */
async function collect(query, options = {}) {
  const collectedAt = Date.now();
  const raw = await fetchGdeltArticles(query, options);
  return normalizeGdeltResponse(raw, collectedAt);
}

export const gdeltCollector = {
  source: GDELT_SOURCE,
  collect,
  fetchGdeltArticles,
  normalizeGdeltResponse,
};
