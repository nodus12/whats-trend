import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeDatabase } from "./database.js";
import { fetchGoogleNews } from "./rss.js";
import { fetchYoutubeVideos } from "./youtube.js";
import { calculateYoutubeTrend } from "./youtubeTrend.js";
import { saveYoutubeDailyTrend, toUtcDateString } from "./youtubeDailyTrend.js";
import { calculateYoutubeTrendGrowth, calculateTrendScore } from "./youtubeTrendGrowth.js";
import { getOrCreateExplanation } from "./youtubeTrendExplanation.js";
import { collectNewsDailyMentionCount, saveNewsDailyTrend, toUtcDateString as toUtcNewsDateString } from "./newsDailyTrend.js";
import { calculateNewsTrendGrowth } from "./newsTrendGrowth.js";
import { getOrCreateNewsExplanation } from "./newsTrendExplanation.js";
import { getNaverTrendGrowth } from "./naverTrendGrowth.js";
import { getOrCreateNaverExplanation } from "./naverTrendExplanation.js";
import { getCompositeTrendScore } from "./compositeTrendScore.js";
import { getSupabaseClient } from "./supabase.js";
import {
  listTrackedKeywords,
  addTrackedKeyword,
  deactivateTrackedKeyword,
  countActiveTrackedKeywords,
} from "./trackedKeywords.js";
import {
  runScheduledCollection,
  SCHEDULED_COLLECTION_INTERVAL_MS,
  isSchedulerRunning,
} from "./scheduler.js";
import {
  getYoutubeTrendHistory,
  getNewsTrendHistory,
  getNaverTrendHistory,
  getCompositeTrendHistory,
  getTodayCompositeExplanation,
} from "./trendHistoryApi.js";
import { aggregateTrends } from "./trendAggregator.js";
import { isVapidConfigured, getVapidPublicKey } from "./webPush.js";
import {
  isValidSubscription,
  isValidSettings,
  saveSubscription,
  removeSubscription,
  getSubscriptionCount,
  getSubscriptionsSettingsSummary,
} from "./pushSubscriptions.js";
import { sendTestNotificationToAll } from "./pushSender.js";
import { checkTrendsAndNotify } from "./trendNotifier.js";
import {
  TREND_MONITOR_INTERVAL_MS,
  collectTrends,
  runTrendMonitorCycle,
  isTrendMonitorRunning,
} from "./trendMonitor.js";

// 18-4: Express 라우트가 등록되기 전에 SQLite를 먼저 초기화합니다.
// (subscription/settings/trendHistory/dedupe 저장소가 모두 이 연결을 사용하므로,
// 이 초기화가 끝나지 않은 상태에서 요청을 받으면 안 됩니다.)
// 초기화에 실패하면 서버가 "정상 동작하는 것처럼" 보이면 안 되므로 즉시 종료합니다.
try {
  initializeDatabase();
} catch (error) {
  console.error("[Database] 초기화 실패:", error.message);
  process.exit(1);
}

const app = express();
const port = 5000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(cors());
app.use(express.json());

// 5-2단계: YouTube API 감사 신청에 필수 항목으로 요구되는 개인정보처리방침
// 페이지. public/privacy.html(정적 페이지, push-test.html과 동일한 관례)에
// 내용을 두고, 이 라우트로 "/privacy"라는 깔끔한 경로에서 항상 접근 가능하게
// 합니다 - 빌드된 dist/가 있든 없든(로컬 개발 중에도) 동일하게 동작하도록
// public/ 원본 파일을 직접 서빙합니다(아래 dist/ 정적 서빙 블록과는 독립적).
app.get("/privacy", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "privacy.html"));
});

// 5-3단계: 서비스 이용약관 페이지. /privacy와 완전히 동일한 패턴
// (public/terms.html 정적 페이지 + 직접 서빙)입니다.
app.get("/terms", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "terms.html"));
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "WHAT'S TREND API is running",
  });
});

app.get("/api/news", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q : "AI";

  try {
    const items = await fetchGoogleNews(query);

    res.json({
      success: true,
      query: query.trim() || "AI",
      count: items.length,
      items,
    });
  } catch (error) {
    console.error("Google News RSS request failed:", error.message);

    res.status(502).json({
      success: false,
      message: "뉴스 데이터를 가져오지 못했습니다.",
      items: [],
    });
  }
});

