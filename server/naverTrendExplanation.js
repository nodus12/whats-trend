// 5-1단계: 네이버 trendScore/growth를 바탕으로 AI가 짧은 설명을 생성하고,
// naver_trend_cache의 explanation_* 컬럼에 (keyword, cache_date)당 하루
// 1회만 캐싱합니다. youtubeTrendExplanation.js와 동일한 구조를 따르되,
// 네이버는 capped 같은 신뢰도 저하 개념이 없으므로(naverTrendGrowth.js
// 조사에서 확인됨 - dataQuality는 ok/insufficient_data 두 가지만 존재)
// 프롬프트 분기도 그 두 가지만 다룹니다(unreliable 문구 없음).
//
// naverTrendGrowth.js의 로직은 이 파일에서 전혀 수정하지 않았습니다.
//
// 참고: getNaverTrendGrowth()의 반환값에는 YouTube/뉴스의 today.video_count/
// mention_count 같은 "오늘의 절대값"이 없습니다(asOf 날짜만 반환) - 그래서
// 이 파일의 today 파라미터는 { date: asOf } 형태만 기대하며, 프롬프트에도
// 절대값 대신 기준일(asOf)과 기간별 상승률만 사용합니다.
import { getSupabaseClient, isSupabaseConfigured } from "./supabase.js";
import { NAVER_TREND_CACHE_TABLE } from "./naverTrendGrowth.js";
import { callGeminiExplanation, isGeminiConfigured, FIXED_INSUFFICIENT_EXPLANATION } from "./explanationEngine.js";

const GROWTH_PERIODS = ["3d", "7d", "30d"];

function buildSystemPrompt() {
  return [
    "당신은 네이버 검색어트렌드 데이터를 한국어로 짧게 설명하는 어시스턴트입니다.",
    "level은 트렌드 추세(급상승/상승/보합/하락/급하락)를 반영해서 판단하고, text는 1~2문장의 한국어 설명으로 작성하세요.",
  ].join("\n");
}

/**
 * 네이버는 today.value 같은 절대 검색량이 없으므로(상대 지수라 요청마다
 * 기준이 달라짐 - naverTrendGrowth.js 참고), 기준일(asOf)과 기간별
 * 상승률만 프롬프트에 담습니다. unreliable 개념이 없어 그 문구는 아예
 * 넣지 않습니다(YouTube/뉴스 프롬프트와의 차이).
 * @param {{keyword:string, today:{date:string}, growth:Object}} params
 * @returns {string}
 */
function buildUserPrompt({ keyword, today, growth }) {
  const lines = [`keyword: ${keyword}`, `기준일(asOf): ${today.date}`, "", "기간별 상승률(growth):"];

  for (const period of GROWTH_PERIODS) {
    const g = growth[period];
    lines.push(`- ${period}: rate=${g.rate === null ? "없음" : `${g.rate}%`}, dataQuality=${g.dataQuality}`);
  }

  lines.push("", "위 데이터를 바탕으로 이 키워드의 트렌드 추세를 판단하고, 지정된 JSON 형식으로만 응답하세요.");

  return lines.join("\n");
}

async function fetchCachedExplanation(client, keyword, cacheDate) {
  const { data, error } = await client
    .from(NAVER_TREND_CACHE_TABLE)
    .select("explanation_level, explanation_text")
    .eq("keyword", keyword)
    .eq("cache_date", cacheDate)
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

async function saveExplanation(client, keyword, cacheDate, explanation) {
  const { error } = await client
    .from(NAVER_TREND_CACHE_TABLE)
    .update({
      explanation_level: explanation.level,
      explanation_text: explanation.text,
      explanation_generated_at: new Date().toISOString(),
    })
    .eq("keyword", keyword)
    .eq("cache_date", cacheDate);

  if (error) {
    const sanitized = new Error(`Supabase 캐시 저장 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_save_failed";
    throw sanitized;
  }
}

/**
 * youtubeTrendExplanation.js의 getOrCreateExplanation()과 동일한 패턴입니다.
 * 절대 throw하지 않습니다(graceful failure).
 *
 * @param {{keyword:string, cacheDate:string, today:{date:string}, growth:Object, trendScore:Object}} params
 * @returns {Promise<{explanation: {level:string, text:string, cached:boolean}|null, error: string|null}>}
 */
export async function getOrCreateNaverExplanation({ keyword, cacheDate, today, growth, trendScore }) {
  if (trendScore.dataQuality === "insufficient_data") {
    return { explanation: { ...FIXED_INSUFFICIENT_EXPLANATION, cached: false }, error: null };
  }

  if (!isSupabaseConfigured()) {
    return { explanation: null, error: "Supabase가 설정되지 않아 캐시를 조회할 수 없습니다." };
  }

  const supabase = getSupabaseClient();

  try {
    const cached = await fetchCachedExplanation(supabase, keyword, cacheDate);
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
    await saveExplanation(supabase, keyword, cacheDate, generated);
  } catch (error) {
    return {
      explanation: { ...generated, cached: false },
      error: `DB 저장 실패(이번 응답에는 정상 포함됨): ${error.message}`,
    };
  }

  return { explanation: { ...generated, cached: false }, error: null };
}
