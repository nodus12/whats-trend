// 9-2단계(Trend Detection 1차) 자동 테스트. 실행: npm test
// 외부 API/DB를 쓰지 않는 순수 계산 테스트입니다.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeTrendDetection,
  computeGrowth,
  computeSpread,
  computeOpportunityScore,
  classifyTrendStage,
  toSortedSeries,
} from "./multiSignalTimeSeries.js";
import { computeSeasonality } from "./multiSignalSeasonality.js";
import { computeMultiSignalTrend } from "./multiSignalTrendEngine.js";
import { toCanonicalKeywordKey, groupKeywordVariants } from "./keywordExtraction.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 9, 1);
const hourly = (values) => values.map((value, i) => ({ t: T0 + i * HOUR, value }));
const single = (keyword, values) =>
  computeTrendDetection(keyword, [{ source: "news", sourceType: "exposure", points: hourly(values) }]);

// ---- 지시서 §29 시나리오 ----

test("테스트 트렌드(100,150,230,400): Growth/Velocity/Acceleration 모두 양수", () => {
  const r = single("테스트 트렌드", [100, 150, 230, 400]);
  const p = r.perSource[0];
  assert.ok(r.growthRatePct > 0);
  assert.equal(p.velocity.velocity, 100); // (50+80+170)/3
  assert.equal(p.acceleration.acceleration, 60); // (30+90)/2
  assert.ok(r.growthScore > 0 && r.velocityScore > 0 && r.accelerationScore > 0);
});

test("오래된 키워드(1000,1010,1005,1008): Trend Score가 낮다", () => {
  const old = single("오래된 키워드", [1000, 1010, 1005, 1008]);
  const rising = single("테스트 트렌드", [100, 150, 230, 400]);
  assert.ok(old.trendScore < 25, `trendScore=${old.trendScore}`);
  assert.ok(old.trendScore < rising.trendScore);
  assert.equal(old.trendStage, "WATCH");
  assert.equal(old.trendType, "SATURATED");
});

test("신규 키워드(0,0,1,10,50,200): Novelty/Growth/Acceleration 높음, NEW", () => {
  const r = single("신규 키워드", [0, 0, 1, 10, 50, 200]);
  assert.ok(r.noveltyScore >= 60, `novelty=${r.noveltyScore}`);
  assert.ok(r.growthScore >= 60, `growth=${r.growthScore}`);
  assert.ok(r.accelerationScore >= 60, `acceleration=${r.accelerationScore}`);
  assert.equal(r.trendType, "NEW");
});

// ---- Growth 절대량 보정 ----

test("Growth: 0→1과 10→100을 같게 취급하지 않는다", () => {
  const tiny = computeGrowth(toSortedSeries([{ t: 1, value: 0 }, { t: 2, value: 1 }]));
  const big = computeGrowth(toSortedSeries([{ t: 1, value: 10 }, { t: 2, value: 100 }]));
  assert.equal(tiny.growthRatePct, 20); // 1 / max(0, 5)
  assert.equal(big.growthRatePct, 900);
  assert.ok(big.score > tiny.score);
});

// ---- Spread ----

test("Spread: 데이터 없는 소스·보합 소스는 세지 않는다", () => {
  const spread = computeSpread([
    { source: "youtube", growth: { available: true, growthRatePct: 50 } },
    { source: "news", growth: { available: true, growthRatePct: 30 } },
    { source: "naver", growth: { available: true, growthRatePct: 2 } },
    { source: "gdelt", growth: { available: false, growthRatePct: null } },
  ]);
  assert.equal(spread.sourceCount, 3);
  assert.equal(spread.risingSourceCount, 2);
  assert.equal(spread.score, 40);
});

test("Spread: 5개 이상이면 100", () => {
  const rising = ["a", "b", "c", "d", "e", "f"].map((source) => ({ source, growth: { available: true, growthRatePct: 50 } }));
  assert.equal(computeSpread(rising).score, 100);
});

// ---- Trend Stage 최소 데이터 조건 ----

test("Stage: 관측 1개면 점수와 무관하게 WATCH", () => {
  assert.equal(classifyTrendStage(95, { observationCount: 1, sourceCount: 3 }).trendStage, "WATCH");
});

test("Stage: 관측 2개면 최대 EARLY", () => {
  const s = classifyTrendStage(95, { observationCount: 2, sourceCount: 3 });
  assert.equal(s.trendStage, "EARLY");
  assert.equal(s.capReason, "few_observations");
});

test("Stage: 소스 1개면 최대 RISING (신규 키워드는 원래 HOT)", () => {
  const r = single("신규 키워드", [0, 0, 1, 10, 50, 200]);
  assert.equal(r.rawStage, "HOT");
  assert.equal(r.trendStage, "RISING");
  assert.equal(r.stageCapReason, "single_source");
});

test("Stage: 소스 2개가 함께 오르면 상한 없이 HOT 이상", () => {
  const values = [0, 0, 1, 10, 50, 200];
  const r = computeTrendDetection("동시 상승", [
    { source: "news", sourceType: "exposure", points: hourly(values) },
    { source: "youtube", sourceType: "diffusion", points: hourly(values) },
  ]);
  assert.ok(["HOT", "VIRAL"].includes(r.trendStage), `stage=${r.trendStage}`);
  assert.equal(r.stageCapReason, null);
  assert.equal(r.spreadScore, 40);
});

// ---- Opportunity ----