app.get("/api/youtube/search", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

  if (!query) {
    res.status(400).json({
      success: false,
      message: "검색어(q)가 필요합니다.",
    });
    return;
  }

  try {
    const videos = await fetchYoutubeVideos(query);

    res.json({
      success: true,
      keyword: query,
      count: videos.length,
      videos,
    });
  } catch (error) {
    console.error("YouTube search request failed:", error.message);

    res.status(502).json({
      success: false,
      message: "YouTube 데이터를 가져오지 못했습니다.",
      videos: [],
    });
  }
});

app.get("/api/youtube/trend", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

  if (!query) {
    res.status(400).json({
      success: false,
      message: "검색어(q)가 필요합니다.",
    });
    return;
  }

  try {
    const trend = await calculateYoutubeTrend(query);

    // 20-11: Supabase에 일별 트렌드(오늘=1d 기준)를 저장합니다. 저장이
    // 실패해도(Supabase 미설정, 네트워크 오류 등) /api/youtube/trend 응답
    // 자체는 정상적으로 반환해야 하므로, 이 블록만 별도로 try/catch해서
    // 실패를 로그로만 남기고 삼킵니다 - 위 catch(YouTube API 실패용)로
    // 전파되지 않습니다.
    try {
      await saveYoutubeDailyTrend({
        keyword: trend.keyword,
        collectedDate: toUtcDateString(trend.collectedAt),
        videoCount: trend.periods["1d"],
        capped: trend.capped["1d"],
      });
    } catch (saveError) {
      console.error("YouTube daily trend Supabase 저장 실패(응답에는 영향 없음):", saveError.message);
    }

    res.json({
      success: true,
      keyword: trend.keyword,
      collectedAt: trend.collectedAt,
      periods: trend.periods,
      capped: trend.capped,
      dataQuality: trend.dataQuality,
    });
  } catch (error) {
    console.error("YouTube trend request failed:", error.message);

    res.status(502).json({
      success: false,
      message: "YouTube 트렌드 데이터를 가져오지 못했습니다.",
      periods: null,
    });
  }
});

// Phase C-2: 아래 트렌드 조회 8개 엔드포인트는 로그인만 되어 있으면
// 누구나 호출 가능합니다(PRO 여부는 무관 - tier 차등은 /api/keywords의
// 개수 제한에만 적용됩니다, Phase C-1 참고). requireSupabaseUser()는
// Phase B에서 만든 헬퍼를 그대로 재사용합니다.
app.get("/api/youtube/trend-growth", async (req, res) => {
  const auth = await requireSupabaseUser(req, res);
  if (!auth) return;

  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

  if (!query) {
    res.status(400).json({
      success: false,
      message: "검색어(q)가 필요합니다.",
    });
    return;
  }

  try {
    const result = await calculateYoutubeTrendGrowth(query);
    const trendScore = calculateTrendScore(result.growth);

    // 21-2(2-3단계): AI 설명 생성/캐시 조회는 별도로 격리된 try 없이도
    // getOrCreateExplanation() 자체가 내부적으로 절대 throw하지 않도록
    // 설계되어 있습니다(모든 실패를 { explanation:null, error } 형태로
    // 반환) - 그래도 예기치 못한 예외에 대비해 한 번 더 감쌉니다.
    let explanation = null;
    try {
      const explanationResult = await getOrCreateExplanation({
        keyword: result.keyword,
        collectedDate: result.today.date,
        today: result.today,
        growth: result.growth,
        trendScore,
      });
      explanation = explanationResult.explanation;
      if (explanationResult.error) {
        console.error("YouTube trend explanation 실패(응답에는 영향 없음):", explanationResult.error);
      }
    } catch (explanationError) {
      console.error("YouTube trend explanation 예기치 못한 실패(응답에는 영향 없음):", explanationError.message);
    }

    res.json({
      success: true,
      keyword: result.keyword,
      today: result.today,
      growth: result.growth,
      trendScore,
      explanation,
    });
  } catch (error) {
    console.error("YouTube trend-growth request failed:", error.message);

    if (error.code === "trend_growth_no_data") {
      res.status(404).json({
        success: false,
        message: "해당 keyword의 수집 데이터가 없습니다.",
      });
      return;
    }

    res.status(502).json({
      success: false,
      message: "YouTube 트렌드 성장률을 계산하지 못했습니다.",
    });
  }
});

