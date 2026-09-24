// 21-2 (2-3단계 / 2-3B단계): trendScore/growth를 바탕으로 AI가 짧은 설명을
// 생성하고, youtube_daily_trends의 explanation_* 컬럼에 (keyword,
// collected_date)당 하루 1회만 캐싱합니다.
//
// 2-3B단계: AI 호출 부분만 Anthropic(Claude Haiku) -> Gemini로 교체했습니다.
// 캐시 조회(fetchCachedExplanation)/저장(saveExplanation) 로직과
// getOrCreateExplanation()의 입출력 형태는 그대로입니다.
//
// calculateYoutubeTrendGrowth()/calculateTrendScore()(youtubeTrendGrowth.js)
// 의 로직은 이 파일에서 전혀 수정하지 않았습니다 - 이 파일은 그 결과값을
// 입력으로만 받는 별도 모듈입니다.
import { getSupabaseClient, isSupabaseConfigured } from "./supabase.js";
import { getGeminiClient, isGeminiConfigured } from "./geminiClient.js";
import { ApiError, Type } from "@google/genai";

export const YOUTUBE_DAILY_TRENDS_TABLE = "youtube_daily_trends";
// 공식 모델 목록(ai.google.dev/gemini-api/docs/models, 2026-09-23 확인) 기준
// gemini-2.0-flash-lite는 공식 모델 목록에 "(Shut down)"으로 표시되어
// 제외했습니다. gemini-2.5-flash-lite는 문서 조사 시점(2026-09-23)에는
// 정상으로 보였으나, 실제 라이브 호출 결과 다음과 같은 실시간 오류를
// 반환했습니다(이 프로젝트의 API 키 기준, 신규 사용자 제한으로 추정):
//   {"error":{"code":404,"message":"This model models/gemini-2.5-flash-lite
//    is no longer available to new users. Please update your code to use
//    models/gemini-3.5-flash-lite ...","status":"NOT_FOUND"}}
// API가 직접 안내한 대체 모델(gemini-3.5-flash-lite)로 교체했습니다 -
// 이 실시간 응답이 사전 문서 조사보다 더 신뢰할 수 있는 근거입니다.
const EXPLANATION_MODEL = "gemini-3.5-flash-lite";
const VALID_LEVELS = ["strong_up", "up", "flat", "down", "strong_down"];
const GROWTH_PERIODS = ["3d", "7d", "30d"];

// trendScore.dataQuality === "insufficient_data"일 때 AI 호출 없이
// 즉시 반환하는 고정값입니다.
const FIXED_INSUFFICIENT_EXPLANATION = {
  level: "insufficient_data",
  text: "데이터가 아직 충분하지 않습니다.",
};

function buildSystemPrompt() {
  return [
    "당신은 YouTube 트렌드 데이터를 한국어로 짧게 설명하는 어시스턴트입니다.",
    "level은 트렌드 추세(급상승/상승/보합/하락/급하락)를 반영해서 판단하고, text는 1~2문장의 한국어 설명으로 작성하세요.",
  ].join("\n");
}

// Gemini의 구조화 출력 기능(responseSchema)으로 {level, text} 형식을
// 강제합니다 - 프롬프트 지시만으로는 형식이 흔들릴 수 있어(2-3단계에서
// Claude에 대해 방어적 파싱을 추가했던 것과 동일한 우려), API 레벨에서
// 스키마를 강제하는 이 방식이 더 안정적입니다(요청 지시사항 5번).
const EXPLANATION_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    level: {
      type: Type.STRING,
      enum: VALID_LEVELS,
      description: "트렌드 추세",
    },
    text: {
      type: Type.STRING,
      description: "1~2문장의 한국어 설명",
    },
  },
  required: ["level", "text"],
};

/**
 * 프롬프트에 keyword/today.video_count/growth(3d,7d,30d의 rate,
 * dataQuality)를 반드시 포함합니다. dataQuality가 unreliable인 구간이
 * 있으면 "조회수 제한(capped)으로 신뢰도가 낮다"는 사실을 명시하고
 * 설명에 반영하도록 별도로 지시합니다.
 * @param {{keyword:string, today:{video_count:number}, growth:Object}} params
 * @returns {string}
 */
function buildUserPrompt({ keyword, today, growth }) {
  const lines = [`keyword: ${keyword}`, `오늘 video_count: ${today.video_count}`, "", "기간별 상승률(growth):"];

  for (const period of GROWTH_PERIODS) {
    const g = growth[period];
    lines.push(`- ${period}: rate=${g.rate === null ? "없음" : `${g.rate}%`}, dataQuality=${g.dataQuality}`);
  }

  const hasUnreliable = GROWTH_PERIODS.some((period) => growth[period].dataQuality === "unreliable");
  if (hasUnreliable) {
    lines.push(
      "",
      "일부 구간은 조회수 제한(capped)으로 신뢰도가 낮습니다. 이 사실을 설명(text)에 반드시 반영하세요(예: 일부 데이터가 제한적임을 언급)."
    );
  }

  lines.push("", "위 데이터를 바탕으로 이 키워드의 트렌드 추세를 판단하고, 지정된 JSON 형식으로만 응답하세요.");

  return lines.join("\n");
}

