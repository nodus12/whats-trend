// 9-3단계(Trend Detection 2차) 뉴스 수집기 순수 함수 테스트. 실행: npm test
// DB/네트워크를 쓰지 않습니다(실제 저장 검증은 별도 LIVE 검증으로 확인).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildNewsSignalRows,
  resolveCollectionWindow,
  stripPublisherSuffix,
  hashArticleLink,
  getNewsCollectionIntervalMs,
  isTooSoonSinceLastRun,
  COLLECTION_RUN_KEY,
  NEWS_SIGNAL_TYPE,
} from "./newsSignalCollector.js";
import { computeTrendDetection } from "./multiSignalTimeSeries.js";

const HOUR = 60 * 60 * 1000;
const T10 = Date.UTC(2026, 9, 2, 1, 0); // KST 10:00
const article = (id, title, pubMs) => ({
  title,
  link: `https://news.google.com/rss/articles/${id}`,
  pubDate: new Date(pubMs).toUTCString(),
});

test("언론사 접미사를 떼고, 제목 안의 하이픈은 남긴다", () => {
  assert.equal(stripPublisherSuffix("성수동 오징어게임 팝업 오픈 - 조선비즈"), "성수동 오징어게임 팝업 오픈");
  assert.equal(stripPublisherSuffix("K-팝 신곡 공개 - v.daum.net"), "K-팝 신곡 공개");
  assert.equal(stripPublisherSuffix("접미사 없는 제목"), "접미사 없는 제목");
});

// 기존 복합어 추출기(keywordFiltering.buildBigramPhrases)는 인접한 2단어만
// 조합하므로, 3단어로 띄어 쓴 "오징어 게임 팝업"은 후보 자체가 생기지 않습니다.
test("키워드/병합 키 생성: 표기가 달라도 같은 키로 센다", () => {
  const { keywordRows } = buildNewsSignalRows({
    articlesByQuery: [
      {
        query: "콘텐츠",
        articles: [
          article("a1", "오징어게임 팝업스토어 성수 오픈 - 조선비즈", T10 - 10 * 60 * 1000),
          article("a2", "오징어게임 팝업 줄서기 - 뉴시스", T10 - 20 * 60 * 1000),
          article("a3", "오징어 게임 시즌3 공개 - 연합뉴스", T10 - 30 * 60 * 1000),
        ],
      },
    ],
    seenLinkHashes: new Set(),
    windowStartMs: T10 - HOUR,
    collectedAtMs: T10,
  });
  const row = keywordRows.find((r) => r.keyword_key === "오징어게임팝업");
  assert.ok(row, `keys=${keywordRows.map((r) => r.keyword_key).join(",")}`);
  assert.equal(row.value, 2); // "오징어게임 팝업스토어" + "오징어게임 팝업"
  assert.equal(keywordRows.find((r) => r.keyword_key === "오징어게임").value, 3); // "오징어게임" ×2 + "오징어 게임"
  assert.equal(row.source, "news");
  assert.equal(row.signal_type, NEWS_SIGNAL_TYPE);
  assert.equal(row.collected_at, new Date(T10).toISOString());
  assert.ok(row.normalized_value > 0 && row.normalized_value <= 100);
  // 언론사 이름은 키워드가 되지 않는다
  assert.ok(!keywordRows.some((r) => ["조선비즈", "뉴시스"].includes(r.keyword)));
});

test("중복 기사: 같은 link는 여러 검색어에 나와도 1번만, 이전 수집에서 센 기사는 제외", () => {
  const shared = article("dup", "두바이 초콜릿 품절 - 한겨레", T10 - 5 * 60 * 1000);
  const old = article("old", "두바이 초콜릿 재입고 - 한겨레", T10 - 15 * 60 * 1000);
  const { keywordRows, runRow, stats } = buildNewsSignalRows({
    articlesByQuery: [
      { query: "맛집/푸드", articles: [shared, old] },
      { query: "쇼핑", articles: [shared] },
    ],
    seenLinkHashes: new Set([hashArticleLink(old.link)]),
    windowStartMs: T10 - HOUR,
    collectedAtMs: T10,
  });
  assert.equal(stats.newArticles, 1);
  assert.equal(stats.duplicateInRun, 1);
  assert.equal(stats.alreadyCounted, 1);
  assert.equal(keywordRows.find((r) => r.keyword_key === "두바이초콜릿").value, 1);
  assert.deepEqual(runRow.metadata.countedLinkHashes, [hashArticleLink(shared.link)]);
});

test("수집 창 밖(오래된/미래) 기사와 잘못된 기사는 세지 않는다", () => {
  const { stats, keywordRows } = buildNewsSignalRows({
    articlesByQuery: [
      {
        query: "테크",
        articles: [
          article("too-old", "옛날 기사 제목 - 연합", T10 - 3 * HOUR),
          article("future", "미래 기사 제목 - 연합", T10 + HOUR),
          { title: "", link: "", pubDate: "" },
          { title: "날짜 없음", link: "https://x/1", pubDate: "invalid" },
        ],
      },
    ],
    seenLinkHashes: new Set(),
    windowStartMs: T10 - HOUR,
    collectedAtMs: T10,
  });
  assert.equal(stats.newArticles, 0);
  assert.equal(stats.outsideWindow, 2);
  assert.equal(stats.invalid, 2);
  assert.equal(keywordRows.length, 0);
});