// 3-1단계: 뉴스 언급량(mentionCount) 일별 수집·저장 + 3/7/30일 성장률/
// Trend Score. YouTube와 달리 별도의 "/api/news/trend" 수집 전용 엔드포인트를
// 두지 않고, 이 엔드포인트 하나가 (1) RSS로 오늘자 mentionCount를 수집해
// news_daily_trends에 저장한 뒤 (2) 그 테이블에 쌓인 일별 데이터를 읽어
// 성장률/trendScore를 계산합니다. AI 설명(explanation) 기능은 이번 단계
// 범위에 포함하지 않습니다. calculateTrendScore()는 위에서 이미 import한
// (line 8) youtubeTrendGrowth.js의 것을 그대로 재사용합니다(복제하지 않음).
app.get("/api/news/trend-growth", async (req, res) => {
  const auth = await requireSupabaseUser(req, res);
  if (!auth) return;

  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

  if (!query) {
    res.status(400).json({
      success: false,
      message: "검색어(q)가 필요합니다.",
    });
    return;
  }

  try {
    const collected = await collectNewsDailyMentionCount(query);

    // YouTube 패턴과 동일하게, 저장 실패가 전체 응답을 502로 만들지 않도록
    // 별도로 격리합니다 - 다만 저장이 안 되면 아래 growth 계산이 오늘자
    // row를 못 찾아 trend_growth_no_data로 이어질 수 있습니다(정상적인
    // 연쇄 실패이며 별도로 숨기지 않습니다).
    try {
      await saveNewsDailyTrend({
        keyword: collected.keyword,
        collectedDate: toUtcNewsDateString(collected.collectedAt),
        mentionCount: collected.mentionCount,
        capped: collected.capped,
      });
    } catch (saveError) {
      console.error("News daily trend Supabase 저장 실패(응답에는 영향 없음):", saveError.message);
    }

    const result = await calculateNewsTrendGrowth(query);
    const trendScore = calculateTrendScore(result.growth);

    // 5-1단계: YouTube 라우트와 동일한 패턴 - calculateNewsTrendGrowth()로
    // 이미 row가 저장된 뒤(collectedDate = result.today.date) 호출하고,
    // getOrCreateNewsExplanation() 자체가 절대 throw하지 않지만 예기치
    // 못한 예외에 대비해 한 번 더 감쌉니다.
    let explanation = null;
    try {
      const explanationResult = await getOrCreateNewsExplanation({
        keyword: result.keyword,
        collectedDate: result.today.date,
        today: result.today,
        growth: result.growth,
        trendScore,
      });
      explanation = explanationResult.explanation;
      if (explanationResult.error) {
        console.error("News trend explanation 실패(응답에는 영향 없음):", explanationResult.error);
      }
    } catch (explanationError) {
      console.error("News trend explanation 예기치 못한 실패(응답에는 영향 없음):", explanationError.message);
    }

    res.json({
      success: true,
      keyword: result.keyword,
      today: result.today,
      growth: result.growth,
      trendScore,
      explanation,
    });
  } catch (error) {
    console.error("News trend-growth request failed:", error.message);

    if (error.code === "trend_growth_no_data") {
      res.status(404).json({
        success: false,
        message: "해당 keyword의 수집 데이터가 없습니다.",
      });
      return;
    }

    res.status(502).json({
      success: false,
      message: "뉴스 트렌드 성장률을 계산하지 못했습니다.",
    });
  }
});

// 3-2단계: 네이버 검색어트렌드(NAVER API HUB) 성장률/Trend Score. 3-2-0단계
// 조사에서 확인된 대로 ratio(상대 지수)는 요청마다 새로 계산되는 값이라
// YouTube/뉴스처럼 "일별 저장 후 비교"하지 않고, naverTrendGrowth.js가
// 매 요청마다 35일치를 통째로 조회해 그 안에서 비교합니다. getNaverTrendGrowth()는
// 네이버 API 호출 실패도 절대 throw하지 않고 { error: "naver_api_unavailable" }
// 형태로 반환하므로, 이 라우트는 그 경우에도 HTTP 200을 유지합니다(요청
// 지시사항의 Graceful Failure 요건).
app.get("/api/naver/trend-growth", async (req, res) => {
  const auth = await requireSupabaseUser(req, res);
  if (!auth) return;

  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

  if (!query) {
    res.status(400).json({
      success: false,
      message: "검색어(q)가 필요합니다.",
    });
    return;
  }

  try {
    const result = await getNaverTrendGrowth(query);

    // 5-1단계: getNaverTrendGrowth()는 API 실패도 throw하지 않고
    // { error: "naver_api_unavailable", ... } 형태로 정상 반환합니다
    // (naverTrendGrowth.js 참고) - 이 경우 row 자체가 없을 수 있으므로
    // explanation 함수를 아예 호출하지 않고 explanation: null 처리합니다
    // (지시사항 Part 3). result.error가 없을 때만 설명을 조회/생성합니다.
    if (result.error) {
      res.json({ ...result, explanation: null });
      return;
    }

    let explanation = null;
    try {
      const explanationResult = await getOrCreateNaverExplanation({
        keyword: result.keyword,
        cacheDate: result.requestedAt,
        today: { date: result.asOf },
        growth: result.growth,
        trendScore: result.trendScore,
      });
      explanation = explanationResult.explanation;
      if (explanationResult.error) {
        console.error("Naver trend explanation 실패(응답에는 영향 없음):", explanationResult.error);
      }
    } catch (explanationError) {
      console.error("Naver trend explanation 예기치 못한 실패(응답에는 영향 없음):", explanationError.message);
    }

    res.json({ ...result, explanation });
  } catch (error) {
    console.error("Naver trend-growth request failed:", error.message);

    res.status(502).json({
      success: false,
      message: "네이버 트렌드 성장률을 계산하지 못했습니다.",
    });
  }
});