/**
 * Claude 응답 텍스트를 파싱합니다. 혹시 모를 마크다운 코드펜스를 방어적으로
 * 제거한 뒤 JSON.parse하고, level이 허용된 값인지, text가 비어있지 않은지
 * 검증합니다. 유효하지 않으면 예외를 던집니다(호출부가 graceful하게 처리).
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
 * axios/Anthropic 계열 collector들의 toSanitized*Error()와 동일한 이유로,
 * Gemini 호출 실패를 429(rate limit)와 그 외로 구분한 새 Error로 감싸서
 * 던집니다. @google/genai의 ApiError는 .status(HTTP status)를 제공합니다
 * (node_modules 타입 정의로 확인함) - 문자열 매칭이 아니라 이 필드를
 * 기준으로 판별합니다.
 * @param {*} error
 * @returns {Error & {isRateLimit: boolean}}
 */
function toSanitizedGeminiError(error) {
  const isRateLimit = error instanceof ApiError && error.status === 429;
  const sanitized = new Error(error?.message ?? "unknown_error");
  sanitized.isRateLimit = isRateLimit;
  return sanitized;
}

async function callGeminiForExplanation({ keyword, today, growth }) {
  const client = getGeminiClient();

  let response;
  try {
    response = await client.models.generateContent({
      model: EXPLANATION_MODEL,
      contents: buildUserPrompt({ keyword, today, growth }),
      config: {
        systemInstruction: buildSystemPrompt(),
        responseMimeType: "application/json",
        responseSchema: EXPLANATION_RESPONSE_SCHEMA,
      },
    });
  } catch (error) {
    throw toSanitizedGeminiError(error);
  }

  if (typeof response.text !== "string" || !response.text.trim()) {
    throw new Error("Gemini 응답에 text가 없음");
  }

  return parseExplanationResponse(response.text);
}

async function fetchCachedExplanation(client, keyword, collectedDate) {
  const { data, error } = await client
    .from(YOUTUBE_DAILY_TRENDS_TABLE)
    .select("explanation_level, explanation_text")
    .eq("keyword", keyword)
    .eq("collected_date", collectedDate)
    .limit(1);

  if (error) {
    const sanitized = new Error(`Supabase 캐시 조회 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_query_failed";
    throw sanitized;
  }

  const row = Array.isArray(data) && data.length > 0 ? data[0] : null;

  if (row && typeof row.explanation_text === "string" && row.explanation_text) {
    return { level: row.explanation_level, text: row.explanation_text };
  }

  return null;
}

async function saveExplanation(client, keyword, collectedDate, explanation) {
  const { error } = await client
    .from(YOUTUBE_DAILY_TRENDS_TABLE)
    .update({
      explanation_level: explanation.level,
      explanation_text: explanation.text,
      explanation_generated_at: new Date().toISOString(),
    })
    .eq("keyword", keyword)
    .eq("collected_date", collectedDate);

  if (error) {
    const sanitized = new Error(`Supabase 캐시 저장 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_save_failed";
    throw sanitized;
  }
}

/**
 * trendScore.dataQuality가 "insufficient_data"면 AI를 호출하지 않고
 * 고정값을 즉시 반환합니다. 그 외에는 캐시(오늘 날짜 row의
 * explanation_text)를 먼저 확인하고, 없으면 Gemini를 호출해 생성한
 * 뒤 저장합니다.
 *
 * 이 함수는 절대 throw하지 않습니다(graceful failure) - 실패 시
 * explanation: null을 반환하고, 실패 사유는 error 필드로만 전달합니다.
 * 호출부(server.js)는 이 error를 로그로만 남기고 HTTP 응답 자체는 항상
 * 정상적으로(200) 진행합니다.
 *
 * @param {{keyword:string, collectedDate:string, today:Object, growth:Object, trendScore:Object}} params
 * @returns {Promise<{explanation: {level:string, text:string, cached:boolean}|null, error: string|null}>}
 */
export async function getOrCreateExplanation({ keyword, collectedDate, today, growth, trendScore }) {
  if (trendScore.dataQuality === "insufficient_data") {
    return { explanation: { ...FIXED_INSUFFICIENT_EXPLANATION, cached: false }, error: null };
  }

  if (!isSupabaseConfigured()) {
    return { explanation: null, error: "Supabase가 설정되지 않아 캐시를 조회할 수 없습니다." };
  }

  const supabase = getSupabaseClient();

  try {
    const cached = await fetchCachedExplanation(supabase, keyword, collectedDate);
    if (cached) {
      return { explanation: { ...cached, cached: true }, error: null };
    }
  } catch (error) {
    return { explanation: null, error: `캐시 조회 실패: ${error.message}` };
  }

  if (!isGeminiConfigured()) {
    return { explanation: null, error: "GEMINI_API_KEY가 설정되지 않았습니다." };
  }

  let generated;
  try {
    generated = await callGeminiForExplanation({ keyword, today, growth });
  } catch (error) {
    // 요청 지시사항 6번: rate limit(429)과 그 외 실패를 로그에서 구분합니다
    // (무료 티어는 한도 초과 가능성이 유료보다 높아, 나중에 한도 조정
    // 판단에 참고할 수 있도록).
    const reason = error.isRateLimit ? "rate limit" : "기타";
    return { explanation: null, error: `Gemini 호출 실패(${reason}): ${error.message}` };
  }

  try {
    await saveExplanation(supabase, keyword, collectedDate, generated);
  } catch (error) {
    // DB 저장이 실패해도 이번에 생성된 설명 자체는 그대로 반환합니다
    // (API 응답은 실패시키지 않음 - 다음 호출에서 캐시가 없어 다시 생성될 뿐).
    return {
      explanation: { ...generated, cached: false },
      error: `DB 저장 실패(이번 응답에는 정상 포함됨): ${error.message}`,
    };
  }

  return { explanation: { ...generated, cached: false }, error: null };
}