test("수집 기록 행은 실제 키워드와 겹치지 않는 별도 키를 쓴다", () => {
  const { runRow } = buildNewsSignalRows({
    articlesByQuery: [{ query: "패션", articles: [] }],
    seenLinkHashes: new Set(),
    windowStartMs: T10 - HOUR,
    collectedAtMs: T10,
    failedQueries: ["뷰티"],
  });
  assert.equal(runRow.keyword_key, COLLECTION_RUN_KEY);
  assert.equal(runRow.value, 0);
  assert.deepEqual(runRow.metadata.failedQueries, ["뷰티"]);
});

test("수집 창: 첫 수집은 한 주기, 이후엔 직전 수집 한 주기 전부터, 오래 멈췄으면 최대 3주기", () => {
  assert.deepEqual(resolveCollectionWindow({ nowMs: T10, intervalMs: HOUR }), { windowStartMs: T10 - HOUR, firstRun: true });
  assert.equal(resolveCollectionWindow({ nowMs: T10, previousRunAtMs: T10 - HOUR, intervalMs: HOUR }).windowStartMs, T10 - 2 * HOUR);
  assert.equal(resolveCollectionWindow({ nowMs: T10, previousRunAtMs: T10 - 10 * HOUR, intervalMs: HOUR }).windowStartMs, T10 - 3 * HOUR);
});

test("중복 실행 방지: 직전 수집 후 주기 절반이 안 지났으면 건너뛴다", () => {
  assert.equal(isTooSoonSinceLastRun({ nowMs: T10, previousRunAtMs: undefined, intervalMs: HOUR }), false);
  assert.equal(isTooSoonSinceLastRun({ nowMs: T10, previousRunAtMs: T10 - 5 * 60 * 1000, intervalMs: HOUR }), true);
  assert.equal(isTooSoonSinceLastRun({ nowMs: T10, previousRunAtMs: T10 - 29 * 60 * 1000, intervalMs: HOUR }), true);
  assert.equal(isTooSoonSinceLastRun({ nowMs: T10, previousRunAtMs: T10 - 30 * 60 * 1000, intervalMs: HOUR }), false);
  assert.equal(isTooSoonSinceLastRun({ nowMs: T10, previousRunAtMs: T10 - 58 * 60 * 1000, intervalMs: HOUR }), false);
});

test("수집 주기 환경변수: 기본 60분, 최소 5분", () => {
  const original = process.env.TREND_NEWS_COLLECTION_INTERVAL_MINUTES;
  try {
    delete process.env.TREND_NEWS_COLLECTION_INTERVAL_MINUTES;
    assert.equal(getNewsCollectionIntervalMs(), 60 * 60 * 1000);
    process.env.TREND_NEWS_COLLECTION_INTERVAL_MINUTES = "30";
    assert.equal(getNewsCollectionIntervalMs(), 30 * 60 * 1000);
    process.env.TREND_NEWS_COLLECTION_INTERVAL_MINUTES = "1";
    assert.equal(getNewsCollectionIntervalMs(), 5 * 60 * 1000);
    process.env.TREND_NEWS_COLLECTION_INTERVAL_MINUTES = "abc";
    assert.equal(getNewsCollectionIntervalMs(), 60 * 60 * 1000);
  } finally {
    if (original === undefined) delete process.env.TREND_NEWS_COLLECTION_INTERVAL_MINUTES;
    else process.env.TREND_NEWS_COLLECTION_INTERVAL_MINUTES = original;
  }
});

test("10시/11시/12시 수집 → 같은 키워드 값 3/5/9 시계열이 만들어지고 1차 엔진이 상승으로 읽는다", () => {
  const seen = new Set();
  const series = [];
  const plan = [
    [T10, 3],
    [T10 + HOUR, 5],
    [T10 + 2 * HOUR, 9],
  ];
  let previousRunAtMs;

  for (const [runAt, count] of plan) {
    const { windowStartMs } = resolveCollectionWindow({ nowMs: runAt, previousRunAtMs, intervalMs: HOUR });
    // 이번 시간대 새 기사 + 직전 시간대 기사(RSS에 그대로 남아있음)를 함께 돌려줌
    const fresh = Array.from({ length: count }, (_, i) =>
      article(`${runAt}-${i}`, `오징어게임 팝업 소식 ${i}번째 - 연합`, runAt - (i + 1) * 60 * 1000)
    );
    const stale = series.length > 0 ? series[series.length - 1].articles : [];
    const { keywordRows, runRow } = buildNewsSignalRows({
      articlesByQuery: [{ query: "콘텐츠", articles: [...fresh, ...stale] }],
      seenLinkHashes: seen,
      windowStartMs,
      collectedAtMs: runAt,
    });
    runRow.metadata.countedLinkHashes.forEach((h) => seen.add(h));
    const row = keywordRows.find((r) => r.keyword_key === "오징어게임팝업");
    series.push({ t: runAt, value: row?.value ?? 0, articles: fresh });
    previousRunAtMs = runAt;
  }

  assert.deepEqual(series.map((p) => p.value), [3, 5, 9]);
  const detection = computeTrendDetection("오징어게임 팝업", [
    { source: "news", sourceType: "exposure", points: series.map(({ t, value }) => ({ t, value })) },
  ]);
  assert.ok(detection.growthRatePct > 0);
  assert.ok(detection.velocityScore > 0);
  assert.equal(detection.observationCount, 3);
});
