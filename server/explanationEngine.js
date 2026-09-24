// 5-1단계: news/naver/composite 설명 생성이 공유하는 범용 Gemini 호출 엔진.
//
// youtubeTrendExplanation.js의 callGeminiForExplanation()과 동일한 방식
// (동일 EXPLANATION_MODEL/EXPLANATION_RESPONSE_SCHEMA, 동일 rate limit vs
// 기타 에러 분류)으로 작성했습니다. 다만 그 파일 자체는 전혀 수정하지
// 않고(EXPLANATION_MODEL/EXPLANATION_RESPONSE_SCHEMA에 export만 추가 -
// 재정의 금지 지시사항 때문에 이 두 값만 그대로 import해서 재사용합니다),
// 캐시 조회/저장·level enum 검증 같은 작은 헬퍼는 이 프로젝트의 기존
// 관례(예: subtractUtcDays를 newsTrendGrowth.js/naverTrendGrowth.js가
// 각자 독립적으로 두는 것)를 따라 이 파일에 독립적으로 새로 작성했습니다.
import { getGeminiClient, isGeminiConfigured } from "./geminiClient.js";
import { ApiError } from "@google/genai";
import { EXPLANATION_MODEL, EXPLANATION_RESPONSE_SCHEMA } from "./youtubeTrendExplanation.js";

export { isGeminiConfigured };

// youtubeTrendExplanation.js의 FIXED_INSUFFICIENT_EXPLANATION과 동일한 값을
// news/naver/composite 3개 모듈이 공유합니다(여기서 한 번만 정의).
export const FIXED_INSUFFICIENT_EXPLANATION = {
  level: "insufficient_data",
  text: "데이터가 아직 충분하지 않습니다.",
};

const VALID_LEVELS = ["strong_up", "up", "flat", "down", "strong_down"];

/**
 * Claude/Gemini 응답 텍스트를 파싱합니다. 마크다운 코드펜스를 방어적으로
 * 제거한 뒤 JSON.parse하고, level/text 유효성을 검증합니다.
 * youtubeTrendExplanation.js의 parseExplanationResponse()와 동일한 로직입니다.
 * @param {string} rawText
 * @returns {{level:string, text:string}}
 */
function parseExplanationResponse(rawText) {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  const parsed = JSON.parse(cleaned);

  if (typeof parsed.level !== "string" || !VALID_LEVELS.includes(parsed.level)) {
    throw new Error(`유효하지 않은 level 값: ${JSON.stringify(parsed.level)}`);
  }

  if (typeof parsed.text !== "string" || !parsed.text.trim()) {
    throw new Error("text 값이 비어있음");
  }

  return { level: parsed.level, text: parsed.text.trim() };
}

/**
 * Gemini 호출 실패를 rate limit(429)과 그 외로 구분한 사람이 읽을 수 있는
 * 메시지로 만듭니다. youtubeTrendExplanation.js의 서버 라우트가 하던
 * "reason 분류"를 엔진 안으로 옮겨서, news/naver/composite 3개 모듈이
 * 각자 분류 로직을 반복하지 않게 합니다.
 * @param {*} error
 * @returns {string}
 */
function formatGeminiErrorMessage(error) {
  const isRateLimit = error instanceof ApiError && error.status === 429;
  const reason = isRateLimit ? "rate limit" : "기타";
  return `Gemini 호출 실패(${reason}): ${error?.message ?? "unknown_error"}`;
}

/**
 * 범용 Gemini 설명 생성 함수. youtubeTrendExplanation.js의
 * callGeminiForExplanation()과 동일한 요청 형태(EXPLANATION_MODEL,
 * responseMimeType: "application/json", EXPLANATION_RESPONSE_SCHEMA)를
 * 쓰지만, systemPrompt/userPrompt를 호출부가 직접 만들어서 넘기므로
 * YouTube 전용 프롬프트 빌더에 의존하지 않습니다 - news/naver/composite가
 * 각자 자신에게 맞는 프롬프트를 만들어 이 함수 하나만 공유합니다.
 *
 * 절대 throw하지 않습니다 - 성공하면 {level, text}, 실패하면 {error}를
 * 반환합니다(호출부가 별도 try/catch 없이 바로 분기할 수 있도록).
 *
 * @param {{systemPrompt:string, userPrompt:string}} params
 * @returns {Promise<{level:string, text:string}|{error:string}>}
 */
export async function callGeminiExplanation({ systemPrompt, userPrompt }) {
  const client = getGeminiClient();

  let response;
  try {
    response = await client.models.generateContent({
      model: EXPLANATION_MODEL,
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        responseSchema: EXPLANATION_RESPONSE_SCHEMA,
      },
    });
  } catch (error) {
    return { error: formatGeminiErrorMessage(error) };
  }

  if (typeof response.text !== "string" || !response.text.trim()) {
    return { error: "Gemini 응답에 text가 없음" };
  }

  try {
    return parseExplanationResponse(response.text);
  } catch (parseError) {
    return { error: parseError.message };
  }
}
