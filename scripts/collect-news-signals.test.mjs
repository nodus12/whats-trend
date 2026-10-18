// scripts/collect-news-signals.mjs의 판정 로직 테스트. 실행: npm test
// 실제 수집(runNewsSignalCollection 호출)이나 Supabase 접근은 하지 않습니다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findMissingEnv, toExitCode, summarize } from "./collect-news-signals.mjs";

test("종료 코드: 성공과 '30분 이내 건너뜀'만 0, 나머지는 1", () => {
  assert.equal(toExitCode({ success: true }), 0);
  assert.equal(toExitCode({ success: false, skipped: true, reason: "too_soon" }), 0);
  assert.equal(toExitCode({ success: false, skipped: true, reason: "supabase_not_configured" }), 1);
  assert.equal(toExitCode({ success: false, skipped: true, reason: "already_running" }), 1);
  assert.equal(toExitCode({ success: false, reason: "all_queries_failed" }), 1);
  assert.equal(toExitCode({ success: false, reason: "news_signal_upsert_failed" }), 1);
  assert.equal(toExitCode(undefined), 1);
});

test("환경변수 누락 판정: 없거나 빈 값이면 이름만 돌려준다", () => {
  assert.deepEqual(findMissingEnv({}), ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  assert.deepEqual(findMissingEnv({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "  " }), ["SUPABASE_SERVICE_ROLE_KEY"]);
  assert.deepEqual(findMissingEnv({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "y" }), []);
});

test("요약 출력: 건수·상태만 담고 결과 객체를 그대로 노출하지 않는다", () => {
  const ok = summarize({
    success: true,
    collectedAt: "t",
    windowStart: "w",
    fetchedArticles: 1000,
    newArticles: 12,
    keywordRowCount: 150,
    alreadyCounted: 3,
    failedQueries: [],
    firstRun: false,
  });
  assert.deepEqual(Object.keys(ok), [
    "status", "collectedAt", "windowStart", "fetchedArticles", "newArticles", "keywordRows", "alreadyCounted", "failedQueries",
  ]);
  assert.equal(summarize({ success: false, skipped: true, reason: "too_soon" }).status, "skipped");
  assert.equal(summarize({ success: false, reason: "all_queries_failed" }).status, "failed");
});

test("기존 수집 모듈 import 호환성: 함수를 불러오기만 하고 호출하지 않는다", async () => {
  const mod = await import("../server/newsSignalCollector.js");
  assert.equal(typeof mod.runNewsSignalCollection, "function");
});
