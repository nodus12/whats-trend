// 5-1단계: 종합점수(compositeScore)와 소스별 현황(sources)을 바탕으로
// AI 설명을 생성합니다. YouTube/뉴스/네이버와 달리 이 모듈 자체는 캐시
// 조회/저장을 하지 않습니다 - server/scheduler.js가 하루 1회 스케줄
// 실행 시점에만 이 함수를 호출하고, 결과를 composite_trend_snapshots에
// 직접 upsert/update하는 방식으로 "하루 1회"가 자연스럽게 보장되기
// 때문입니다(/api/trend-score 라우트는 이 함수를 전혀 호출하지 않고,
// 이미 저장된 explanation을 읽기만 합니다 - 지시사항 Part 4).
//
// compositeTrendScore.js의 로직은 이 파일에서 전혀 수정하지 않았습니다.
import { callGeminiExplanation, isGeminiConfigured, FIXED_INSUFFICIENT_EXPLANATION } from "./explanationEngine.js";

const SOURCE_LABELS = { youtube: "YouTube", news: "뉴스", naver: "네이버" };

function buildSystemPrompt() {
  return [
    "당신은 여러 소스(YouTube, 뉴스, 네이버)를 종합한 트렌드 점수를 한국어로 짧게 설명하는 어시스턴트입니다.",
    "level은 트렌드 추세(급상승/상승/보합/하락/급하락)를 반영해서 판단하고, text는 1~2문장의 한국어 설명으로 작성하세요.",
  ].join("\n");
}

/**
 * 세 소스의 available/dataQuality와 종합점수를 프롬프트에 담습니다.
 * 소스가 available:false면 그 이유(reason)를, available:true면
 * trendScore.value/dataQuality를 표시합니다.
 * @param {{keyword:string, compositeScore:Object, sources:Object}} params
 * @returns {string}
 */
function buildUserPrompt({ keyword, compositeScore, sources }) {
  const lines = [
    `keyword: ${keyword}`,
    `종합 점수: ${compositeScore.value === null ? "없음" : `${compositeScore.value}%`} (dataQuality=${compositeScore.dataQuality})`,
    "",
    "소스별 현황:",
  ];

  for (const source of ["youtube", "news", "naver"]) {
    const entry = sources[source];
    const label = SOURCE_LABELS[source];

    if (!entry || !entry.available) {
      lines.push(`- ${label}: 이용 불가(${entry?.reason ?? "알 수 없음"})`);
      continue;
    }

    const { value, dataQuality } = entry.trendScore || {};
    lines.push(`- ${label}: rate=${value === null || value === undefined ? "없음" : `${value}%`}, dataQuality=${dataQuality}`);
  }

  lines.push("", "위 데이터를 바탕으로 이 키워드의 종합 트렌드 추세를 판단하고, 지정된 JSON 형식으로만 응답하세요.");

  return lines.join("\n");
}

/**
 * compositeScore.dataQuality가 "insufficient_data"면 AI를 호출하지 않고
 * 고정값을 즉시 반환합니다. 이 함수는 캐시를 다루지 않고(호출부인
 * scheduler.js가 하루 1회만 부르는 방식으로 캐싱을 대신함), 절대 throw하지
 * 않습니다(graceful failure).
 *
 * @param {{keyword:string, compositeScore:Object, sources:Object}} params
 * @returns {Promise<{explanation: {level:string, text:string}|null, error: string|null}>}
 */
export async function generateCompositeExplanation({ keyword, compositeScore, sources }) {
  if (compositeScore.dataQuality === "insufficient_data") {
    return { explanation: { ...FIXED_INSUFFICIENT_EXPLANATION }, error: null };
  }

  if (!isGeminiConfigured()) {
    return { explanation: null, error: "GEMINI_API_KEY가 설정되지 않았습니다." };
  }

  const generated = await callGeminiExplanation({
    systemPrompt: buildSystemPrompt(),
    userPrompt: buildUserPrompt({ keyword, compositeScore, sources }),
  });

  if (generated.error) {
    return { explanation: null, error: generated.error };
  }

  return { explanation: generated, error: null };
}
