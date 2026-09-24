// 19-6: Multi-Source Keyword Extraction
//
// 서로 다른 형태의 Signal(News/Naver DataLab/Google Trends/Threads 등)을
// 19-7 Noise Filtering이 공통으로 다룰 수 있는 "Keyword Candidate" 구조로
// 변환하는 계층입니다. 이 파일은 RAW SIGNAL -> KEYWORD CANDIDATE 까지만
// 담당하며, 노이즈 제거/품질 점수/트렌드 판정/소스 결합은 하지 않습니다
// (각각 19-7/19-8의 책임입니다).
//
// 핵심 원칙: 모든 Signal을 하나의 tokenizer에 넣지 않습니다.
// - Naver DataLab/Google Trends처럼 이미 keyword가 주어진 Signal(explicit)은
//   그 keyword를 원형 그대로 candidate로 사용합니다(단어 단위로 쪼개지 않음).
// - News/Threads처럼 keyword 없이 text만 있는 Signal(text)만 기존
//   trendAggregator.tokenizeTitle()을 재사용해 단어 단위 후보를 추출합니다.
//
// News를 이 계층에 연결하려면 server/collectors/newsCollector.js의
// toTrendSignals(articles)로 먼저 {text: article.title, ...} 형태의 공통
// Signal로 바꾼 뒤 이 파일의 함수에 전달합니다 - newsCollector/trendAggregator/
// trendMonitor의 기존 동작은 이 단계에서 전혀 바꾸지 않았습니다(이 파일은
// 아직 어떤 실행 경로에도 연결되지 않은 독립 계층입니다).
import { tokenizeTitle } from "./trendAggregator.js";

/**
 * @typedef {Object} KeywordCandidate
 * @property {string} keyword
 * @property {string} source
 * @property {string} sourceType
 * @property {"explicit"|"text"} extractionType
 * @property {number|null} value
 * @property {number} collectedAt
 */

/**
 * 키워드 문자열에 대해 "안전한 최소 normalization"만 적용합니다.
 * 앞뒤 공백 제거, Unicode 정규화(NFC), 연속 공백을 한 칸으로 정리만 하며,
 * 대소문자 통일이나 특수문자 제거는 하지 않습니다 - "아이폰 17 Pro" 같은
 * 키워드가 "아이폰"으로 손상되는 것을 방지하기 위함입니다.
 *
 * @param {*} keyword
 * @returns {string|null} 정규화된 키워드, 사용할 수 없으면 null
 */
export function normalizeKeyword(keyword) {
  if (typeof keyword !== "string") {
    return null;
  }

  const normalized = keyword.normalize("NFC").trim().replace(/\s+/g, " ");

  return normalized.length > 0 ? normalized : null;
}

function normalizeValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildCandidate(keyword, signal, extractionType) {
  return {
    keyword,
    source: signal.source,
    sourceType: signal.sourceType,
    extractionType,
    value: normalizeValue(signal.value),
    collectedAt: signal.collectedAt,
  };
}

/**
 * 이미 keyword가 제공되는 Signal(예: Naver DataLab, Google Trends)을
 * Keyword Candidate로 변환합니다. keyword는 원래 단위 그대로 유지하며
 * (형태소 분리/토큰화하지 않음), source/sourceType/value/collectedAt은
 * 입력 Signal 값을 그대로 보존합니다.
 *
 * @param {Array<Object>} signals
 * @returns {Array<KeywordCandidate>}
 */
export function extractExplicitKeywords(signals) {
  if (!Array.isArray(signals)) {
    return [];
  }

  const candidates = [];

  for (const signal of signals) {
    try {
      if (!signal || typeof signal !== "object") {
        continue;
      }

      const keyword = normalizeKeyword(signal.keyword);
      if (!keyword) {
        continue;
      }

      candidates.push(buildCandidate(keyword, signal, "explicit"));
    } catch (error) {
      // 개별 signal 처리 중 예기치 못한 오류가 나도 나머지 signal 처리는 계속합니다.
      console.error("[KeywordExtraction] explicit 추출 중 오류:", error?.message ?? error);
    }
  }

  return candidates;
}

/**
 * text 필드를 가진 Signal(예: News, Threads)에서 단어 단위 키워드 후보를
 * 추출합니다. 기존 trendAggregator.tokenizeTitle()을 그대로 재사용하며,
 * 새로운 토큰화/구문 추출 알고리즘을 만들지 않습니다 - 정교한 노이즈 제거
 * (불용어 대량 제거, 품질 점수 등)는 19-7의 책임입니다.
 *
 * @param {Array<Object>} signals
 * @returns {Array<KeywordCandidate>}
 */
export function extractTextKeywords(signals) {
  if (!Array.isArray(signals)) {
    return [];
  }

  const candidates = [];

  for (const signal of signals) {
    try {
      if (!signal || typeof signal !== "object") {
        continue;
      }

      if (typeof signal.text !== "string" || signal.text.trim().length === 0) {
        continue;
      }

      // 같은 텍스트 안에서 같은 단어가 반복되는 것은 한 번만 후보로 남깁니다
      // (기존 trendAggregator.aggregateTrends()가 article.title에 대해
      //  new Set(tokenizeTitle(...))로 처리하는 것과 동일한 방식).
      const tokens = new Set(tokenizeTitle(signal.text));

      for (const token of tokens) {
        const keyword = normalizeKeyword(token);
        if (!keyword) {
          continue;
        }

        candidates.push(buildCandidate(keyword, signal, "text"));
      }
    } catch (error) {
      console.error("[KeywordExtraction] text 추출 중 오류:", error?.message ?? error);
    }
  }

  return candidates;
}

/**
 * 서로 다른 소스의 Signal 배열을 받아, 각 Signal의 형태(keyword 유무)에 따라
 * explicit/text 추출을 자동으로 나누어 적용한 뒤 하나의 Keyword Candidate
 * 배열로 합쳐 반환합니다. keyword와 text가 모두 없는 Signal은 후보를 만들
 * 수 없으므로 조용히 건너뜁니다(오류 아님).
 *
 * @param {Array<Object>} signals
 * @returns {Array<KeywordCandidate>}
 */
export function toKeywordCandidates(signals) {
  if (!Array.isArray(signals)) {
    return [];
  }

  const explicitSignals = [];
  const textSignals = [];

  for (const signal of signals) {
    if (!signal || typeof signal !== "object") {
      continue;
    }

    if (typeof signal.keyword === "string" && signal.keyword.trim().length > 0) {
      explicitSignals.push(signal);
    } else if (typeof signal.text === "string" && signal.text.trim().length > 0) {
      textSignals.push(signal);
    }
  }

  return [...extractExplicitKeywords(explicitSignals), ...extractTextKeywords(textSignals)];
}

function buildDedupeKey(candidate) {
  return `${candidate.source}:${candidate.sourceType}:${candidate.keyword}:${candidate.collectedAt}`;
}

/**
 * 완전히 동일한(source + sourceType + keyword + collectedAt) candidate만
 * 중복 제거합니다. source가 다르면 같은 keyword라도 절대 하나로 합치지
 * 않습니다(News의 "두바이 초콜릿"과 Naver DataLab의 "두바이 초콜릿"은
 * 서로 다른 신호이므로 별도로 유지되어야 합니다).
 *
 * @param {Array<KeywordCandidate>} candidates
 * @returns {Array<KeywordCandidate>}
 */
export function dedupeKeywordCandidates(candidates) {
  if (!Array.isArray(candidates)) {
    return [];
  }

  const seen = new Set();
  const result = [];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const key = buildDedupeKey(candidate);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(candidate);
  }

  return result;
}