// 3-3단계: YouTube/뉴스/네이버 세 소스의 Trend Score를 병렬로 모아 종합
// 점수로 합칩니다. getCompositeTrendScore()는 keyword 유효성 검증 실패만
// throw하고, 세 소스 중 무엇이 죽어도(throw/error) 절대 throw하지 않으므로
// (compositeTrendScore.js 참고) 이 라우트도 항상 HTTP 200을 유지합니다.
app.get("/api/trend-score", async (req, res) => {
  const auth = await requireSupabaseUser(req, res);
  if (!auth) return;

  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

  if (!query) {
    res.status(400).json({
      success: false,
      message: "검색어(q)가 필요합니다.",
    });
    return;
  }

  try {
    const result = await getCompositeTrendScore(query);

    // 5-1단계: 이 라우트는 AI를 호출하지 않습니다 - 오늘 날짜의
    // composite_trend_snapshots row에 scheduler.js가 이미 저장해둔
    // explanation이 있으면 그것만 읽어서 포함하고, 없으면 null입니다
    // (지시사항 Part 4). 조회 실패도 getTodayCompositeExplanation()이
    // 내부적으로 null로 흡수하므로 이 라우트의 성공/실패에 영향 없습니다.
    const todaySnapshotDate = new Date().toISOString().slice(0, 10);
    const explanation = await getTodayCompositeExplanation(result.keyword, todaySnapshotDate);

    res.json({ ...result, explanation });
  } catch (error) {
    console.error("Composite trend-score request failed:", error.message);

    res.status(502).json({
      success: false,
      message: "종합 트렌드 점수를 계산하지 못했습니다.",
    });
  }
});

// 4-2단계: 그래프용 원본 히스토리 조회 4종. 전부 단순 Supabase 조회
// 전용이며(계산 없음), 데이터가 없으면 빈 배열을 반환합니다(에러 아님) -
// trendHistoryApi.js의 각 함수가 이미 그렇게 동작합니다.
app.get("/api/youtube/trend-history", async (req, res) => {
  const auth = await requireSupabaseUser(req, res);
  if (!auth) return;

  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

  if (!query) {
    res.status(400).json({ success: false, message: "검색어(q)가 필요합니다." });
    return;
  }

  try {
    const history = await getYoutubeTrendHistory(query);
    res.json({ success: true, keyword: query, history });
  } catch (error) {
    console.error("YouTube trend-history request failed:", error.message);
    res.status(502).json({ success: false, message: "YouTube 히스토리를 가져오지 못했습니다." });
  }
});

app.get("/api/news/trend-history", async (req, res) => {
  const auth = await requireSupabaseUser(req, res);
  if (!auth) return;

  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

  if (!query) {
    res.status(400).json({ success: false, message: "검색어(q)가 필요합니다." });
    return;
  }

  try {
    const history = await getNewsTrendHistory(query);
    res.json({ success: true, keyword: query, history });
  } catch (error) {
    console.error("News trend-history request failed:", error.message);
    res.status(502).json({ success: false, message: "뉴스 히스토리를 가져오지 못했습니다." });
  }
});

app.get("/api/naver/trend-history", async (req, res) => {
  const auth = await requireSupabaseUser(req, res);
  if (!auth) return;

  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

  if (!query) {
    res.status(400).json({ success: false, message: "검색어(q)가 필요합니다." });
    return;
  }

  try {
    const history = await getNaverTrendHistory(query);
    res.json({ success: true, keyword: query, history });
  } catch (error) {
    console.error("Naver trend-history request failed:", error.message);
    res.status(502).json({ success: false, message: "네이버 히스토리를 가져오지 못했습니다." });
  }
});

