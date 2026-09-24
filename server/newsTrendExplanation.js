// 5-1단계: 뉴스 trendScore/growth를 바탕으로 AI가 짧은 설명을 생성하고,
// news_daily_trends의 explanation_* 컬럼에 (keyword, collected_date)당
// 하루 1회만 캐싱합니다. server/youtubeTrendExplanation.js와 동일한
// 구조(캐시 히트 판정, insufficient_data 조기 반환, Supabase/Gemini
// 미설정 처리, graceful failure)를 따르되, Gemini 호출 자체는
// server/explanationEngine.js(EXPLANATION_MODEL/EXPLANATION_RESPONSE_SCHEMA를
// youtubeTrendExplanation.js에서 그대로 재사용)에 위임합니다.
//
// newsTrendGrowth.js/newsDailyTrend.js의 로직은 이 파일에서 전혀 수정하지
// 않았습니다 - 이 파일은 그 결과값을 입력으로만 받는 별도 모듈입니다.
import { getSupabaseClient, isSupabaseConfigured } from "./supabase.js";
import { NEWS_DAILY_TRENDS_TABLE } from "./newsDailyTrend.js";
import { callGeminiExplanation, isGeminiConfigured, FIXED_INSUFFICIENT_EXPLANATION } from "./explanationEngine.js";

const GROWTH_PERIODS = ["3d", "7d", "30d"];

function buildSystemPrompt() {
  return [
    "당신은 뉴스 언급량 트렌드 데이터를 한국어로 짧게 설명하는 어시스턴트입니다.",
    "level은 트렌드 추세(급상승/상승/보합/하락/급하락)를 반영해서 판단하고, text는 1~2문장의 한국어 설명으로 작성하세요.",
  ].join("\n");
}

/**
 * 뉴스의 capped는 YouTube의 "조회수 제한"과 의미가 다릅니다(3-1단계
 * 재조사로 확정된 정의) - 원본 Google News RSS 응답 총 건수가 관측
 * 상한(약 100건) 근처거나 그 이상이라 실제 언급 건수를 정확히 다 세지
 * 못했을 수 있다는 뜻입니다(즉 mention_count가 실제보다 적게 집계됐을
 * 가능성). 이 의미를 프롬프트에 정확히 반영합니다 - YouTube 프롬프트의
 * "조회수 제한으로 신뢰도가 낮다" 문구를 그대로 재사용하지 않습니다.
 * @param {{keyword:string, today:{mention_count:number}, growth:Object}} params
 * @returns {string}
 */
function buildUserPrompt({ keyword, today, growth }) {
  const lines = [`keyword: ${keyword}`, `오늘 mention_count: ${today.mention_count}`, "", "기간별 상승률(growth):"];

  for (const period of GROWTH_PERIODS) {
    const g = growth[period];
    lines.push(`- ${period}: rate=${g.rate === null ? "없음" : `${g.rate}%`}, dataQuality=${g.dataQuality}`);
  }

  const hasUnreliable = GROWTH_PERIODS.some((period) => growth[period].dataQuality === "unreliable");
  if (hasUnreliable) {
    lines.push(
      "",
      "일부 구간은 원본 뉴스 응답 건수가 많아(capped) 실제 언급량을 정확히 다 세지 못했을 수 있습니다(집계된 값이 실제보다 적을 가능성). 이 사실을 설명(text)에 반드시 반영하세요(예: 실제 언급량은 더 많을 수 있음을 언급)."
    );
  }

  lines.push("", "위 데이터를 바탕으로 이 키워드의 트렌드 추세를 판단하고, 지정된 JSON 형식으로만 응답하세요.");

  return lines.join("\n");
}

async function fetchCachedExplanation(client, keyword, collectedDate) {
  const { data, error } = await client
    .from(NEWS_DAILY_TRENDS_TABLE)
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
    .from(NEWS_DAILY_TRENDS_TABLE)
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
 * youtubeTrendExplanation.js의 getOrCreateExplanation()과 동일한 시그니처
 * 패턴입니다. 절대 throw하지 않습니다(graceful failure).
 *
 * @param {{keyword:string, collectedDate:string, today:Object, growth:Object, trendScore:Object}} params
 * @returns {Promise<{explanation: {level:string, text:string, cached:boolean}|null, error: string|null}>}
 */
export async function getOrCreateNewsExplanation({ keyword, collectedDate, today, growth, trendScore }) {
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

  const generated = await callGeminiExplanation({
    systemPrompt: buildSystemPrompt(),
    userPrompt: buildUserPrompt({ keyword, today, growth }),
  });

  if (generated.error) {
    return { explanation: null, error: generated.error };
  }

  try {
    await saveExplanation(supabase, keyword, collectedDate, generated);
  } catch (error) {
    return {
      explanation: { ...generated, cached: false },
      error: `DB 저장 실패(이번 응답에는 정상 포함됨): ${error.message}`,
    };
  }

  return { explanation: { ...generated, cached: false }, error: null };
}
