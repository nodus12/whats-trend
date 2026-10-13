// 9-3단계(Trend Detection 2차): Google News RSS → trend_signals 시계열 저장.
//
// "이번 수집 주기에 새로 나온 기사 수"를 키워드별로 세서 trend_signals에
// 한 행씩 쌓습니다. 같은 키워드의 값이 시간에 따라 어떻게 변하는지가
// multiSignalTimeSeries.js(1차 계산 엔진)의 입력이 됩니다.
//
// 재사용하는 기존 코드(동작 변경 없음):
//   - newsDailyTrend.fetchNewsArticles(): RSS 전체 항목 수집. server/rss.js의
//     fetchGoogleNews()는 10건으로 잘라서 반환하므로(/api/news용) 쓰지 않습니다.
//   - keywordFiltering.toCleanKeywordCandidates(): 기존 Multi-Signal과 같은
//     제목 → 키워드 후보(단어 + 2단어 복합어) → 노이즈 필터 과정.
//   - keywordExtraction.normalizeKeyword()/toCanonicalKeywordKey(): 표시용
//     키워드와 병합 키. 불용어는 toCanonicalKeywordKey()가 걸러냅니다.
//   - multiSignalTrendEngine.normalizeSignalValue(): normalized_value(0~100).
//   - autoKeywordDiscovery.DISCOVERY_CATEGORIES: 수집할 10개 카테고리 검색어.
//
// "신규 기사" 판정: 기사 pubDate가 이번 수집 창(window) 안에 있고, 최근
// 24시간 안의 수집에서 이미 센 기사(link 기준)가 아니며, 이번 수집 안에서도
// 처음 나온 기사(여러 카테고리 검색에 같은 기사가 나오는 경우가 흔함).
// 이미 센 기사 목록은 별도 테이블 없이, 매 수집마다 남기는 "수집 기록 행"
// (keyword_key = COLLECTION_RUN_KEY)의 metadata에 link 해시로 저장합니다.
// 이 행은 "이 시각에 수집이 실제로 끝났다"는 기록도 겸합니다 - 어떤 키워드의
// 행이 없는 수집 시각은 "관측했는데 0건"으로 읽을 수 있습니다.
import crypto from "node:crypto";
import { fetchNewsArticles } from "./newsDailyTrend.js";
import { toCleanKeywordCandidates } from "./keywordFiltering.js";
import { normalizeKeyword, toCanonicalKeywordKey } from "./keywordExtraction.js";
import { normalizeSignalValue } from "./multiSignalTrendEngine.js";
import { DISCOVERY_CATEGORIES } from "./autoKeywordDiscovery.js";
import { getSupabaseClient, isSupabaseConfigured } from "./supabase.js";

export const TREND_SIGNALS_TABLE = "trend_signals";
export const NEWS_SIGNAL_SOURCE = "news";
export const NEWS_SIGNAL_TYPE = "news_count";
export const COLLECTION_RUN_SIGNAL_TYPE = "news_collection_run";
// toCanonicalKeywordKey()는 "_"를 제거하므로 실제 키워드와 절대 겹치지 않습니다.
// trend_signals를 키워드 목록으로 읽을 때는 이 행을 제외해야 합니다.
export const COLLECTION_RUN_KEY = "__collection_run__";

const DEFAULT_INTERVAL_MINUTES = 60;
const MIN_INTERVAL_MINUTES = 5;
const LEDGER_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const MAX_WINDOW_INTERVALS = 3; // 수집이 오래 멈췄다 재개돼도 창은 최대 3주기 분량
const FUTURE_PUBDATE_TOLERANCE_MS = 10 * 60 * 1000;
const MAX_SAMPLE_LINKS = 3;
const UPSERT_CHUNK_SIZE = 500;

export function getNewsCollectionIntervalMs() {
  const minutes = Number.parseInt(process.env.TREND_NEWS_COLLECTION_INTERVAL_MINUTES ?? "", 10);
  const safe = Number.isFinite(minutes) ? Math.max(MIN_INTERVAL_MINUTES, minutes) : DEFAULT_INTERVAL_MINUTES;
  return safe * 60 * 1000;
}

