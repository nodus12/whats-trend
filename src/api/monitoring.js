// 4-2단계: 키워드 모니터링 대시보드 전용 API 호출 함수 모음.
// 기존 src/api/trends.js(GET /api/trends, 뉴스 언급량 기반 홈/탐색 화면용)는
// 전혀 건드리지 않고, 이 파일은 완전히 별도의 엔드포인트들만 다룹니다.

async function getJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);

  if (!response.ok || !data || data.success === false) {
    const message = data?.message || "요청을 처리하지 못했어요.";
    throw new Error(message);
  }

  return data;
}

export async function fetchKeywords() {
  return getJson("/api/keywords");
}

export async function addKeyword(keyword) {
  return getJson("/api/keywords", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keyword }),
  });
}

export async function deleteKeyword(id) {
  return getJson(`/api/keywords/${id}`, { method: "DELETE" });
}

export async function fetchTrendScore(keyword) {
  const response = await fetch(`/api/trend-score?q=${encodeURIComponent(keyword)}`);
  const data = await response.json().catch(() => null);

  if (!response.ok || !data) {
    throw new Error("종합 점수를 불러오지 못했어요.");
  }

  // /api/trend-score는 이 엔드포인트 자체가 실패하지 않는 설계라
  // success 필드가 없습니다(compositeTrendScore.js 참고) - 위 getJson()과
  // 달리 success 체크를 하지 않습니다.
  return data;
}

// 5-1단계: 소스별 카드에 AI 설명(explanation)을 표시하기 위해 개별
// trend-growth 엔드포인트도 호출합니다. /api/trend-score(compositeTrendScore.js)는
// 내부적으로 이 라우트들을 거치지 않고 계산 함수를 직접 호출하므로
// explanation을 만들지 않습니다 - 그래서 소스별 explanation은 반드시 이
// 개별 엔드포인트에서만 얻을 수 있습니다.
export async function fetchYoutubeTrendGrowth(keyword) {
  return getJson(`/api/youtube/trend-growth?q=${encodeURIComponent(keyword)}`);
}

export async function fetchNewsTrendGrowth(keyword) {
  return getJson(`/api/news/trend-growth?q=${encodeURIComponent(keyword)}`);
}

export async function fetchNaverTrendGrowth(keyword) {
  return getJson(`/api/naver/trend-growth?q=${encodeURIComponent(keyword)}`);
}

export async function fetchYoutubeHistory(keyword) {
  return getJson(`/api/youtube/trend-history?q=${encodeURIComponent(keyword)}`);
}

export async function fetchNewsHistory(keyword) {
  return getJson(`/api/news/trend-history?q=${encodeURIComponent(keyword)}`);
}

export async function fetchNaverHistory(keyword) {
  return getJson(`/api/naver/trend-history?q=${encodeURIComponent(keyword)}`);
}

export async function fetchCompositeHistory(keyword) {
  return getJson(`/api/composite/trend-history?q=${encodeURIComponent(keyword)}`);
}