app.get("/api/composite/trend-history", async (req, res) => {
  const auth = await requireSupabaseUser(req, res);
  if (!auth) return;

  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

  if (!query) {
    res.status(400).json({ success: false, message: "검색어(q)가 필요합니다." });
    return;
  }

  try {
    const history = await getCompositeTrendHistory(query);
    res.json({ success: true, keyword: query, history });
  } catch (error) {
    console.error("Composite trend-history request failed:", error.message);
    res.status(502).json({ success: false, message: "종합점수 히스토리를 가져오지 못했습니다." });
  }
});

app.get("/api/trends", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q : "AI";

  try {
    const { items, trends } = await collectTrends(query);

    // 실제 트렌드 데이터 기준 자동 Push 연결 (17-3).
    // 응답 속도에 영향을 주지 않도록 결과를 기다리지 않고 백그라운드로 실행합니다.
    // 자동 감시(18-1)가 같은 순간 이미 알림 검사를 진행 중이면, 동일한 트렌드에
    // 대해 두 검사가 겹쳐 중복 발송될 수 있으므로 이번 요청에서는 건너뜁니다.
    if (!isTrendMonitorRunning()) {
      checkTrendsAndNotify(trends).catch((error) => {
        console.error("Trend push check failed:", error.message);
      });
    }

    res.json({
      success: true,
      query: query.trim() || "AI",
      count: items.length,
      trends,
    });
  } catch (error) {
    console.error("Trend aggregation request failed:", error.message);

    res.status(502).json({
      success: false,
      message: "트렌드 데이터를 가져오지 못했습니다.",
      trends: [],
    });
  }
});

// 18-3: 기존 요청 형식(subscription 객체를 그대로 body로 보냄)과
// 새 요청 형식({ subscription, settings })을 모두 지원합니다.
// 같은 endpoint로 다시 호출하면 새로 추가되지 않고 기존 항목이 갱신되므로,
// 이 API를 "설정 업데이트" 용도로도 그대로 재사용할 수 있습니다(별도 API 불필요).
app.post("/api/push/subscribe", (req, res) => {
  const body = req.body || {};
  const subscription =
    body.subscription && typeof body.subscription === "object" ? body.subscription : body;
  const settings = body.settings;

  if (!isValidSubscription(subscription)) {
    return res.status(400).json({
      success: false,
      message: "유효하지 않은 Push Subscription 데이터입니다.",
    });
  }

  if (!isValidSettings(settings)) {
    return res.status(400).json({
      success: false,
      message: "유효하지 않은 알림 설정입니다.",
    });
  }

  try {
    saveSubscription(subscription, settings);

    res.status(201).json({
      success: true,
      message: "Push Subscription이 등록되었습니다.",
    });
  } catch (error) {
    console.error("Push subscription save failed:", error.message);

    res.status(500).json({
      success: false,
      message: "Push Subscription 저장 중 오류가 발생했습니다.",
    });
  }
});

app.delete("/api/push/subscribe", (req, res) => {
  const endpoint = req.body && typeof req.body.endpoint === "string" ? req.body.endpoint.trim() : "";

  if (endpoint.length === 0) {
    return res.status(400).json({
      success: false,
      message: "유효하지 않은 endpoint입니다.",
    });
  }

  try {
    const removed = removeSubscription(endpoint);

    res.json({
      success: true,
      removed,
      message: removed
        ? "Push Subscription이 삭제되었습니다."
        : "해당 endpoint의 Push Subscription을 찾을 수 없습니다.",
    });
  } catch (error) {
    console.error("Push subscription delete failed:", error.message);

    res.status(500).json({
      success: false,
      message: "Push Subscription 삭제 중 오류가 발생했습니다.",
    });
  }
});

app.get("/api/push/status", (req, res) => {
  res.json({
    success: true,
    vapidConfigured: isVapidConfigured,
    subscriptionCount: getSubscriptionCount(),
    // 개발 편의용: endpoint/keys는 절대 포함하지 않고 설정값만 노출합니다.
    subscriptionsWithSettings: getSubscriptionsSettingsSummary(),
  });
});

app.get("/api/push/vapid-public-key", (req, res) => {
  const publicKey = getVapidPublicKey();

  if (!publicKey) {
    return res.json({
      success: false,
      configured: false,
      publicKey: null,
    });
  }

  res.json({
    success: true,
    configured: true,
    publicKey,
  });
});