export function hashArticleLink(link) {
  return crypto.createHash("sha1").update(link).digest("hex").slice(0, 16);
}

// Google News 제목은 "기사 제목 - 언론사" 형식입니다. 언론사 이름("조선비즈",
// "v.daum.net" 등)이 매 시간 꾸준히 나오는 가짜 키워드가 되지 않도록 뗍니다.
export function stripPublisherSuffix(title) {
  const text = typeof title === "string" ? title.trim() : "";
  const index = text.lastIndexOf(" - ");
  if (index > 0 && text.length - index - 3 <= 30) {
    return text.slice(0, index).trim();
  }
  return text;
}

/**
 * 이번 수집 창의 시작 시각. 직전 수집이 있으면 그보다 한 주기 앞부터 봅니다 -
 * RSS에 늦게 올라온 기사도 잡기 위함이고, 겹치는 구간의 기사는 link 기록으로
 * 다시 세지 않습니다. 직전 수집이 없으면(첫 수집) 딱 한 주기만 봅니다 -
 * 첫 값이 며칠 치 기사로 부풀지 않게 하기 위함입니다.
 */
export function resolveCollectionWindow({ nowMs, previousRunAtMs, intervalMs }) {
  if (typeof previousRunAtMs !== "number") {
    return { windowStartMs: nowMs - intervalMs, firstRun: true };
  }
  return {
    windowStartMs: Math.max(previousRunAtMs - intervalMs, nowMs - MAX_WINDOW_INTERVALS * intervalMs),
    firstRun: false,
  };
}

/**
 * 직전 완료 수집 후 주기의 절반이 지나지 않았으면 이번 수집을 건너뜁니다.
 * 내부 타이머(TREND_NEWS_COLLECTION_ENABLED)와 외부 트리거가 함께 켜져 있거나
 * 크론이 재시도해도, 몇 분 간격의 짧은 수집이 끼어들어 시계열 값의 기준
 * (한 주기 동안의 신규 기사 수)이 흐트러지지 않게 하기 위함입니다.
 */
export function isTooSoonSinceLastRun({ nowMs, previousRunAtMs, intervalMs }) {
  return typeof previousRunAtMs === "number" && nowMs - previousRunAtMs < intervalMs / 2;
}

function extractArticleKeywords(title, link, collectedAtMs) {
  const signal = {
    source: NEWS_SIGNAL_SOURCE,
    sourceType: "exposure",
    text: stripPublisherSuffix(title),
    url: link,
    value: 1,
    collectedAt: collectedAtMs,
  };

  const byKey = new Map();
  for (const candidate of toCleanKeywordCandidates([signal])) {
    const display = normalizeKeyword(candidate.keyword);
    const key = toCanonicalKeywordKey(display);
    if (display && key && !byKey.has(key)) {
      byKey.set(key, display);
    }
  }
  return byKey;
}

/**
 * 수집한 기사들을 trend_signals 행으로 변환합니다(순수 함수, DB/네트워크 없음).
 *
 * @param {Object} params
 * @param {Array<{query:string, articles:Array<{title:string, link:string, pubDate:string}>}>} params.articlesByQuery
 * @param {Set<string>} params.seenLinkHashes - 최근 수집에서 이미 센 기사의 link 해시
 * @param {number} params.windowStartMs
 * @param {number} params.collectedAtMs
 * @param {string[]} [params.failedQueries]
 */
