// Collector Registry
//
// 19-2: newsCollector 등록.
// 19-3: naverDataLabCollector 등록 - News와 완전히 다른 소스(수치형 검색 신호)
//   이지만, collect(query) -> Promise<Array> 인터페이스는 동일하게 맞췄습니다.
// 19-4: googleTrendsCollector 등록 - 공식 API가 아직 Alpha(제한된 테스터 승인제)
//   단계라 실제 네트워크 요청은 인증정보가 없으면 시도하지 않습니다(collector 내부에서 처리).
// 20-1: gdeltCollector 등록 - 인증/API Key가 필요 없는 공식 공개 endpoint이며,
//   sourceType은 "exposure"(News와 동일한 매체 노출 신호)입니다. 이 파일과
//   trendMonitor.js는 이미 collectors 객체를 순회하는 구조였기 때문에, 여기
//   등록 한 줄만으로 trendMonitor.js의 기존 수집 루프에 자동으로 연결됩니다
//   (trendMonitor.js 자체는 수정하지 않았습니다 - 20-1 완료 보고서 참고).
// communityCollector 등도 이 registry에 추가하면 trendMonitor.js 등 상위 계층
// 코드를 바꾸지 않고 소스를 늘릴 수 있습니다.
import { newsCollector } from "./newsCollector.js";
import { naverDataLabCollector } from "./naverDataLabCollector.js";
import { googleTrendsCollector } from "./googleTrendsCollector.js";
import { gdeltCollector } from "./gdeltCollector.js";

export const collectors = {
  [newsCollector.source]: newsCollector,
  [naverDataLabCollector.source]: naverDataLabCollector,
  [googleTrendsCollector.source]: googleTrendsCollector,
  [gdeltCollector.source]: gdeltCollector,
};

/**
 * 등록된 collector를 이름으로 조회합니다.
 * @param {string} name - 예: "news", "naver_datalab", "google_trends", "gdelt"
 * @returns {{source:string, collect:(query:string)=>Promise<Array>}|undefined}
 */
export function getCollector(name) {
  return collectors[name];
}