test("Opportunity: 신규 키워드 > 오래된 키워드", () => {
  const fresh = single("신규 키워드", [0, 0, 1, 10, 50, 200]);
  const old = single("오래된 키워드", [1000, 1010, 1005, 1008]);
  assert.ok(fresh.opportunityScore > old.opportunityScore);
});

test("Opportunity: 같은 조건이면 포화도가 높을수록 낮다", () => {
  const base = { trendScore: 80, novelty: 50, growth: 60, spread: 40, persistence: 100 };
  assert.ok(
    computeOpportunityScore({ ...base, saturation: 10 }) > computeOpportunityScore({ ...base, saturation: 90 })
  );
});

// ---- 소스 실패 격리 ----

test("한 소스가 실패해 빈 데이터여도 나머지 소스로 계산한다", () => {
  const r = computeTrendDetection("부분 실패", [
    { source: "news", sourceType: "exposure", points: hourly([100, 150, 230, 400]) },
    { source: "youtube", sourceType: "diffusion", points: [] },
    { source: "naver", sourceType: "demand", points: [{ t: "invalid", value: Number.NaN }] },
  ]);
  assert.deepEqual(r.sources, ["news"]);
  assert.equal(r.sourceCount, 1);
  assert.ok(r.trendScore > 0);
});

// ---- 시즌성 ----

const seasonalSeries = (peak) => {
  const points = [];
  for (let t = Date.UTC(2023, 0, 1); t < Date.UTC(2026, 11, 1); t += 7 * DAY) {
    const d = new Date(t);
    const nearDec20 = Math.abs(t - Date.UTC(d.getUTCFullYear(), 11, 20)) <= 10 * DAY;
    points.push({ t, value: peak && nearDec20 ? 100 : 10 });
  }
  return points;
};
const DEC15 = new Date(Date.UTC(2026, 11, 15));

test("Seasonality: 매년 12월에 반복 상승하면 seasonal", () => {
  const s = computeSeasonality(seasonalSeries(true), { now: DEC15 });
  assert.equal(s.seasonal, true);
  assert.ok(s.peakYears >= 2);
});

test("Seasonality: 일정한 값이면 seasonal 아님", () => {
  const s = computeSeasonality(seasonalSeries(false), { now: DEC15 });
  assert.equal(s.seasonal, false);
  assert.equal(s.reason, "no_recurring_peak");
});

test("Seasonality: 과거 데이터가 짧으면 판단 보류", () => {
  const s = computeSeasonality(hourly([1, 2, 3, 4]), { now: DEC15 });
  assert.equal(s.seasonal, false);
  assert.equal(s.reason, "insufficient_history");
});

test("Seasonality는 점수가 아니라 유형(SEASONAL)에만 반영된다", () => {
  const points = hourly([100, 150, 230, 400]);
  const plain = computeTrendDetection("크리스마스", [{ source: "news", sourceType: "exposure", points }]);
  const withSeason = computeTrendDetection("크리스마스", [{ source: "news", sourceType: "exposure", points }], {
    seasonality: { seasonal: true },
  });
  assert.equal(withSeason.trendType, "SEASONAL");
  assert.equal(withSeason.trendScore, plain.trendScore);
});

// ---- 키워드 병합 키 ----

test("병합 키: 오징어게임 팝업 표기 4종이 하나로 묶인다", () => {
  const variants = ["오징어게임 팝업", "오징어 게임 팝업", "오징어게임 팝업스토어", "오징어게임 팝업 스토어"];
  const keys = new Set(variants.map(toCanonicalKeywordKey));
  assert.deepEqual([...keys], ["오징어게임팝업"]);
  const groups = groupKeywordVariants([...variants, "오징어게임 팝업"]);
  assert.equal(groups.size, 1);
  assert.equal(groups.get("오징어게임팝업").displayKeyword, "오징어게임 팝업");
});

test("병합 키: 뜻이 다른 키워드는 합치지 않는다", () => {
  assert.notEqual(toCanonicalKeywordKey("애플스토어"), toCanonicalKeywordKey("애플"));
  assert.notEqual(toCanonicalKeywordKey("오징어게임"), toCanonicalKeywordKey("오징어게임 팝업"));
  assert.notEqual(toCanonicalKeywordKey("경기도"), toCanonicalKeywordKey("경기"));
  assert.equal(toCanonicalKeywordKey("C++"), "c++");
});

test("병합 키: 대소문자/하이픈 차이는 합치고, 일반 단어는 제외", () => {
  assert.equal(toCanonicalKeywordKey("GPT-5"), toCanonicalKeywordKey("gpt5"));
  assert.equal(toCanonicalKeywordKey("뉴스"), null);
  assert.equal(toCanonicalKeywordKey(" "), null);
});

// ---- 기존 Multi-Signal 점수 회귀 ----

test("기존 computeMultiSignalTrend 결과는 바뀌지 않았다", () => {
  const r = computeMultiSignalTrend(
    "AI",
    [
      { source: "news", sourceType: "exposure", currentValue: 8, previousValue: 4 },
      { source: "naver_datalab", sourceType: "demand", currentValue: 60, previousValue: 50 },
    ],
    { totalKnownSources: 4 }
  );
  assert.equal(r.multiSignalScore, 59);
  assert.equal(r.signalCoverage, 0.5);
  assert.equal(r.earlySignalScore, 46);
  assert.equal(r.mainstreamScore, 66);
});