export function buildNewsSignalRows({ articlesByQuery, seenLinkHashes, windowStartMs, collectedAtMs, failedQueries = [] }) {
  const collectedAt = new Date(collectedAtMs).toISOString();
  const windowStart = new Date(windowStartMs).toISOString();
  const stats = { fetchedArticles: 0, newArticles: 0, duplicateInRun: 0, alreadyCounted: 0, outsideWindow: 0, invalid: 0 };

  const countedThisRun = new Set();
  const byKey = new Map(); // keyword_key -> { count, variants: Map<display, count>, sampleLinks }

  for (const { articles } of articlesByQuery) {
    for (const article of Array.isArray(articles) ? articles : []) {
      stats.fetchedArticles += 1;

      const link = typeof article?.link === "string" ? article.link.trim() : "";
      const pubMs = Date.parse(article?.pubDate ?? "");
      if (!link || !Number.isFinite(pubMs) || !article.title) {
        stats.invalid += 1;
        continue;
      }

      const hash = hashArticleLink(link);
      if (countedThisRun.has(hash)) {
        stats.duplicateInRun += 1;
        continue;
      }
      if (seenLinkHashes.has(hash)) {
        stats.alreadyCounted += 1;
        continue;
      }
      if (pubMs <= windowStartMs || pubMs > collectedAtMs + FUTURE_PUBDATE_TOLERANCE_MS) {
        stats.outsideWindow += 1;
        continue;
      }

      countedThisRun.add(hash);
      stats.newArticles += 1;

      for (const [key, display] of extractArticleKeywords(article.title, link, collectedAtMs)) {
        if (!byKey.has(key)) {
          byKey.set(key, { count: 0, variants: new Map(), sampleLinks: [] });
        }
        const entry = byKey.get(key);
        entry.count += 1;
        entry.variants.set(display, (entry.variants.get(display) ?? 0) + 1);
        if (entry.sampleLinks.length < MAX_SAMPLE_LINKS) {
          entry.sampleLinks.push(link);
        }
      }
    }
  }

  const keywordRows = [...byKey.entries()].map(([key, entry]) => {
    const [keyword] = [...entry.variants.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      keyword,
      keyword_key: key,
      source: NEWS_SIGNAL_SOURCE,
      signal_type: NEWS_SIGNAL_TYPE,
      value: entry.count,
      normalized_value: normalizeSignalValue(entry.count, "exposure"),
      collected_at: collectedAt,
      metadata: { sourceType: "exposure", windowStart, sampleLinks: entry.sampleLinks },
    };
  });

  const runRow = {
    keyword: COLLECTION_RUN_KEY,
    keyword_key: COLLECTION_RUN_KEY,
    source: NEWS_SIGNAL_SOURCE,
    signal_type: COLLECTION_RUN_SIGNAL_TYPE,
    value: stats.newArticles,
    normalized_value: null,
    collected_at: collectedAt,
    metadata: {
      windowStart,
      queries: articlesByQuery.map((q) => q.query),
      failedQueries,
      keywordCount: keywordRows.length,
      ...stats,
      countedLinkHashes: [...countedThisRun],
    },
  };

  return { keywordRows, runRow, stats };
}

