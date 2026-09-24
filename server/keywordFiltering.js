// 19-7: Noise Filtering & Keyword Quality
//
// 19-6 Keyword Candidate를 입력으로 받아 "좋은 트렌드 후보가 될 수 있는
// 형태로 데이터를 정리"합니다. 이 파일은 트렌드 여부를 최종 판단하지
// 않습니다(19-8의 Multi-Signal Trend Engine의 몫) - 오직 문자열 품질과
// 명백한 노이즈만 다룹니다.
//
// 핵심 원칙: 높은 recall + 안전한 noise removal.
// 트렌드 발견 서비스에서 과도한 filtering은 초기 트렌드를 놓치는 원인이
// 되므로, 애매한 후보를 무조건 삭제하지 않습니다.
//
// explicit(Naver DataLab, Google Trends 등 이미 keyword가 주어진 소스)은
// 원문을 최대한 보존합니다 - 길이/불용어 기반 검사를 적용하지 않습니다.
// text(News, Threads 등)에서 추출된 candidate에만 이 검사들을 적용합니다.
// source 이름을 하드코딩해서 분기하지 않고 candidate.extractionType으로
// 일반화했습니다 - 향후 새 explicit/text 소스가 추가돼도 그대로 적용됩니다.
import { normalizeKeyword, toKeywordCandidates, dedupeKeywordCandidates } from "./keywordExtraction.js";
import { tokenizeTitleTokens, isStopWord } from "./trendAggregator.js";

// 복합 키워드(phrase) 후보 하나의 최대 길이. 이보다 길면 "문장 전체가
// 하나의 keyword가 되는" 상황을 방지하기 위한 안전장치입니다(2개 토큰을
// 조합하는 구조상 실제로 이 한도에 걸리는 경우는 드뭅니다).
const MAX_PHRASE_LENGTH = 20;

const URL_OR_EMAIL_PATTERN = /^(https?:\/\/|www\.)|^[\w.-]+@[\w.-]+\.\w+$/i;
const PURE_NUMBER_PATTERN = /^\d+([.,]\d+)?$/;

/**
 * 인접한 두 토큰으로 복합 키워드(phrase) 후보를 만듭니다.
 * tokens는 tokenizeTitleTokens()의 결과(조사 제거 O, 불용어 제거 X, 원래
 * 순서 유지)를 그대로 사용합니다 - 불용어가 이미 제거된 배열로 만들면
 * 원래 텍스트에서 떨어져 있던 단어끼리 우연히 붙어버릴 수 있기 때문입니다
 * (예: "성심당 오늘 빵"에서 "오늘"을 먼저 지우면 "성심당 빵"이 실제로는
 *  인접하지 않았는데도 인접한 것처럼 조합될 수 있음).
 *
 * @param {Array<string>} tokens
 * @returns {Array<string>}
 */
function buildBigramPhrases(tokens) {
  const phrases = [];

  for (let i = 0; i < tokens.length - 1; i++) {
    const first = tokens[i];
    const second = tokens[i + 1];

    // 둘 중 하나라도 불용어면 의미 있는 조합이 아니므로 만들지 않습니다.
    if (isStopWord(first) || isStopWord(second)) {
      continue;
    }

    const phrase = `${first} ${second}`;

    if (phrase.length > MAX_PHRASE_LENGTH) {
      continue;
    }

    phrases.push(phrase);
  }

  return phrases;
}

/**
 * text 기반 Signal(News/Threads 등)에서 2개 연속 토큰으로 이루어진 복합
 * 키워드 후보("두바이 초콜릿" 등)를 생성합니다. 단어 3개 이상을 조합하는
 * n-gram이나 모든 조합을 만드는 방식은 노이즈 폭발을 일으키므로 시도하지
 * 않고, 바로 인접한 2-토큰 조합만 보수적으로 생성합니다.
 *
 * @param {Array<Object>} signals
 * @returns {Array<import('./keywordExtraction.js').KeywordCandidate>}
 */
export function generatePhraseCandidates(signals) {
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

      const tokens = tokenizeTitleTokens(signal.text);
      const phrases = buildBigramPhrases(tokens);

      for (const phrase of phrases) {
        const keyword = normalizeKeyword(phrase);
        if (!keyword) {
          continue;
        }

        candidates.push({
          keyword,
          source: signal.source,
          sourceType: signal.sourceType,
          extractionType: "text",
          value: typeof signal.value === "number" && Number.isFinite(signal.value) ? signal.value : null,
          collectedAt: signal.collectedAt,
        });
      }
    } catch (error) {
      console.error("[KeywordFiltering] phrase 생성 중 오류:", error?.message ?? error);
    }
  }

  return candidates;
}

/**
 * 하나의 Keyword Candidate를 분석해 "트렌드 후보로 사용할 만한 문자열
 * 품질인가?"를 판단합니다. 트렌드 점수(인기도/성장률)와는 무관하며,
 * 오직 문자열 자체의 품질만 봅니다.
 *
 * @param {Object} candidate
 * @returns {{accepted: boolean, qualityScore: number, reasons: Array<string>|null}}
 */