// 개발/테스트용 트리거 (17-3).
// body에 trends 배열을 직접 넣으면 그 데이터로, 없으면 실제 /api/trends와
// 동일한 방식으로 실시간 트렌드를 가져와 RISING_TREND 조건을 검사합니다.
app.post("/api/push/check-trends", async (req, res) => {
  try {
    const bodyTrends = Array.isArray(req.body?.trends) ? req.body.trends : null;
    const force = req.body?.force === true;

    let trends = bodyTrends;

    if (!trends) {
      const query = typeof req.body?.q === "string" ? req.body.q : "AI";
      const items = await fetchGoogleNews(query);
      trends = aggregateTrends(items, query);
    }

    // force는 이 개발/검증용 엔드포인트에서만 사용되며, GET /api/trends의
    // 자동 알림 경로(checkTrendsAndNotify(trends) 단일 인자 호출)에는 전달되지 않습니다.
    const result = await checkTrendsAndNotify(trends, { force });

    res.json(result);
  } catch (error) {
    console.error("Manual trend check failed:", error.message);

    res.status(500).json({
      success: false,
      status: "failed",
      message: "트렌드 확인 중 오류가 발생했습니다.",
    });
  }
});

app.post("/api/push/send-test", async (req, res) => {
  try {
    const result = await sendTestNotificationToAll(req.body);

    if (!result.success && result.status === "vapid_not_configured") {
      return res.status(503).json(result);
    }

    res.json(result);
  } catch (error) {
    console.error("Push send-test failed:", error.message);

    res.status(500).json({
      success: false,
      status: "failed",
      message: "Push 전송 중 오류가 발생했습니다.",
    });
  }
});

// 3-4단계: tracked_keywords 관리용 최소 CRUD 엔드포인트. 이 테이블에 값을
// 넣을 다른 방법이 없어서 추가합니다.
//
// Phase C: 세 라우트 모두 requireSupabaseUser()로 로그인을 필수로 바꿨고
// (Phase B에서 만든 헬퍼를 그대로 재사용, 아래 정의는 함수 선언이라
// 호이스팅되므로 이 위치에서 먼저 써도 됩니다), 본인 소유 키워드만
// 조회/삭제할 수 있습니다. POST는 추가로 무료 플랜 3개 제한을 검사합니다.
app.get("/api/keywords", async (req, res) => {
  const auth = await requireSupabaseUser(req, res);
  if (!auth) return;

  try {
    const keywords = await listTrackedKeywords(auth.userId);
    res.json({ success: true, keywords });
  } catch (error) {
    console.error("Keyword list request failed:", error.message);

    res.status(502).json({
      success: false,
      message: "키워드 목록을 가져오지 못했습니다.",
    });
  }
});

app.post("/api/keywords", async (req, res) => {
  const auth = await requireSupabaseUser(req, res);
  if (!auth) return;

  const keyword = typeof req.body?.keyword === "string" ? req.body.keyword.trim() : "";

  if (!keyword) {
    res.status(400).json({
      success: false,
      message: "keyword가 필요합니다.",
    });
    return;
  }

  try {
    const { data: profile, error: profileError } = await auth.client
      .from("user_profiles")
      .select("tier")
      .eq("id", auth.userId)
      .single();

    if (profileError) {
      console.error("Keyword add tier lookup failed:", profileError.message);
      res.status(502).json({
        success: false,
        message: "키워드를 등록하지 못했습니다.",
      });
      return;
    }

    if (profile?.tier !== "pro") {
      const activeCount = await countActiveTrackedKeywords(auth.userId);
      if (activeCount >= 3) {
        res.status(403).json({
          success: false,
          message: "무료 플랜은 키워드 3개까지 등록 가능합니다",
        });
        return;
      }
    }

    const added = await addTrackedKeyword(auth.userId, keyword);
    res.status(201).json({ success: true, keyword: added });
  } catch (error) {
    if (error.code === "keyword_already_exists") {
      res.status(409).json({
        success: false,
        message: "이미 등록된 키워드입니다.",
      });
      return;
    }

    console.error("Keyword add request failed:", error.message);

    res.status(502).json({
      success: false,
      message: "키워드를 등록하지 못했습니다.",
    });
  }
});

app.delete("/api/keywords/:id", async (req, res) => {
  const auth = await requireSupabaseUser(req, res);
  if (!auth) return;

  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({
      success: false,
      message: "유효한 id가 필요합니다.",
    });
    return;
  }

  try {
    const updated = await deactivateTrackedKeyword(auth.userId, id);

    if (!updated) {
      res.status(404).json({
        success: false,
        message: "해당 id의 키워드가 없습니다.",
      });
      return;
    }

    res.json({ success: true, keyword: updated });
  } catch (error) {
    console.error("Keyword deactivate request failed:", error.message);

    res.status(502).json({
      success: false,
      message: "키워드를 삭제하지 못했습니다.",
    });
  }
});