async function loadRecentRuns(client, nowMs) {
  const { data, error } = await client
    .from(TREND_SIGNALS_TABLE)
    .select("collected_at, metadata")
    .eq("keyword_key", COLLECTION_RUN_KEY)
    .eq("source", NEWS_SIGNAL_SOURCE)
    .gte("collected_at", new Date(nowMs - LEDGER_LOOKBACK_MS).toISOString())
    .order("collected_at", { ascending: false });

  if (error) {
    const sanitized = new Error(`최근 수집 기록 조회 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "news_signal_ledger_failed";
    throw sanitized;
  }

  const runs = data ?? [];
  const seenLinkHashes = new Set(runs.flatMap((run) => run.metadata?.countedLinkHashes ?? []));
  const previousRunAtMs = runs.length > 0 ? Date.parse(runs[0].collected_at) : undefined;
  return { seenLinkHashes, previousRunAtMs };
}

async function upsertRows(client, rows) {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
    const { error } = await client
      .from(TREND_SIGNALS_TABLE)
      .upsert(rows.slice(i, i + UPSERT_CHUNK_SIZE), { onConflict: "keyword_key,source,collected_at" });
    if (error) {
      const sanitized = new Error(`trend_signals 저장 실패: ${error.message ?? "unknown_error"}`);
      sanitized.code = "news_signal_upsert_failed";
      throw sanitized;
    }
  }
}

let isRunning = false;

export function isNewsSignalCollectionRunning() {
  return isRunning;
}

/**
 * 뉴스 수집 1회. 절대 throw하지 않고 결과 요약을 반환합니다(setInterval 콜백 안전).
 * 카테고리 하나의 RSS가 실패해도 나머지는 계속 진행하고, 모두 실패하면 아무것도
 * 저장하지 않습니다("0건 관측"으로 잘못 기록하지 않기 위함). 키워드 행 저장이
 * 끝난 뒤에만 수집 기록 행을 남기므로, 기록 행이 있는 시각 = 완료된 수집입니다.
 *
 * @param {Object} [options] - 테스트용 주입(now, queries, fetchArticles, intervalMs)
 */
export async function runNewsSignalCollection(options = {}) {
  if (isRunning) {
    console.log("[News Signals] 이전 수집이 아직 실행 중이라 이번 주기는 건너뜁니다.");
    return { success: false, skipped: true, reason: "already_running" };
  }
  if (!isSupabaseConfigured()) {
    return { success: false, skipped: true, reason: "supabase_not_configured" };
  }

  isRunning = true;
  const nowMs = (options.now instanceof Date ? options.now : new Date()).getTime();
  const queries = options.queries ?? DISCOVERY_CATEGORIES;
  const fetchArticles = options.fetchArticles ?? fetchNewsArticles;
  const intervalMs = options.intervalMs ?? getNewsCollectionIntervalMs();

  try {
    const client = getSupabaseClient();
    const { seenLinkHashes, previousRunAtMs } = await loadRecentRuns(client, nowMs);

    if (isTooSoonSinceLastRun({ nowMs, previousRunAtMs, intervalMs })) {
      const previousRunAt = new Date(previousRunAtMs).toISOString();
      console.log(`[News Signals] 직전 수집(${previousRunAt}) 후 ${intervalMs / 120000}분이 지나지 않아 건너뜁니다.`);
      return { success: false, skipped: true, reason: "too_soon", previousRunAt };
    }

    const { windowStartMs, firstRun } = resolveCollectionWindow({ nowMs, previousRunAtMs, intervalMs });

    const articlesByQuery = [];
    const failedQueries = [];
    for (const query of queries) {
      try {
        const { articles } = await fetchArticles(query);
        articlesByQuery.push({ query, articles });
      } catch (error) {
        failedQueries.push(query);
        console.error(`[News Signals] "${query}" RSS 수집 실패(다음 검색어로 계속 진행):`, error?.message ?? error);
      }
    }

    if (articlesByQuery.length === 0) {
      console.error("[News Signals] 모든 검색어 수집 실패 - 이번 주기는 저장하지 않습니다.");
      return { success: false, reason: "all_queries_failed", failedQueries };
    }

    const { keywordRows, runRow, stats } = buildNewsSignalRows({
      articlesByQuery,
      seenLinkHashes,
      windowStartMs,
      collectedAtMs: nowMs,
      failedQueries,
    });

    await upsertRows(client, keywordRows);
    await upsertRows(client, [runRow]);

    console.log(
      `[News Signals] 저장 완료: 신규 기사 ${stats.newArticles}건 → 키워드 ${keywordRows.length}개` +
        ` (가져온 기사 ${stats.fetchedArticles}, 이미 센 기사 ${stats.alreadyCounted}, 수집 내 중복 ${stats.duplicateInRun},` +
        ` 창 밖 ${stats.outsideWindow}, 실패 검색어 ${failedQueries.length})`
    );

    return {
      success: true,
      collectedAt: runRow.collected_at,
      windowStart: runRow.metadata.windowStart,
      firstRun,
      keywordRowCount: keywordRows.length,
      failedQueries,
      ...stats,
    };
  } catch (error) {
    console.error("[News Signals] 수집 실패:", error?.message ?? error);
    return { success: false, reason: error?.code ?? "unexpected_error", message: error?.message };
  } finally {
    isRunning = false;
  }
}
