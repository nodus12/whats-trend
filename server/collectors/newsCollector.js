// 19-2: Google News RSS를 Collector 인터페이스로 감싸는 Adapter
//
// server/rss.js 자체는 수정하지 않습니다. collect()는 fetchGoogleNews()의
// 결과를 그대로 반환합니다 - aggregateTrends()가 요구하는 입력 형태
// ({title, link, pubDate, source}[])를 이 계층에서 바꾸면 trendAggregator.js/
// trendHistory.js/trendNotifier.js까지 영향이 번지므로, 이번 단계에서는
// 절대 데이터 형태를 바꾸지 않습니다.
import { fetchGoogleNews } from "../rss.js";

export const NEWS_SOURCE = "news";

/**
 * 기존 fetchGoogleNews(query)를 그대로 호출합니다. 반환 형태는 이전과
 * 완전히 동일합니다: {title, link, pubDate, source}[]
 *
 * @param {string} query
 * @returns {Promise<Array<{title:string, link:string, pubDate:string, source:string}>>}
 */
async function collect(query) {
  return fetchGoogleNews(query);
}

/**
 * 뉴스 기사 배열을 공통 TrendSignal 형태로 변환합니다.
 * 준비용 함수이며, 현재 trendMonitor.js/trendAggregator.js 어디에서도
 * 아직 사용하지 않습니다(19-3 이후 다중 소스 결합 시 사용 예정).
 *
 * @param {Array<{title:string, link:string, pubDate:string, source:string}>} articles
 * @returns {Array<import('./signal.js').TrendSignal>}
 */
function toTrendSignals(articles = []) {
  const collectedAt = Date.now();

  return articles.map((article) => ({
    source: NEWS_SOURCE,
    sourceType: "exposure",
    text: article?.title ?? "",
    url: article?.link ?? "",
    value: 1,
    collectedAt,
  }));
}

export const newsCollector = {
  source: NEWS_SOURCE,
  collect,
  toTrendSignals,
};