// Phase B: PRO 활성화(mock)를 클라이언트가 user_profiles.tier를 직접
// update하는 방식에서 서버 경유로 바꿉니다. Supabase SQL Editor에서
// user_profiles의 UPDATE 정책을 제거했으므로(수동 적용, 이 저장소에는
// 마이그레이션 파일 없음), 이제 service_role 키를 쓰는
// getSupabaseClient()만 tier를 바꿀 수 있습니다. 아직 실제 결제 검증은
// 없습니다 - "로그인만 하면 개발용으로 PRO 체험 가능"이라는 기존 취지는
// 그대로 유지하고, 경로만 서버 경유로 바뀝니다.
async function requireSupabaseUser(req, res) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ success: false, message: "로그인이 필요합니다." });
    return null;
  }

  const client = getSupabaseClient();
  if (!client) {
    res.status(503).json({ success: false, message: "서버 설정 오류입니다." });
    return null;
  }

  // 요청 본문/쿼리의 user id는 신뢰하지 않습니다 - 이 JWT 검증으로 얻은
  // id만 사용하므로, 타인의 id를 지정해서 호출하는 경로 자체가 없습니다.
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) {
    res.status(401).json({ success: false, message: "로그인이 필요합니다." });
    return null;
  }

  return { client, userId: data.user.id };
}

app.post("/api/pro/activate-mock", async (req, res) => {
  const auth = await requireSupabaseUser(req, res);
  if (!auth) return;

  const { error } = await auth.client
    .from("user_profiles")
    .update({ tier: "pro" })
    .eq("id", auth.userId);

  if (error) {
    console.error("PRO activate-mock 요청 실패:", error.message);
    res.status(502).json({ success: false, message: "PRO 활성화에 실패했어요." });
    return;
  }

  res.json({ success: true, tier: "pro" });
});

app.post("/api/pro/deactivate-mock", async (req, res) => {
  const auth = await requireSupabaseUser(req, res);
  if (!auth) return;

  const { error } = await auth.client
    .from("user_profiles")
    .update({ tier: "free" })
    .eq("id", auth.userId);

  if (error) {
    console.error("PRO deactivate-mock 요청 실패:", error.message);
    res.status(502).json({ success: false, message: "PRO 해제에 실패했어요." });
    return;
  }

  res.json({ success: true, tier: "free" });
});

// 4-1단계: spin-down 배포 환경(무료 티어 등, idle 시 프로세스가 내려갔다
// 요청이 와야 재기동됨)에서는 setInterval 기반 스케줄러(SCHEDULER_ENABLED)를
// 신뢰할 수 없으므로, 외부 크론 서비스(예: cron-job.org, GitHub Actions
// scheduled workflow 등)가 이 엔드포인트를 주기적으로 "깨우는" 방식으로
// 대체합니다. runScheduledCollection()/isRunning 플래그는 scheduler.js의
// 것을 그대로 재사용합니다(복제하지 않음) - SCHEDULER_ENABLED 인터벌 경로와
// 이 트리거 경로가 동시에 켜져 있어도 같은 isRunning 플래그를 공유하므로
// 중복 실행되지 않습니다.
app.post("/api/scheduler/trigger", (req, res) => {
  const providedSecret = req.headers["x-scheduler-secret"];
  const expectedSecret = process.env.SCHEDULER_SECRET;

  // SCHEDULER_SECRET이 아예 설정되지 않은 경우와 시크릿이 틀린 경우를
  // 응답에서 절대 구분하지 않습니다(둘 다 동일한 401) - 이 엔드포인트의
  // 존재/설정 여부 자체를 외부에서 유추할 수 없게 하기 위함입니다.
  if (
    !expectedSecret ||
    typeof providedSecret !== "string" ||
    providedSecret !== expectedSecret
  ) {
    res.status(401).json({ success: false, message: "인증에 실패했습니다." });
    return;
  }

  if (isSchedulerRunning()) {
    res.status(409).json({ success: false, message: "이미 실행 중입니다." });
    return;
  }

  const startedAt = new Date().toISOString();
  res.status(202).json({ status: "accepted", startedAt });

  // 응답을 먼저 보낸 뒤, 별도로(await 없이) 백그라운드에서 실행합니다.
  // 실패해도 이미 202를 응답했으므로 로그만 남깁니다 - 자격증명 값은
  // 각 소스 모듈이 이미 sanitize한 에러만 전달하므로 그대로 로그에 남겨도
  // 안전합니다(scheduler.js의 기존 원칙 그대로).
  runScheduledCollection().catch((error) => {
    console.error("Scheduler trigger 실행 실패(응답에는 이미 영향 없음):", error.message);
  });
});