export function analyzeKeywordCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return { accepted: false, qualityScore: 0, reasons: ["invalid_candidate"] };
  }

  const keyword = typeof candidate.keyword === "string" ? candidate.keyword : "";
  const isExplicit = candidate.extractionType === "explicit";
  const reasons = [];

  if (keyword.trim().length === 0) {
    reasons.push("empty");
  }

  const hasHangul = /[가-힣]/.test(keyword);
  const hasLatin = /[a-zA-Z]/.test(keyword);
  const hasDigit = /[0-9]/.test(keyword);

  if (keyword.length > 0 && !hasHangul && !hasLatin && !hasDigit) {
    reasons.push("special_chars_only");
  }

  if (PURE_NUMBER_PATTERN.test(keyword)) {
    reasons.push("pure_number");
  }

  if (URL_OR_EMAIL_PATTERN.test(keyword)) {
    reasons.push("url_or_email");
  }

  // explicit(Naver DataLab/Google Trends 등)은 원문을 최대한 보존합니다.
  // 길이/불용어 기반 검사는 text(News/Threads 등)에서 추출된 candidate에만 적용합니다.
  if (!isExplicit) {
    if (keyword.length === 1) {
      reasons.push("too_short");
    }

    if (keyword.length > MAX_PHRASE_LENGTH) {
      reasons.push("too_long");
    }

    if (isStopWord(keyword)) {
      reasons.push("stop_word");
    }
  }

  let qualityScore = 60;

  if (reasons.length === 0) {
    if (keyword.length >= 2 && keyword.length <= 10) {
      qualityScore += 15;
    }
    if (isExplicit) {
      qualityScore += 10;
    }
    if (hasHangul && (hasDigit || hasLatin)) {
      qualityScore += 10; // "아이폰 17", "갤럭시 S26" 같은 정상적인 한글+영문/숫자 조합
    }
    if (keyword.includes(" ")) {
      qualityScore += 5; // 복합 키워드 보너스
    }
  } else {
    const penalties = {
      empty: 60,
      special_chars_only: 40,
      pure_number: 40,
      url_or_email: 25,
      too_long: 15,
      too_short: 20,
      stop_word: 30,
    };

    for (const reason of reasons) {
      qualityScore -= penalties[reason] ?? 20;
    }
  }

  qualityScore = Math.max(0, Math.min(100, Math.round(qualityScore)));

  return {
    accepted: reasons.length === 0,
    qualityScore,
    reasons: reasons.length > 0 ? reasons : null,
  };
}

/**
 * candidate 배열을 분석해 accepted/rejected로 나눕니다. accepted 항목에는
 * qualityScore가 추가되고, 기존 필드(keyword/source/sourceType/
 * extractionType/value/collectedAt)는 그대로 유지됩니다.
 *
 * @param {Array<Object>} candidates
 * @returns {{accepted: Array<Object>, rejected: Array<{candidate: Object, reasons: Array<string>}>}}
 */
export function analyzeKeywordCandidates(candidates) {
  const accepted = [];
  const rejected = [];

  if (!Array.isArray(candidates)) {
    return { accepted, rejected };
  }

  for (const candidate of candidates) {
    try {
      const analysis = analyzeKeywordCandidate(candidate);

      if (analysis.accepted) {
        accepted.push({ ...candidate, qualityScore: analysis.qualityScore });
      } else {
        rejected.push({ candidate, reasons: analysis.reasons });
      }
    } catch (error) {
      console.error("[KeywordFiltering] candidate 분석 중 오류:", error?.message ?? error);
    }
  }

  return { accepted, rejected };
}

/**
 * candidate 배열 중 accepted(품질 검사를 통과한) candidate만 반환합니다.
 * 각 candidate에는 qualityScore 필드가 추가됩니다.
 *
 * @param {Array<Object>} candidates
 * @returns {Array<Object>}
 */
export function filterKeywordCandidates(candidates) {
  return analyzeKeywordCandidates(candidates).accepted;
}

/**
 * RAW SIGNAL -> 19-6 Keyword Candidate -> 19-7 Noise Filtering까지 한 번에
 * 실행하는 편의 함수입니다. 단일 단어 candidate(explicit + text)에 text
 * 기반 복합 키워드(phrase) candidate를 더한 뒤, source가 다르면 절대
 * merge하지 않는 기존 dedupe 규칙을 적용하고, 마지막으로 품질 필터링합니다.
 *
 * @param {Array<Object>} signals
 * @returns {Array<Object>} CLEAN KEYWORD CANDIDATE 배열
 */
export function toCleanKeywordCandidates(signals) {
  const baseCandidates = toKeywordCandidates(signals);
  const phraseCandidates = generatePhraseCandidates(signals);
  const merged = dedupeKeywordCandidates([...baseCandidates, ...phraseCandidates]);
  return filterKeywordCandidates(merged);
}