// 4-2단계: dist/(React 빌드 결과물)가 있으면 정적으로 서빙하고, 없으면
// (로컬에서 npm run server만 단독 실행한 경우) 조용히 건너뜁니다 - 기존
// npm run dev + npm run server 분리 실행 흐름을 깨지 않기 위함입니다.
// 반드시 위의 모든 /api/* 라우트 등록 "이후"에 위치해야, 아래 catch-all이
// API 라우트를 가로채지 않습니다. Express 5는 문자열 와일드카드("*")
// 대신 이름 붙은 와일드카드를 요구하므로, 여기서는 RegExp를 직접 써서
// "/api/로 시작하지 않는 모든 GET 요청"만 index.html로 넘깁니다. /privacy는
// 위에서 이미 먼저 등록되어 있어 이 catch-all보다 우선 처리됩니다.
// __dirname은 파일 상단에서 이미 선언했습니다(/privacy 라우트와 공유).
const distPath = path.join(__dirname, "..", "dist");
const distIndexPath = path.join(distPath, "index.html");

if (fs.existsSync(distIndexPath)) {
  app.use(express.static(distPath));

  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(distIndexPath);
  });

  console.log("[Static] dist/ 발견 - React 빌드 결과물을 서빙합니다.");
} else {
  console.log("[Static] dist/ 없음 - API 전용 모드로 동작합니다(로컬 개발 시 정상).");
}

app.listen(port, () => {
  console.log(`WHAT'S TREND API listening on http://localhost:${port}`);
  console.log(
    `[VAPID] 설정 상태: ${isVapidConfigured ? "완료" : "미완료 (.env의 VAPID 값을 확인하세요)"}`
  );

  // 서버 시작 직후 자동 감시를 1회 실행합니다.
  // 이 시점엔 trendHistory가 비어있으므로 growthAvailable=false가 나오는 것이 정상입니다.
  runTrendMonitorCycle();

  // 이후 정확히 10분 간격으로 반복 실행합니다.
  // 4-1단계 참고: 이 setInterval도 spin-down 배포 환경에서는 위
  // SCHEDULER_ENABLED 인터벌과 같은 이유로 신뢰할 수 없습니다(News 감시
  // 자체가 이 프로젝트의 핵심 온디맨드 API에는 영향을 주지 않으므로
  // 지금 단계에서는 그대로 둡니다 - 필요해지면 이것도 외부 트리거로
  // 전환할 수 있습니다).
  setInterval(runTrendMonitorCycle, TREND_MONITOR_INTERVAL_MS);

  // 3-4단계: SCHEDULER_ENABLED가 정확히 "true"일 때만 스케줄러 인터벌을
  // 등록합니다(기본값 미설정 = 꺼짐). trendMonitor와 달리 서버 시작
  // 직후 즉시 실행(runScheduledCollection() 즉시 호출)하지 않습니다 -
  // 재시작할 때마다 네이버/YouTube 할당량이 바로 소모되는 것을 막기
  // 위함입니다(3-4단계 지시사항). 오직 아래 인터벌 주기(8시간)마다만
  // 실행됩니다.
  //
  // 4-1단계: 이 setInterval 경로는 spin-down 배포 환경(무료 티어처럼
  // idle 시 프로세스가 내려갔다 요청이 와야 재기동되는 방식)에서는
  // 신뢰할 수 없습니다(프로세스가 내려가 있는 동안 인터벌 자체가 멈춤).
  // 코드는 삭제하지 않고 그대로 남겨두되(유료 플랜 전환 시 재사용 가능),
  // **spin-down 환경에 배포할 때는 SCHEDULER_ENABLED를 계속 꺼둔 채로
  // 유지하세요** - 대신 POST /api/scheduler/trigger를 외부 크론
  // 서비스가 주기적으로 호출하는 방식을 씁니다(아래 라우트 참고).
  if (process.env.SCHEDULER_ENABLED === "true") {
    setInterval(runScheduledCollection, SCHEDULED_COLLECTION_INTERVAL_MS);
    console.log("[Scheduler] SCHEDULER_ENABLED=true - 8시간 간격 자동 수집이 등록되었습니다.");
  } else {
    console.log("[Scheduler] SCHEDULER_ENABLED가 설정되지 않아 자동 수집이 비활성화되어 있습니다.");
  }
});
