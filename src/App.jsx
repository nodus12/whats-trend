import {
  Fragment, useEffect, useMemo, useState } from "react";
import "./App.css";
import {
  fetchTrends } from "./api/trends.js";
import {
  addViewedTrend,
  addSavedTrend,
  removeSavedTrend,
  getPersonalizationData,
  updateInterests,
  setOnboardingCompleted,
  calculatePersonalizationScores,
  isTrendHidden,
} from "./utils/personalization.js";
import {
  getNotificationSettings,
  saveNotificationSettings,
  getUnreadNotificationCount,
} from "./utils/notifications.js";
import {
  initializePushNotifications,
  isServiceWorkerSupported,
  isPushSupported,
  getPushSubscription,
  enablePushNotifications,
  disablePushNotifications,
  syncNotificationSettingsToServer,
} from "./utils/pushNotifications.js";
import {
  fetchKeywords,
  addKeyword,
  deleteKeyword,
  fetchTrendScore,
  fetchYoutubeTrendGrowth,
  fetchNewsTrendGrowth,
  fetchNaverTrendGrowth,
  fetchYoutubeHistory,
  fetchNewsHistory,
  fetchNaverHistory,
  fetchCompositeHistory,
} from "./api/monitoring.js";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { supabase } from "./supabaseClient.js";
import { loadTossPayments } from "@tosspayments/tosspayments-sdk";
import { startBilling, confirmBilling } from "./api/subscription.js";

const categories = [
  "전체",
  "패션",
  "뷰티",
  "맛집/푸드",
  "쇼핑",
  "콘텐츠",
  "게임",
  "음악",
  "라이프",
  "여행",
  "테크",
];

const trends = [
  {
    category: "패션",
    title: "러닝화",
    description: "운동뿐 아니라 일상에서도 러닝화를 찾는 사람이 늘고 있어요.",
    growth: "+126%",
    daily: "+34/day",
    status: "상승 중",
    next: "높음",
    emoji: "👟",
    interest: 76,
    startDate: "2026.08.27",
    why: "편안함과 스타일을 동시에 챙길 수 있는 러닝화가 일상 패션으로 자연스럽게 들어오고 있어요.",
    platforms: ["Instagram", "TikTok", "YouTube Shorts"],
    hashtags: ["#러닝화", "#러닝", "#운동화", "#데일리룩"],
  },
  {
    category: "여행",
    title: "일본 소도시 여행",
    description: "도쿄와 오사카 대신 조용한 일본 여행지를 찾는 움직임.",
    growth: "+247%",
    daily: "+51/day",
    status: "폭발 직전",
    next: "매우 높음",
    emoji: "🗾",
    interest: 82,
    startDate: "2026.08.21",
    why: "사람이 몰리는 유명 관광지보다 나만 알고 싶은 새로운 여행지를 찾는 사람들이 늘어나고 있어요.",
    platforms: ["Instagram", "TikTok", "YouTube Shorts", "Threads"],
    hashtags: ["#일본여행", "#일본소도시", "#소도시여행", "#일본여행추천"],
  },
  {
    category: "라이프",
    title: "아침 러닝",
    description: "출근 전 가볍게 달리는 라이프스타일 콘텐츠가 증가하고 있어요.",
    growth: "+119%",
    daily: "+28/day",
    status: "상승 중",
    next: "높음",
    emoji: "🌅",
    interest: 71,
    startDate: "2026.08.30",
    why: "하루를 건강하게 시작하려는 사람들이 늘면서 출근 전 러닝과 루틴 콘텐츠가 함께 주목받고 있어요.",
    platforms: ["Instagram", "YouTube Shorts", "Threads"],
    hashtags: ["#아침러닝", "#러닝루틴", "#모닝루틴"],
  },
  {
    category: "뷰티",
    title: "글로우 베이스",
    description: "두꺼운 피부 표현보다 자연스러운 윤광 메이크업이 주목받는 중.",
    growth: "+168%",
    daily: "+42/day",
    status: "상승 중",
    next: "높음",
    emoji: "✨",
    interest: 78,
    startDate: "2026.08.24",
    why: "과한 메이크업보다 피부 본연의 느낌을 살리는 자연스러운 표현이 다시 관심을 받고 있어요.",
    platforms: ["Instagram", "TikTok", "YouTube Shorts"],
    hashtags: ["#글로우메이크업", "#윤광피부", "#베이스메이크업"],
  },
  {
    category: "쇼핑",
    title: "미니 선풍기",
    description: "휴대하기 좋은 작은 사이즈의 여름 아이템 검색량 증가.",
    growth: "+104%",
    daily: "+21/day",
    status: "초기 발견",
    next: "보통",
    emoji: "❄️",
    interest: 63,
    startDate: "2026.09.01",
    why: "휴대성과 실용성을 동시에 갖춘 작은 여름 아이템에 대한 관심이 올라가고 있어요.",
    platforms: ["Instagram", "TikTok"],
    hashtags: ["#미니선풍기", "#여름템", "#휴대용선풍기"],
  },
  {
    category: "콘텐츠",
    title: "퇴근 브이로그",
    description: "특별하지 않은 일상을 기록하는 짧은 영상이 다시 떠오르고 있어요.",
    growth: "+141%",
    daily: "+36/day",
    status: "상승 중",
    next: "높음",
    emoji: "🎥",
    interest: 74,
    startDate: "2026.08.26",
    why: "특별한 사건보다 현실적인 일상을 보여주는 콘텐츠에 공감하는 사람들이 늘고 있어요.",
    platforms: ["TikTok", "YouTube Shorts", "Instagram"],
    hashtags: ["#퇴근브이로그", "#직장인브이로그", "#일상브이로그"],
  },
];

function normalizeTrend(raw, index = 0) {
  const growthValue =
    typeof raw.growth === "string"
      ? raw.growth.replace(/[^0-9.-]/g, "")
      : raw.growth;

  return {
    id: raw.id ?? `trend-${index}`,
    title: raw.title ?? "새로운 트렌드",
    category: raw.category ?? "전체",

    growth: Number(growthValue ?? 0),

    daily: raw.daily ?? "+0/day",

    stage: raw.stage ?? raw.status ?? "초기 발견",

    next: raw.next ?? "보통",

    interest: Number(raw.interest ?? 0),

    startDate: raw.startDate ?? "",

    why:
      raw.why ??
      "최근 온라인과 SNS에서 관심이 증가하고 있는 트렌드입니다.",

    hashtags: Array.isArray(raw.hashtags)
      ? raw.hashtags
      : [],

    platforms: Array.isArray(raw.platforms)
      ? raw.platforms
      : [],

    description:
      raw.description ??
      `${raw.title ?? "새로운 트렌드"}에 대한 관심이 빠르게 증가하고 있어요.`,

    emoji: raw.emoji ?? "🔥",
  };
}

const normalizedTrends = trends.map((trend, index) =>
  normalizeTrend(trend, index)
);

function formatGrowth(growth) {
  if (growth === null || growth === undefined) {
    return "데이터 없음";
  }

  return `${growth >= 0 ? "+" : ""}${growth}%`;
}

function formatTrendValue(value) {
  return value === null || value === undefined || value === ""
    ? "데이터 없음"
    : value;
}

function normalizeApiTrend(apiTrend, query) {
  const keyword =
    typeof apiTrend?.keyword === "string" && apiTrend.keyword.trim()
      ? apiTrend.keyword.trim()
      : "새로운 트렌드";

  return {
    id:
      apiTrend?.id ??
      `api-${encodeURIComponent(query)}-${encodeURIComponent(keyword)}`,
    title: keyword,
    category: query || "전체",
    growth:
      typeof apiTrend?.growthRate === "number"
        ? apiTrend.growthRate
        : null,
    daily: null,
    stage: apiTrend?.stage ?? "초기 발견",
    stageEmoji: apiTrend?.stageEmoji ?? "🌱",
    next: null,
    interest: null,
    startDate: "",
    why: null,
    hashtags: [],
    platforms: [],
    description: "",
    emoji: apiTrend?.stageEmoji ?? "✦",
    mentionCount: apiTrend?.mentionCount ?? null,
    recentMentionCount: apiTrend?.recentMentionCount ?? null,
    previousMentionCount: apiTrend?.previousMentionCount ?? null,
    relevanceScore: apiTrend?.relevanceScore ?? null,
    growthRate: apiTrend?.growthRate ?? null,
    growthAvailable: apiTrend?.growthAvailable ?? false,
    nextScore: apiTrend?.nextScore ?? null,
    nextLevel: apiTrend?.nextLevel ?? null,
    nextAvailable: apiTrend?.nextAvailable ?? false,
    aiAnalysis: apiTrend?.aiAnalysis ?? null,
    articles: Array.isArray(apiTrend?.articles)
      ? apiTrend.articles
      : [],
  };
}

// 6-1단계: HOT/RISING/NEXT 후보 풀을 만들 때 쓰는 고정 카테고리 세트입니다.
// HomePage의 "FOR YOU" 섹션이 쓰는 개인화 카테고리(관심사 없으면
// ["패션","뷰티","여행","테크"], 4개 병렬 호출)와는 별개로, 항상 같은
// 일반 카테고리를 씁니다 - categories 배열(위)에 실제로 존재하는 문자열만
// 사용합니다.
//
// 2개만 쓰는 이유(실측 기반 판단): 처음엔 4개로 만들었는데, FOR YOU의
// 4개와 합쳐 홈 진입 시 총 8개의 /api/trends를 동시에 호출하게 되어
// 크롬의 오리진당 동시 연결 제한(6개)을 넘겨버렸습니다. 그 결과 뒤로
// 밀린 요청이 앞 요청이 끝날 때까지(각 /api/trends 호출 자체가 RSS
// 수집 때문에 ~10초 이상 걸림) 대기하면서 실측 24초까지 로딩이
// 걸리는 걸 Playwright로 직접 확인했습니다. 2개로 줄이면 FOR YOU의
// 4개와 합쳐 정확히 6개라 전부 진짜 병렬로 실행되어 첫 배치(~11-12초)
// 안에 끝납니다 - 그래도 느린 편이라 캐싱 등 근본적인 개선은 별도
// 후속 과제로 남겨둡니다.
const HOME_FEED_CATEGORIES = ["맛집/푸드", "라이프"];

// 6-1단계: HOT/RISING/NEXT 분류 로직을 이 함수 한 곳에 모아둡니다. 지금은
// mentionCount/growthRate만 쓰지만, 추후 multiSignalScore/
// earlySignalScore/네이버 검색 트렌드 등을 candidates 항목에 필드로 추가로
// 실어 보내고, 이 함수의 정렬 기준만 확장하면 새 신호를 반영할 수 있도록
// 설계했습니다(다른 곳을 고칠 필요 없음).
//
// 각 섹션 최대 3개, 부족하면 있는 만큼만 반환합니다(개수를 억지로 채우지
// 않음 - Part 4의 "친화적 빈 상태" 처리와 짝을 이룹니다). 한 트렌드가
// 여러 섹션에 중복으로 뽑히지 않도록 already-picked id를 추적합니다.
function classifyHomeFeedTrends(candidates) {
  const used = new Set();

  function take(sorted, max) {
    const picked = [];
    for (const trend of sorted) {
      if (picked.length >= max) break;
      if (used.has(trend.id)) continue;
      picked.push(trend);
      used.add(trend.id);
    }
    return picked;
  }

  // HOT: mentionCount(언급량) 상위.
  const byMentionCount = [...candidates].sort(
    (a, b) => (b.mentionCount ?? 0) - (a.mentionCount ?? 0)
  );
  const hot = take(byMentionCount, 3);

  // RISING: growthRate가 있고 양수인 것 우선, growthRate 데이터가 없으면
  // mentionCount 차순위로 보충(실측 결과 growthRate가 null인 경우가
  // 많아서 이 보충 규칙이 실제로 자주 쓰임).
  const byGrowth = [...candidates].sort((a, b) => {
    const aPositive = a.growthRate !== null && a.growthRate > 0;
    const bPositive = b.growthRate !== null && b.growthRate > 0;
    if (aPositive && bPositive) return b.growthRate - a.growthRate;
    if (aPositive) return -1;
    if (bPositive) return 1;
    return (b.mentionCount ?? 0) - (a.mentionCount ?? 0);
  });
  const rising = take(byGrowth, 3);

  // NEXT: 위 두 섹션에 뽑히지 않은 나머지 중 mentionCount 상위.
  const next = take(byMentionCount, 3);

  return { hot, rising, next };
}

const affiliateProducts = [
  {
    id: "fashion-linen-shirt",
    title: "린넨 오버핏 셔츠",
    price: "29,900원",
    image: "👕",
    rating: "4.8",
    platform: "WHAT'S TREND PICKS",
    affiliateUrl: "#",
    category: "패션",
  },
  {
    id: "travel-packing-cube",
    title: "여행용 패킹 큐브 세트",
    price: "18,900원",
    image: "🧳",
    rating: "4.7",
    platform: "WHAT'S TREND PICKS",
    affiliateUrl: "#",
    category: "여행",
  },
  {
    id: "life-running-bottle",
    title: "러닝 보온보냉 텀블러",
    price: "24,900원",
    image: "🥤",
    rating: "4.9",
    platform: "WHAT'S TREND PICKS",
    affiliateUrl: "#",
    category: "라이프",
  },
  {
    id: "beauty-glow-base",
    title: "글로우 베이스 쿠션",
    price: "32,000원",
    image: "✨",
    rating: "4.8",
    platform: "WHAT'S TREND PICKS",
    affiliateUrl: "#",
    category: "뷰티",
  },
  {
    id: "shopping-mini-fan",
    title: "휴대용 미니 선풍기",
    price: "19,800원",
    image: "❄️",
    rating: "4.6",
    platform: "WHAT'S TREND PICKS",
    affiliateUrl: "#",
    category: "쇼핑",
  },
  {
    id: "content-desk-light",
    title: "브이로그 데스크 조명",
    price: "39,900원",
    image: "💡",
    rating: "4.7",
    platform: "WHAT'S TREND PICKS",
    affiliateUrl: "#",
    category: "콘텐츠",
  },
];

function Logo() {
  return (
    <div className="logo-wrap">
      <div className="logo-mark">
        <span>W</span>
        <i />
      </div>

      <div className="logo-text">
        <strong>왓츠트렌드</strong>
        <small>WHAT'S TREND</small>
      </div>
    </div>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M3 10.8 12 3l9 7.8" />
      <path d="M5.5 9.5V21h13V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="m16 16 5 5" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M6 4.5A2.5 2.5 0 0 1 8.5 2h7A2.5 2.5 0 0 1 18 4.5V21l-6-3.5L6 21V4.5Z" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 21c.8-4 3.1-6 7-6s6.2 2 7 6" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M4 20V10" />
      <path d="M11 20V4" />
      <path d="M18 20v-7" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M5 12h13" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="m8.3 10.8 7.4-4.4" />
      <path d="m8.3 13.2 7.4 4.4" />
    </svg>
  );
}

function AdPlaceholder() {
  return (
    <div className="ad-placeholder" aria-label="광고 영역">
      <span>ADVERTISEMENT</span>
    </div>
  );
}

function TrendPicks({ trend }) {
  const products = useMemo(
    () =>
      affiliateProducts.filter(
        (product) => product.category === trend.category
      ),
    [trend.category]
  );

  if (products.length === 0) {
    return null;
  }

  return (
    <section className="trend-picks">
      <div className="detail-section-title">
        <div>
          <span className="section-label">TREND PICKS</span>
          <h2>지금 뜨는 {trend.category} 아이템</h2>
        </div>
      </div>

      <div className="trend-picks-card">
        {products.map((product) => (
          <div className="trend-pick-item" key={product.id}>
            <div className="trend-pick-image" aria-hidden="true">
              {product.image}
            </div>

            <div className="trend-pick-info">
              <span>{product.platform}</span>
              <h3>{product.title}</h3>
              <div className="trend-pick-meta">
                <strong>★ {product.rating}</strong>
                <b>{product.price}</b>
              </div>
            </div>

            <a
              className="trend-pick-link"
              href={product.affiliateUrl}
              onClick={(event) => {
                event.preventDefault();
                alert("제휴 상품 연결은 다음 단계에서 연결합니다.");
              }}
            >
              상품 보러가기
              <ArrowIcon />
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatNextLevel(nextLevel, nextAvailable) {
  if (!nextAvailable || !nextLevel) {
    return "데이터 부족";
  }
  return nextLevel;
}

// 6-4단계: DetailPage의 "TREND STAGE" 진행바가 실제 trend.stage 값에
// 따라 활성 단계를 찾을 때 쓰는 순서/문구입니다. 의미는 CLAUDE.md
// 22번 섹션에 정의된 5단계를 그대로 따르고, 아이콘은 기존 UI에서
// 쓰던 것(🌱/📈/🔥/💤/📉)을 그대로 유지합니다.
const STAGE_DEFINITIONS = [
  {
    label: "초기 발견",
    emoji: "🌱",
    headline: "이제 막 신호가 등장하기 시작했어요.",
    message: "아직 관심이 크지 않지만, 새로운 신호가 처음 감지된 단계예요.",
  },
  {
    label: "상승 중",
    emoji: "📈",
    headline: "지금이 가장 중요한 구간이에요.",
    message: "대중적으로 크게 퍼지기 전에 상승 신호가 빠르게 나타나고 있어요.",
  },
  {
    label: "폭발 직전",
    emoji: "🔥",
    headline: "빠르게 확산될 가능성이 나타나고 있어요.",
    message: "다만 실제 폭발적 확산을 보장하는 것은 아니에요.",
  },
  {
    label: "지속",
    emoji: "💤",
    headline: "높은 관심이 꾸준히 유지되고 있어요.",
    message: "일정한 수준의 관심이 계속 이어지고 있는 상태예요.",
  },
  {
    label: "하락",
    emoji: "📉",
    headline: "관심이 줄어들고 있어요.",
    message: "이전보다 언급량/관심도가 감소하는 추세예요.",
  },
];

function formatNextScore(nextScore, nextAvailable) {
  if (!nextAvailable || nextScore === null || nextScore === undefined) {
    return null;
  }
  if (typeof nextScore !== "number" || Number.isNaN(nextScore) || !Number.isFinite(nextScore)) {
    return null;
  }
  return `${nextScore} / 100`;
}

function TrendCard({ trend, onClick, saved, onSave }) {
  return (
    <article className="explore-trend-card" onClick={onClick}>
      <div className="explore-card-top">
        <div className="explore-emoji">{trend.emoji}</div>

        <button
          className={`card-bookmark ${saved ? "saved" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onSave(trend);
          }}
        >
          <BookmarkIcon />
        </button>
      </div>

      <span className="explore-category">{trend.category}</span>

      <h3>{trend.title}</h3>

      {/* 6-5단계: description/daily는 실API에 없는 필드라(항상 null/빈
          문자열) "데이터 없음" 대신 줄 자체를 숨깁니다 - 6-3단계에서
          DetailPage에 적용한 것과 동일한 판단 기준입니다. .explore-stats는
          flex 레이아웃이라 항목 하나를 안 그려도 빈 칸이 남지 않습니다. */}
      {trend.description && <p>{trend.description}</p>}

      {/* growthAvailable이 false인 경우(실측상 약 5%) trend.growth가
          null이라 formatGrowth()가 "데이터 없음"을 반환합니다 - 이 역시
          같은 원칙으로 숨깁니다. growth/daily가 둘 다 없으면 빈 박스가
          남지 않도록 바깥 wrapper 자체도 조건부로 렌더링합니다. */}
      {(trend.growth !== null && trend.growth !== undefined || trend.daily) && (
        <div className="explore-stats">
          {trend.growth !== null && trend.growth !== undefined && (
            <div>
              <span>관심도</span>
              <strong>{formatGrowth(trend.growth)}</strong>
            </div>
          )}

          {trend.daily && (
            <div>
              <span>오늘 상승</span>
              <strong>{trend.daily}</strong>
            </div>
          )}
        </div>
      )}

      {/* 6-6단계: nextAvailable이 false인 경우(실측상 드묾, ~5%)
          formatNextLevel()이 "데이터 부족"을 반환합니다 - NEXT 자체는
          API에 실제로 존재하는 필드지만(6-3단계 확인), 값이 없는 이
          경우엔 growth/daily와 동일한 원칙으로 줄 자체를 숨깁니다.
          값이 있을 때(nextAvailable:true)는 그대로 표시합니다. */}
      {trend.nextAvailable && (
        <div className="next-row">
          <span>🔮 NEXT</span>
          <strong>{formatNextLevel(trend.nextLevel, trend.nextAvailable)}</strong>
        </div>
      )}

      {trend.nextAvailable && trend.nextScore !== null && trend.nextScore !== undefined && (
        <div className="next-score-row">
          <span>{formatNextScore(trend.nextScore, trend.nextAvailable)}</span>
        </div>
      )}

      {/* AI Insight Preview */}
      {trend.aiAnalysis && trend.aiAnalysis.status === "completed" && (
        <div className="trend-ai-preview">
          <span className="trend-ai-label">AI INSIGHT</span>
          <p className="trend-ai-text">
            {trend.aiAnalysis.attentionReason || trend.aiAnalysis.summary || trend.aiAnalysis.trendInterpretation}
          </p>
        </div>
      )}
      {trend.aiAnalysis && trend.aiAnalysis.status === "insufficient_data" && (
        <div className="trend-ai-preview">
          <span className="trend-ai-label">AI INSIGHT</span>
          <p className="trend-ai-text">아직 분석에 필요한 데이터가 충분하지 않아요.</p>
        </div>
      )}
    </article>
  );
}

function OnboardingPage({ onComplete, onSkip }) {
  const [selectedCategories, setSelectedCategories] = useState([]);
  const maxCategories = getMaxOnboardingCategories();

  const allCategories = [
    { id: "패션", emoji: "👕" },
    { id: "뷰티", emoji: "💄" },
    { id: "맛집/푸드", emoji: "🍜" },
    { id: "쇼핑", emoji: "🛍️" },
    { id: "콘텐츠", emoji: "🎬" },
    { id: "게임", emoji: "🎮" },
    { id: "음악", emoji: "🎵" },
    { id: "라이프", emoji: "🌿" },
    { id: "여행", emoji: "✈️" },
    { id: "테크", emoji: "💻" },
  ];

  const toggleCategory = (categoryId) => {
    setSelectedCategories((current) => {
      if (current.includes(categoryId)) {
        return current.filter((c) => c !== categoryId);
      }
      if (current.length >= maxCategories) {
        return current;
      }
      return [...current, categoryId];
    });
  };

  const handleComplete = () => {
    updateInterests(selectedCategories);
    setOnboardingCompleted();
    onComplete();
  };

  const handleSkip = () => {
    setOnboardingCompleted();
    onSkip();
  };

  return (
    <div className="onboarding-page">
      <div className="onboarding-container">
        <div className="onboarding-header">
          <Logo />
        </div>

        <div className="onboarding-content">
          <h1 className="onboarding-title">어떤 트렌드가 궁금하세요?</h1>
          <p className="onboarding-subtitle">
            관심 있는 분야를 선택하면
            <br />
            당신에게 맞는 트렌드를 먼저 보여드릴게요.
          </p>

          <div className="onboarding-categories">
            {allCategories.map((category) => (
              <button
                key={category.id}
                className={`onboarding-category ${selectedCategories.includes(category.id) ? "selected" : ""}`}
                onClick={() => toggleCategory(category.id)}
                disabled={!selectedCategories.includes(category.id) && selectedCategories.length >= maxCategories}
              >
                <span className="category-emoji">{category.emoji}</span>
                <span className="category-name">{category.id}</span>
                {selectedCategories.includes(category.id) && (
                  <span className="category-check">✓</span>
                )}
              </button>
            ))}
          </div>

          <p className="onboarding-count">
            {selectedCategories.length} / {maxCategories}
          </p>

          {selectedCategories.length >= maxCategories && (
            <p className="onboarding-hint">관심사는 최대 5개까지 선택할 수 있어요.</p>
          )}
        </div>

        <div className="onboarding-actions">
          <button
            className="onboarding-primary"
            onClick={handleComplete}
            disabled={selectedCategories.length === 0}
          >
            내 트렌드 시작하기
          </button>
          <button className="onboarding-skip" onClick={handleSkip}>
            건너뛰기
          </button>
        </div>
      </div>
    </div>
  );
}

function HomePage({ onSelectTrend, onExplore, isPro }) {
  const [personalizedTrends, setPersonalizedTrends] = useState([]);
  const [personalizedLoading, setPersonalizedLoading] = useState(false);
  const [personalizedError, setPersonalizedError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchPersonalizedTrends() {
      setPersonalizedLoading(true);
      setPersonalizedError(false);

      try {
        const personalizationData = getPersonalizationData();
        const userCategories = personalizationData.interests.categories || [];

        const categoriesToFetch =
          userCategories.length > 0
            ? userCategories.slice(0, 4)
            : ["패션", "뷰티", "여행", "테크"];

        const allResults = await Promise.allSettled(
          categoriesToFetch.map((cat) => fetchTrends(cat))
        );

        const successfulResults = allResults
          .filter((r) => r.status === "fulfilled")
          .map((r) => r.value);

        const trendMap = new Map();
        for (const result of successfulResults) {
          if (result.trends) {
            for (const trend of result.trends) {
              const normalized = normalizeApiTrend(trend, result.query || "추천");
              if (!trendMap.has(normalized.id)) {
                trendMap.set(normalized.id, normalized);
              }
            }
          }
        }

        const combinedTrends = Array.from(trendMap.values());

        if (!cancelled) {
          const scoredTrends = calculatePersonalizationScores(
            combinedTrends,
            personalizationData
          );

          const visibleTrends = scoredTrends.filter(
            (t) => !isTrendHidden(t, personalizationData)
          );

          const sorted = visibleTrends.sort((a, b) => {
            const scoreDiff = (b.personalizationScore || 0) - (a.personalizationScore || 0);
            if (scoreDiff !== 0) return scoreDiff;
            const nextA = a.nextScore || 0;
            const nextB = b.nextScore || 0;
            if (nextB !== nextA) return nextB - nextA;
            const growthA = a.growthRate || 0;
            const growthB = b.growthRate || 0;
            if (growthB !== growthA) return growthB - growthA;
            return (b.mentionCount || 0) - (a.mentionCount || 0);
          });

          setPersonalizedTrends(sorted.slice(0, 3));
          setPersonalizedLoading(false);
        }
      } catch {
        if (!cancelled) {
          setPersonalizedError(true);
          setPersonalizedLoading(false);
        }
      }
    }

    fetchPersonalizedTrends();

    return () => {
      cancelled = true;
    };
  }, []);

  // 6-1단계: HOT/RISING/NEXT 후보 풀. FOR YOU 섹션과 같은 병렬 호출 +
  // Promise.allSettled 패턴을 쓰되, 완전히 별개의 state/effect입니다(FOR
  // YOU 쪽 로직은 위에서 전혀 건드리지 않았습니다) - 카테고리 중 일부가
  // 실패하거나 빈 배열을 반환해도 나머지 성공한 카테고리의 결과만으로
  // 후보 풀을 만들기 때문에, 개별 카테고리 실패가 전체를 막지 않습니다.
  const [homeFeedCandidates, setHomeFeedCandidates] = useState([]);
  const [homeFeedLoading, setHomeFeedLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchHomeFeedCandidates() {
      setHomeFeedLoading(true);

      const allResults = await Promise.allSettled(
        HOME_FEED_CATEGORIES.map((cat) => fetchTrends(cat))
      );

      const successfulResults = allResults
        .filter((r) => r.status === "fulfilled")
        .map((r) => r.value);

      const trendMap = new Map();
      for (const result of successfulResults) {
        if (result.trends) {
          for (const trend of result.trends) {
            const normalized = normalizeApiTrend(trend, result.query || "추천");
            if (!trendMap.has(normalized.id)) {
              trendMap.set(normalized.id, normalized);
            }
          }
        }
      }

      if (!cancelled) {
        setHomeFeedCandidates(Array.from(trendMap.values()));
        setHomeFeedLoading(false);
      }
    }

    fetchHomeFeedCandidates();

    return () => {
      cancelled = true;
    };
  }, []);

  const personalizedIds = new Set(personalizedTrends.map((t) => t.id));
  const homeFeedAfterDedup = homeFeedCandidates.filter((t) => !personalizedIds.has(t.id));
  const { hot: hotTrends, rising: risingTrends, next: nextTrends } =
    classifyHomeFeedTrends(homeFeedAfterDedup);

  const personalizationData = getPersonalizationData();
  const hasInterests = personalizationData.interests.categories.length > 0;

  return (
    <div className="content home-page">

      {/* HERO */}
      <section className="home-hero">
        <div className="home-hero-orb orb-one" />
        <div className="home-hero-orb orb-two" />

        <div className="home-hero-content">
          <div className="home-eyebrow">
            <span className="live-dot" />
            TREND RADAR · TODAY
          </div>

          <h1>
            지금 뭐가
            <br />
            <span>뜨고 있어?</span>
          </h1>

          <p>
            이미 유행한 것 말고,
            <br />
            지금 막 움직이기 시작한 것을 발견하세요.
          </p>

          <button
            className="home-search-button"
            onClick={onExplore}
          >
            <SearchIcon />
            <span>뭐가 궁금하세요?</span>
            <ArrowIcon />
          </button>
        </div>
      </section>

      {/* CATEGORY */}
      <section className="home-category-section">
        <div className="home-section-heading">
          <div>
            <span className="section-label">EXPLORE</span>
            <h2>관심 분야</h2>
          </div>

          <button
            className="text-button"
            onClick={onExplore}
          >
            전체보기
            <ArrowIcon />
          </button>
        </div>

        <div className="home-category-grid">
          {categories.slice(1, 7).map((category, index) => (
            <button
              key={category}
              onClick={onExplore}
              className="home-category-item"
            >
              <span className="home-category-icon">
                {["👕", "💄", "🍜", "🛍️", "🎬", "🎮"][index]}
              </span>

              <span>{category}</span>
            </button>
          ))}
        </div>
      </section>

      {/* PERSONALIZED RECOMMENDATIONS */}
      <section className="home-section home-personalized-section">
        <div className="home-section-heading">
          <div>
            <span className="section-label">FOR YOU</span>
            <h2>
              {hasInterests
                ? "오늘 당신이 주목할 트렌드"
                : "오늘 주목할 트렌드"}
            </h2>
          </div>
          <div className="personalized-badge">✦ 맞춤</div>
        </div>

        {personalizedLoading ? (
          <div className="home-personalized-loading">
            <div className="loading-spinner small">✦</div>
            <p>당신에게 맞는 트렌드를 찾고 있어요...</p>
          </div>
        ) : personalizedError ? (
          <div className="home-personalized-empty">
            <p>맞춤 트렌드를 불러오지 못했어요.</p>
          </div>
        ) : personalizedTrends.length === 0 ? (
          <div className="home-personalized-empty">
            <p>지금 맞춤 추천을 준비 중이에요.</p>
          </div>
        ) : (
          <div className="home-personalized-list">
            {personalizedTrends.map((trend) => (
              <article
                className="home-personalized-card"
                key={trend.id}
                onClick={() => onSelectTrend(trend)}
              >
                <div className="personalized-card-top">
                  <span className="personalized-card-emoji">{trend.emoji}</span>
                  <span className="personalized-card-category">{trend.category}</span>
                </div>
                <h3>{trend.title}</h3>
                {trend.stage && <p className="personalized-card-stage">{trend.stage}</p>}
                {trend.growthAvailable && trend.growthRate !== null && (
                  <span className="personalized-card-growth">{formatGrowth(trend.growthRate)}</span>
                )}
                {trend.personalizationReasons && trend.personalizationReasons.length > 0 && (
                  <div className="personalized-card-reasons">
                    {trend.personalizationReasons.slice(0, 1).map((reason, idx) => (
                      <span key={idx} className="personalized-card-reason">
                        {reason}
                      </span>
                    ))}
                  </div>
                )}
                {trend.nextAvailable && trend.nextScore !== null && (
                  <div className="personalized-card-next">
                    <span>🔮 NEXT</span>
                    <strong>{formatNextScore(trend.nextScore, trend.nextAvailable)}</strong>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {/* HOT */}
      <section className="home-section">
        <div className="home-section-heading">
          <div>
            <span className="section-label">TRENDING NOW</span>

            <h2>
              지금 가장
              <br />
              <span>뜨거운 트렌드</span>
            </h2>
          </div>

          <div className="home-hot-badge">
            🔥 LIVE
          </div>
        </div>

        {/* 6-1단계: HOT/RISING/NEXT 셋 다 같은 homeFeedLoading을 공유합니다
            (한 번의 병렬 호출 결과를 셋으로 나눠 쓰는 구조라 로딩도 함께
            끝남) - 로딩 중이 아닌데 해당 섹션 결과가 0개면 에러처럼 보이지
            않는 친화적 빈 상태 문구를 보여줍니다(.monitoring-empty 재사용). */}
        <div className="home-hot-list">
          {homeFeedLoading ? (
            <div className="monitoring-empty">불러오는 중...</div>
          ) : hotTrends.length === 0 ? (
            <div className="monitoring-empty">아직 표시할 트렌드가 없어요.</div>
          ) : (
            hotTrends.map((trend, index) => (
              <article
                className={`home-hot-card ${
                  index === 0 ? "featured" : ""
                }`}
                key={trend.id}
                onClick={() => onSelectTrend(trend)}
              >
                <div className="home-hot-number">
                  0{index + 1}
                </div>

                <div className="home-hot-main">
                  <div className="home-hot-top">
                    <span>{trend.category}</span>

                    <span className="home-status">
                      {trend.stage}
                    </span>
                  </div>

                  <h3>{trend.title}</h3>

                  {trend.description && <p>{trend.description}</p>}

                  {(trend.growth !== null && trend.growth !== undefined || trend.daily) && (
                    <div className="home-growth">
                      {trend.growth !== null && trend.growth !== undefined && (
                        <strong>{formatGrowth(trend.growth)}</strong>
                      )}

                      {trend.daily && (
                        <span>
                          오늘 {trend.daily}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="home-hot-emoji">
                  {trend.emoji}
                </div>

                <ArrowIcon />
              </article>
            ))
          )}
        </div>
      </section>

      {/* RISING */}
      <section className="home-section">
        <div className="home-section-heading">
          <div>
            <span className="section-label">EARLY SIGNAL</span>

            <h2>
              지금 막
              <br />
              <span>뜨기 시작한 것</span>
            </h2>
          </div>

          <div className="rising-label">
            ↗ 빠르게 상승
          </div>
        </div>

        <div className="home-rising-grid">
          {homeFeedLoading ? (
            <div className="monitoring-empty">불러오는 중...</div>
          ) : risingTrends.length === 0 ? (
            <div className="monitoring-empty">아직 표시할 트렌드가 없어요.</div>
          ) : (
            risingTrends.map((trend) => (
              <article
                className="home-rising-card"
                key={trend.id}
                onClick={() => onSelectTrend(trend)}
              >
                <div className="rising-card-top">
                  <div className="rising-emoji">
                    {trend.emoji}
                  </div>

                  <span>{trend.category}</span>
                </div>

                <h3>{trend.title}</h3>

                {trend.description && <p>{trend.description}</p>}

                {(trend.growth !== null && trend.growth !== undefined || trend.daily) && (
                  <div className="rising-bottom">
                    {trend.growth !== null && trend.growth !== undefined && (
                      <strong>{formatGrowth(trend.growth)}</strong>
                    )}

                    {trend.daily && (
                      <span>
                        {trend.daily}
                      </span>
                    )}
                  </div>
                )}
              </article>
            ))
          )}
        </div>
      </section>

      {!isPro && <AdPlaceholder />}

      {/* NEXT - 6-1단계: 하드코딩된 단일 카드 대신 실제 후보 풀에서
          HOT/RISING에 안 뽑힌 나머지 상위 항목을 보여줍니다. 카드 UI는
          새로 안 만들고 RISING과 동일한 카드(home-rising-card)를 그대로
          재사용합니다. */}
      <section className="home-next-section">
        <div className="home-next-glow" />

        <div className="home-next-header">
          <div>
            <span className="section-label">
              WHAT'S NEXT
            </span>

            <h2>
              다음에 뜰 가능성이 높은
              <br />
              <span>트렌드</span>
            </h2>
          </div>

          <div className="pro-small-badge">
            PRO
          </div>
        </div>

        <div className="home-rising-grid">
          {homeFeedLoading ? (
            <div className="monitoring-empty">불러오는 중...</div>
          ) : nextTrends.length === 0 ? (
            <div className="monitoring-empty">아직 표시할 트렌드가 없어요.</div>
          ) : (
            nextTrends.map((trend) => (
              <article
                className="home-rising-card"
                key={trend.id}
                onClick={() => onSelectTrend(trend)}
              >
                <div className="rising-card-top">
                  <div className="rising-emoji">
                    {trend.emoji}
                  </div>

                  <span>{trend.category}</span>
                </div>

                <h3>{trend.title}</h3>

                {trend.description && <p>{trend.description}</p>}

                {(trend.growth !== null && trend.growth !== undefined || trend.daily) && (
                  <div className="rising-bottom">
                    {trend.growth !== null && trend.growth !== undefined && (
                      <strong>{formatGrowth(trend.growth)}</strong>
                    )}

                    {trend.daily && (
                      <span>
                        {trend.daily}
                      </span>
                    )}
                  </div>
                )}
              </article>
            ))
          )}
        </div>

        <button
          className="next-more-button"
          onClick={onExplore}
        >
          PRO에서 NEXT 트렌드 전체 보기
          <ArrowIcon />
        </button>
      </section>

      {/* DISCOVERY */}
      <section className="home-discovery">
        <div className="discovery-icon">
          ✦
        </div>

        <div>
          <span>오늘의 발견</span>

          <h3>
            특별한 여행보다
            <br />
            <strong>나만 아는 여행</strong>이 뜨고 있어요.
          </h3>

          <p>
            사람들이 이미 많이 찾는 곳보다
            새로운 곳을 찾는 움직임이 커지고 있어요.
          </p>
        </div>
      </section>

      <footer className="footer">
        <Logo />
        <span>트렌드는 지금부터.</span>
        <p className="footer-attribution">
          이 서비스는 YouTube Data API, Google News, NAVER 검색어트렌드 데이터를 활용합니다.{" "}
          <a href="https://youtube.com" target="_blank" rel="noreferrer">
            YouTube 바로가기
          </a>
          {" | "}
          <a href="/privacy">개인정보처리방침</a>
          {" | "}
          <a href="/terms">이용약관</a>
        </p>
      </footer>
    </div>
  );
}

function ExplorePage({
  onSelectTrend,
  savedTrends,
  onSave,
  isPro,
}) {
  const [activeCategory, setActiveCategory] = useState("전체");
  const [search, setSearch] = useState("");
  const [apiTrends, setApiTrends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const query =
      search.trim() ||
      (activeCategory === "전체" ? "AI" : activeCategory);
    let ignore = false;

    fetchTrends(query)
      .then((data) => {
        if (ignore) {
          return;
        }

        setApiTrends(
          data.trends.map((trend) =>
            normalizeApiTrend(trend, data.query || query)
          )
        );
      })
      .catch(() => {
        if (!ignore) {
          setApiTrends([]);
          setError(
            "트렌드 데이터를 불러오지 못했어요. 서버가 실행 중인지 확인해주세요."
          );
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [activeCategory, search]);

  const filteredTrends = apiTrends;

  return (
    <div className="content">
      <section className="explore-header">
        <span className="section-label">DISCOVER</span>

        <h1>
          뭐가
          <br />
          <span>궁금하세요?</span>
        </h1>

        <p>
          요즘 뜨는 것부터 아직 아무도 모르는 것까지,
          <br />
          관심 있는 트렌드를 찾아보세요.
        </p>

        <div className="big-search">
          <SearchIcon />

          <input
            value={search}
            onChange={(e) => {
              setLoading(true);
              setError("");
              setSearch(e.target.value);
            }}
            placeholder="요즘 뜨는 러닝화, 성수 카페..."
          />

          {search && (
            <button onClick={() => setSearch("")}>×</button>
          )}
        </div>
      </section>

      <section className="explore-section">
        <div className="section-header">
          <div>
            <span className="section-label">CATEGORY</span>
            <h2>관심 분야</h2>
          </div>
        </div>

        <div className="category-list">
          {categories.map((category) => (
            <button
              key={category}
              className={
                activeCategory === category ? "selected" : ""
              }
              onClick={() => {
                setLoading(true);
                setError("");
                setActiveCategory(category);
                setSearch("");
              }}
            >
              {category}
            </button>
          ))}
        </div>
      </section>

      <section className="explore-section">
        <div className="section-header">
          <div>
            <span className="section-label">TREND NOW</span>
            <h2>
              {search
                ? `"${search}" 검색 결과`
                : activeCategory === "전체"
                  ? "요즘 뜨는 트렌드"
                  : `${activeCategory}에서 뜨는 것`}
            </h2>

            <p>지금 움직이기 시작한 트렌드를 발견해보세요.</p>
          </div>

          <span className="result-count">
            {loading ? "" : `${filteredTrends.length}개 발견`}
          </span>
        </div>

        {loading ? (
          <div className="empty-search">
            <span>⌁</span>
            <h3>트렌드를 찾는 중...</h3>
          </div>
        ) : error ? (
          <div className="empty-search">
            <span>!</span>
            <h3>{error}</h3>
          </div>
        ) : filteredTrends.length === 0 ? (
          <div className="empty-search">
            <span>⌁</span>
            <h3>아직 발견된 트렌드가 없어요.</h3>
          </div>
        ) : (
          <div className="explore-grid">
            {filteredTrends.map((trend, index) => (
              <Fragment key={trend.id}>
                <TrendCard
                  trend={trend}
                  saved={savedTrends.some(
                    (item) => item.id === trend.id
                  )}
                  onSave={onSave}
                  onClick={() => onSelectTrend(trend)}
                />

                {!isPro && index === 2 && (
                  <div className="explore-ad-slot">
                    <AdPlaceholder />
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        )}
      </section>

      <footer className="footer">
        <Logo />
        <span>트렌드는 지금부터.</span>
      </footer>
    </div>
  );
}

function MyPage({ savedTrends, onSelectTrend, onSave, isPro, onOpenPro }) {
  const [selectedCategories, setSelectedCategories] = useState(() => {
    const data = getPersonalizationData();
    return data.interests.categories;
  });
  const [personalizedTrends, setPersonalizedTrends] = useState([]);
  const [trendsLoading, setTrendsLoading] = useState(false);
  const [trendsError, setTrendsError] = useState(false);

  const allCategories = [
    "패션",
    "뷰티",
    "맛집/푸드",
    "쇼핑",
    "콘텐츠",
    "게임",
    "음악",
    "라이프",
    "여행",
    "테크",
  ];

  const toggleCategory = (category) => {
    setSelectedCategories((current) => {
      const updated = current.includes(category)
        ? current.filter((c) => c !== category)
        : [...current, category];
      updateInterests(updated);
      return updated;
    });
  };

  useEffect(() => {
    let cancelled = false;

    async function fetchPersonalizedTrends() {
      setTrendsLoading(true);
      setTrendsError(false);

      try {
        const categoriesToFetch =
          selectedCategories.length > 0
            ? selectedCategories
            : ["패션", "뷰티", "여행", "테크"];

        const allResults = await Promise.allSettled(
          categoriesToFetch.map((cat) => fetchTrends(cat))
        );

        const successfulResults = allResults
          .filter((r) => r.status === "fulfilled")
          .map((r) => r.value);

        const trendMap = new Map();
        for (const result of successfulResults) {
          if (result.trends) {
            for (const trend of result.trends) {
              const normalized = normalizeApiTrend(trend, result.query || "추천");
              const id = normalized.id;
              if (!trendMap.has(id)) {
                trendMap.set(id, normalized);
              }
            }
          }
        }

        const combinedTrends = Array.from(trendMap.values());

        if (!cancelled) {
          const personalizationData = getPersonalizationData();
          const scoredTrends = calculatePersonalizationScores(
            combinedTrends,
            personalizationData
          );

          const sorted = scoredTrends.sort(
            (a, b) => (b.personalizationScore || 0) - (a.personalizationScore || 0)
          );

          setPersonalizedTrends(sorted.slice(0, 5));
          setTrendsLoading(false);
        }
      } catch {
        if (!cancelled) {
          setTrendsError(true);
          setTrendsLoading(false);
        }
      }
    }

    fetchPersonalizedTrends();

    return () => {
      cancelled = true;
    };
  }, [selectedCategories]);

  return (
    <div className="content my-page">
      <section className="my-header">
        <span className="section-label">MY TREND</span>

        <h1>
          내가 발견한
          <br />
          <span>트렌드.</span>
        </h1>

        <p>
          관심 있는 분야와 저장한 트렌드를
          <br />
          한곳에서 확인하세요.
        </p>
      </section>

      <section className="my-section">
        <div className="section-header">
          <div>
            <span className="section-label">MY INTERESTS</span>
            <h2>나의 관심사</h2>
          </div>
        </div>

        <p className="my-section-desc">
          내가 관심 있는 분야를 선택하면
          <br />
          나에게 맞는 트렌드를 먼저 보여드려요.
        </p>

        <div className="my-interest-list">
          {allCategories.map((category) => (
            <button
              key={category}
              className={`interest-tag ${selectedCategories.includes(category) ? "selected" : ""}`}
              onClick={() => toggleCategory(category)}
            >
              {selectedCategories.includes(category) && <span className="interest-check">✓</span>}
              {category}
            </button>
          ))}
        </div>
      </section>

      <section className="my-section">
        <div className="section-header">
          <div>
            <span className="section-label">MY TRENDS</span>
            <h2>나의 트렌드</h2>
          </div>
        </div>

        <p className="my-section-desc">지금 당신이 관심 가질 만한 트렌드</p>

        {trendsLoading ? (
          <div className="my-loading">
            <div className="loading-spinner">✦</div>
            <p>나에게 맞는 트렌드를 찾고 있어요...</p>
          </div>
        ) : trendsError ? (
          <div className="my-empty">
            <div>⚠️</div>
            <h3>트렌드를 불러오지 못했어요.</h3>
            <p>잠시 후 다시 시도해주세요.</p>
          </div>
        ) : personalizedTrends.length === 0 ? (
          <div className="my-empty">
            <div>♡</div>
            <h3>아직 맞춤 트렌드가 없어요.</h3>
            <p>
              관심사를 선택하면
              <br />
              나에게 맞는 트렌드를 발견할 수 있어요.
            </p>
          </div>
        ) : (
          <div className="personalized-trend-list">
            {personalizedTrends.map((trend) => (
              <article
                className="personalized-trend-card"
                key={trend.id}
                onClick={() => onSelectTrend(trend)}
              >
                <div className="personalized-trend-top">
                  <span className="personalized-emoji">{trend.emoji}</span>
                  <span className="personalized-category">{trend.category}</span>
                </div>
                <h3>{trend.title}</h3>
                {trend.stage && <p className="personalized-stage">{trend.stage}</p>}
                {trend.growthAvailable && trend.growthRate !== null && (
                  <span className="personalized-growth">{formatGrowth(trend.growthRate)}</span>
                )}
                {trend.personalizationReasons && trend.personalizationReasons.length > 0 && (
                  <div className="personalized-reasons">
                    {trend.personalizationReasons.slice(0, 2).map((reason, idx) => (
                      <span key={idx} className="personalized-reason">
                        {reason}
                      </span>
                    ))}
                  </div>
                )}
                {trend.personalizationScore !== undefined && (
                  <div className="personalized-score">
                    <span>맞춤 점수</span>
                    <strong>{trend.personalizationScore}</strong>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="my-section">
        <div className="section-header">
          <div>
            <span className="section-label">SAVED TRENDS</span>
            <h2>저장한 트렌드</h2>
          </div>

          <span className="save-limit">
            {isPro ? "무제한" : `${savedTrends.length} / 5`}
          </span>
        </div>

        {savedTrends.length > 0 ? (
          <div className="saved-list">
            {savedTrends.map((trend) => (
              <article
                className="saved-card"
                key={trend.id}
                onClick={() => onSelectTrend(trend)}
              >
                <div className="saved-emoji">
                  {trend.emoji}
                </div>

                <div className="saved-info">
                  <span>{trend.category}</span>
                  <h3>{trend.title}</h3>
                  <p>{trend.stage}</p>
                </div>

                <strong>{formatGrowth(trend.growth)}</strong>

                <button
                  className="saved-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSave(trend);
                  }}
                >
                  <BookmarkIcon />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="my-empty">
            <div>♡</div>
            <h3>아직 저장한 트렌드가 없어요.</h3>
            <p>
              탐색하다가 마음에 드는 트렌드를
              <br />
              저장해보세요.
            </p>
          </div>
        )}
      </section>

      <section className="my-section">
        <div className="section-header">
          <div>
            <span className="section-label">FOLLOWING</span>
            <h2>팔로우한 트렌드</h2>
          </div>
        </div>

        <div className="following-card">
          <div className="following-icon">⌁</div>

          <div>
            <h3>트렌드를 팔로우하면</h3>
            <p>
              관심 있는 트렌드가 다시 뜨기 시작할 때
              알려드릴게요.
            </p>
          </div>

          <button>
            알아보기
            <ArrowIcon />
          </button>
        </div>
      </section>

      <section className="my-pro-card">
        <div className="pro-symbol">✦</div>

        <div>
          <span>WHAT'S TREND PRO</span>
          <h2>나만의 트렌드 브리핑을 받아보세요.</h2>
          <p>
            내가 관심 있는 분야에서 새롭게 뜨는 트렌드를
            <br />
            매일 한 번에 확인할 수 있어요.
          </p>
        </div>

        <button onClick={onOpenPro}>
          {isPro ? "PRO 이용 중" : "PRO 알아보기"}
          <ArrowIcon />
        </button>
      </section>

      <footer className="footer">
        <Logo />
        <span>트렌드는 지금부터.</span>
      </footer>
    </div>
  );
}

function ProfilePage({ onOpenPro, onOpenNotifications, isPro, session }) {
  // Phase A: 하드코딩된 이름/아바타 대신 실제 로그인 사용자 정보를
  // 씁니다. 닉네임 필드가 없어서 이메일 앞부분(@ 앞)으로 대체합니다.
  const email = session?.user?.email ?? null;
  const nickname = email ? email.split("@")[0] : "게스트";
  const avatarLetter = email ? email[0].toUpperCase() : "W";

  return (
    <div className="page profile-page">
      <div className="profile-header">
        <div className="profile-avatar">{avatarLetter}</div>

        <div>
          <h1>{nickname}</h1>
          <p>왓츠트렌드와 함께 먼저 발견하세요.</p>
        </div>
      </div>

      <section className="profile-section">
        <div className="section-title-row">
          <h2>MY TREND</h2>
        </div>

        <div className="profile-menu-list">
          <button className="profile-menu">
            <div>
              <strong>내 관심 분야</strong>
              <span>패션 · 맛집/푸드 · 여행</span>
            </div>
            <ArrowIcon />
          </button>

          <button className="profile-menu">
            <div>
              <strong>저장한 트렌드</strong>
              <span>2개의 트렌드를 저장했어요.</span>
            </div>
            <ArrowIcon />
          </button>

          <button className="profile-menu">
            <div>
              <strong>팔로우</strong>
              <span>새로운 트렌드를 놓치지 마세요.</span>
            </div>
            <ArrowIcon />
          </button>
        </div>
      </section>

      <section className="pro-card">
        <div className="pro-card-glow" />

        <div className="pro-badge">
          {isPro ? "✓ PRO 이용 중" : "✦ WHAT'S TREND PRO"}
        </div>

        <h2>
          남들보다
          <br />
          <span>한 발 먼저</span> 발견하세요.
        </h2>

        <p className="pro-description">
          아직 크게 알려지지 않은 트렌드와
          <br />
          앞으로 뜰 가능성이 높은 트렌드를 더 깊게 만나보세요.
        </p>

        <div className="pro-price-preview">
          <div className="price-option">
            <span>월간</span>
            <strong>₩3,900</strong>
            <small>/월</small>
          </div>

          <div className="price-option recommended">
            <div className="recommended-label">추천</div>
            <span>연간</span>
            <strong>₩27,900</strong>
            <small>/년</small>
            <em>월 ₩2,325</em>
          </div>
        </div>

        <button className="pro-start-button" onClick={onOpenPro}>
          {isPro ? "PRO 상세 보기" : "PRO 알아보기"}
          <ArrowIcon />
        </button>
      </section>

      <section className="profile-section">
        <div className="section-title-row">
          <h2>앱 설정</h2>
        </div>

        <div className="profile-menu-list">
          <button className="profile-menu" onClick={onOpenNotifications}>
            <div>
              <strong>알림 설정</strong>
              <span>트렌드 알림을 관리하세요.</span>
            </div>
            <ArrowIcon />
          </button>

          <button className="profile-menu">
            <div>
              <strong>서비스 이용약관</strong>
            </div>
            <ArrowIcon />
          </button>

          <button className="profile-menu">
            <div>
              <strong>개인정보 처리방침</strong>
            </div>
            <ArrowIcon />
          </button>
        </div>
      </section>

      <div className="profile-version">
        WHAT'S TREND · v1.0.0
      </div>
    </div>
  );
}

function NotificationSettingsPage({ onClose, settings, onUpdateSettings }) {
  const [localSettings, setLocalSettings] = useState(settings);

  const handleToggle = (key) => {
    const updated = { ...localSettings, [key]: !localSettings[key] };
    setLocalSettings(updated);
    onUpdateSettings(updated);
  };

  const handleFrequencyChange = (frequency) => {
    const updated = { ...localSettings, frequency };
    setLocalSettings(updated);
    onUpdateSettings(updated);
  };

  // 브라우저 푸시 알림 상태 (17-2). 페이지 로드 시 권한을 강제로 요청하지 않고
  // 현재 지원/구독 상태만 조회합니다.
  const [pushSupported, setPushSupported] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushMessage, setPushMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function checkPushState() {
      const supported = isPushSupported();

      if (cancelled) {
        return;
      }
      setPushSupported(supported);

      if (!supported) {
        return;
      }

      const current = await getPushSubscription();

      if (!cancelled) {
        setPushSubscribed(Boolean(current.subscription));
      }
    }

    checkPushState();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleEnablePush = async () => {
    setPushLoading(true);
    setPushMessage("");

    const result = await enablePushNotifications();

    setPushLoading(false);
    setPushSubscribed(result.success);
    setPushMessage(result.message);
  };

  const handleDisablePush = async () => {
    setPushLoading(true);
    setPushMessage("");

    const result = await disablePushNotifications();

    setPushLoading(false);
    setPushSubscribed(!result.success);
    setPushMessage(result.message);
  };

  return (
    <div className="page notification-settings-page">
      <header className="pro-header">
        <button className="pro-back-button" onClick={onClose}>
          <BackIcon />
        </button>
        <div className="pro-header-title">
          <span>NOTIFICATION</span>
          <strong>SETTINGS</strong>
        </div>
        <div className="pro-header-spacer" />
      </header>
      <main className="pro-content">
        <section className="profile-section">
          <div className="section-title-row">
            <h2>알림 설정</h2>
          </div>
          <div className="profile-menu-list">
            <div className="profile-menu notification-toggle">
              <div>
                <strong>트렌드 알림</strong>
                <span>새로운 트렌드 알림을 받아보세요.</span>
              </div>
              <button
                className={`toggle-switch ${localSettings.enabled ? "active" : ""}`}
                onClick={() => handleToggle("enabled")}
              >
                <span className="toggle-slider" />
              </button>
            </div>
          </div>
        </section>

        <section className="profile-section">
          <div className="section-title-row">
            <h2>브라우저 푸시 알림</h2>
          </div>
          <div className="profile-menu-list">
            <div className="profile-menu notification-toggle">
              <div>
                <strong>푸시 알림</strong>
                <span>
                  {!pushSupported
                    ? "이 브라우저는 푸시 알림을 지원하지 않아요."
                    : pushSubscribed
                    ? "푸시 알림: 켜짐"
                    : "푸시 알림: 꺼짐"}
                </span>
              </div>
              {pushSupported && (
                <button
                  className={`push-toggle-button ${pushSubscribed ? "subscribed" : ""}`}
                  onClick={pushSubscribed ? handleDisablePush : handleEnablePush}
                  disabled={pushLoading}
                >
                  {pushLoading
                    ? "처리 중..."
                    : pushSubscribed
                    ? "🔕 푸시 알림 끄기"
                    : "🔔 푸시 알림 켜기"}
                </button>
              )}
            </div>
          </div>
          {pushMessage && <p className="push-status-message">{pushMessage}</p>}
        </section>

        {localSettings.enabled && (
          <>
            <section className="profile-section">
              <div className="section-title-row">
                <h2>알림 유형</h2>
              </div>
              <div className="profile-menu-list">
                <div className="profile-menu notification-toggle">
                  <div>
                    <strong>급상승 트렌드</strong>
                    <span>빠르게 상승하는 트렌드를 알려드려요.</span>
                  </div>
                  <button
                    className={`toggle-switch ${localSettings.risingTrend ? "active" : ""}`}
                    onClick={() => handleToggle("risingTrend")}
                  >
                    <span className="toggle-slider" />
                  </button>
                </div>
                <div className="profile-menu notification-toggle">
                  <div>
                    <strong>NEXT 트렌드</strong>
                    <span>다음 유행이 될 트렌드를 알려드려요.</span>
                  </div>
                  <button
                    className={`toggle-switch ${localSettings.nextRising ? "active" : ""}`}
                    onClick={() => handleToggle("nextRising")}
                  >
                    <span className="toggle-slider" />
                  </button>
                </div>
                <div className="profile-menu notification-toggle">
                  <div>
                    <strong>개인화 트렌드</strong>
                    <span>관심 있는 트렌드를 알려드려요.</span>
                  </div>
                  <button
                    className={`toggle-switch ${localSettings.personalTrend ? "active" : ""}`}
                    onClick={() => handleToggle("personalTrend")}
                  >
                    <span className="toggle-slider" />
                  </button>
                </div>
                <div className="profile-menu notification-toggle">
                  <div>
                    <strong>저장 트렌드</strong>
                    <span>저장한 트렌드의 변화를 알려드려요.</span>
                  </div>
                  <button
                    className={`toggle-switch ${localSettings.savedTrend ? "active" : ""}`}
                    onClick={() => handleToggle("savedTrend")}
                  >
                    <span className="toggle-slider" />
                  </button>
                </div>
                <div className="profile-menu notification-toggle">
                  <div>
                    <strong>관심 카테고리</strong>
                    <span>관심 카테고리의 새 트렌드를 알려드려요.</span>
                  </div>
                  <button
                    className={`toggle-switch ${localSettings.categoryTrend ? "active" : ""}`}
                    onClick={() => handleToggle("categoryTrend")}
                  >
                    <span className="toggle-slider" />
                  </button>
                </div>
              </div>
            </section>

            <section className="profile-section">
              <div className="section-title-row">
                <h2>알림 빈도</h2>
              </div>
              <div className="profile-menu-list frequency-options">
                <button
                  className={`profile-menu frequency-option ${localSettings.frequency === "low" ? "selected" : ""}`}
                  onClick={() => handleFrequencyChange("low")}
                >
                  <div>
                    <strong>적게</strong>
                    <span>중요한 알림만 받아요.</span>
                  </div>
                </button>
                <button
                  className={`profile-menu frequency-option ${localSettings.frequency === "normal" ? "selected" : ""}`}
                  onClick={() => handleFrequencyChange("normal")}
                >
                  <div>
                    <strong>기본</strong>
                    <span>적당한 빈도로 받아요.</span>
                  </div>
                </button>
                <button
                  className={`profile-menu frequency-option ${localSettings.frequency === "high" ? "selected" : ""}`}
                  onClick={() => handleFrequencyChange("high")}
                >
                  <div>
                    <strong>많이</strong>
                    <span>더 많은 알림을 받아요.</span>
                  </div>
                </button>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

// Phase D: mock 활성화(confirm() → 즉시 tier='pro') 대신 실제 토스페이먼츠
// 자동결제 등록 흐름을 씁니다 - 플랜 카드를 눌러 monthly/yearly를 고르고
// "PRO 시작하기"를 누르면 onStartPayment(selectedPlan)이 카드 등록창을
// 엽니다. 기존 mock 엔드포인트(/api/pro/activate-mock 등)는 서버에는
// 그대로 남아있지만, 이 화면에서는 더 이상 호출하지 않습니다.
function ProPage({ onClose, onStartPayment, isPro, paymentStarting }) {
  const [selectedPlan, setSelectedPlan] = useState("yearly");

  const handleActivate = () => {
    if (isPro) {
      alert("이미 PRO 이용 중입니다.");
      return;
    }

    onStartPayment(selectedPlan);
  };

  return (
    <div className="pro-page">
      <header className="pro-header">
        <button className="pro-back-button" onClick={onClose}>
          <BackIcon />
        </button>

        <div className="pro-header-title">
          <span>WHAT'S TREND</span>
          <strong>PRO</strong>
        </div>

        <div className="pro-header-spacer" />
      </header>

      <main className="pro-content">
        <section className="pro-hero">
          <div className="pro-badge">
            <span>✦</span>
            WHAT'S TREND PRO
          </div>

          <h1>
            남들보다 먼저
            <br />
            발견하세요.
          </h1>

          <p>
            지금 뜨는 트렌드를 넘어
            <br />
            다음에 뜰 트렌드까지 확인하세요.
          </p>
        </section>

        <section className="pro-price-section">
          <div
            className={`pro-plan-card${selectedPlan === "monthly" ? " selected" : ""}`}
            onClick={() => setSelectedPlan("monthly")}
          >
            <div className="pro-plan-top">
              <div>
                <span className="pro-plan-label">MONTHLY</span>
                <h2>월 ₩3,900</h2>
              </div>

              {selectedPlan === "monthly" && <span className="pro-plan-check">✓</span>}
            </div>

            <p>부담 없이 시작하는 PRO</p>
          </div>

          <div
            className={`pro-plan-card recommended${selectedPlan === "yearly" ? " selected" : ""}`}
            onClick={() => setSelectedPlan("yearly")}
          >
            <div className="pro-recommended">
              가장 추천
            </div>

            <div className="pro-plan-top">
              <div>
                <span className="pro-plan-label">YEARLY</span>
                <h2>연 ₩27,900</h2>
              </div>

              {selectedPlan === "yearly" && <span className="pro-plan-check">✓</span>}
            </div>

            <p>
              월 환산 <strong>₩2,325</strong>
            </p>
          </div>
        </section>

        <section className="pro-feature-section">
          <div className="section-heading">
            <span>PRO FEATURES</span>
            <h2>PRO에서는 이렇게 달라져요</h2>
          </div>

          <div className="pro-feature-list">
            <div className="pro-feature-item">
              <div className="pro-feature-icon">📈</div>
              <div>
                <strong>전체 트렌드 분석</strong>
                <p>
                  7일 · 30일 · 90일 동안의
                  트렌드 변화를 확인하세요.
                </p>
              </div>
            </div>

            <div className="pro-feature-item">
              <div className="pro-feature-icon">🔮</div>
              <div>
                <strong>NEXT 트렌드 예측</strong>
                <p>
                  아직 크게 뜨지 않은
                  다음 트렌드를 발견하세요.
                </p>
              </div>
            </div>

            <div className="pro-feature-item">
              <div className="pro-feature-icon">🤖</div>
              <div>
                <strong>AI 트렌드 분석</strong>
                <p>
                  왜 뜨고 있는지 AI가
                  핵심 이유를 분석합니다.
                </p>
              </div>
            </div>

            <div className="pro-feature-item">
              <div className="pro-feature-icon">🔔</div>
              <div>
                <strong>개인 맞춤 알림</strong>
                <p>
                  내가 관심 있는 트렌드가
                  급상승하면 알려드립니다.
                </p>
              </div>
            </div>

            <div className="pro-feature-item">
              <div className="pro-feature-icon">💾</div>
              <div>
                <strong>무제한 저장</strong>
                <p>
                  마음에 드는 트렌드를
                  제한 없이 저장하세요.
                </p>
              </div>
            </div>

            <div className="pro-feature-item">
              <div className="pro-feature-icon">🧠</div>
              <div>
                <strong>Personal Trend Briefing</strong>
                <p>
                  나에게 필요한 트렌드만
                  한눈에 받아보세요.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="pro-comparison">
          <div className="section-heading">
            <span>FREE VS PRO</span>
            <h2>무엇이 달라질까요?</h2>
          </div>

          <div className="comparison-table">
            <div className="comparison-row comparison-head">
              <span>기능</span>
              <span>FREE</span>
              <span>PRO</span>
            </div>

            <div className="comparison-row">
              <span>트렌드 탐색</span>
              <span>✓</span>
              <span>✓</span>
            </div>

            <div className="comparison-row">
              <span>기본 상세 분석</span>
              <span>✓</span>
              <span>✓</span>
            </div>

            <div className="comparison-row">
              <span>상세 그래프</span>
              <span>—</span>
              <span>✓</span>
            </div>

            <div className="comparison-row">
              <span>NEXT 예측</span>
              <span>기본</span>
              <span>전체</span>
            </div>

            <div className="comparison-row">
              <span>AI 분석</span>
              <span>—</span>
              <span>✓</span>
            </div>

            <div className="comparison-row">
              <span>저장</span>
              <span>5개</span>
              <span>무제한</span>
            </div>

            <div className="comparison-row">
              <span>개인 알림</span>
              <span>—</span>
              <span>✓</span>
            </div>
          </div>
        </section>

        <section className="pro-cta-section">
          <div className="pro-cta-card">
            <span className="pro-cta-glow">✦</span>

            <h2>
              트렌드를 보는 것에서
              <br />
              먼저 발견하는 것으로.
            </h2>

            <p>
              왓츠트렌드 PRO와 함께
              한발 먼저 시작하세요.
            </p>

            <button
              className="pro-cta"
              onClick={handleActivate}
              disabled={paymentStarting}
            >
              {isPro
                ? "✓ PRO 이용 중"
                : paymentStarting
                ? "카드 등록창 여는 중..."
                : "PRO 시작하기"}
            </button>

            {!isPro && (
              <small>
                ※ 테스트 환경입니다. 실제로 카드가 등록되지만 결제는 청구되지 않습니다.
              </small>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function DetailPage({
  trend,
  onBack,
  onSave,
  isSaved,
  isPro,
  onOpenPro,
}) {
  const activeStageIndex = Math.max(
    0,
    STAGE_DEFINITIONS.findIndex((s) => s.label === trend.stage)
  );

  return (
    <div className="content detail-page">
      {/* HEADER */}
      <div className="detail-header">
        <button
          className="icon-button"
          onClick={onBack}
          aria-label="뒤로가기"
        >
          <BackIcon />
        </button>

        <div className="detail-header-title">
          TREND DETAIL
        </div>

        <div className="detail-header-actions">
          <button
            className={`icon-button ${isSaved ? "active" : ""}`}
            onClick={() => onSave(trend)}
            aria-label="저장"
          >
            <BookmarkIcon />
          </button>

          <button
            className="icon-button"
            onClick={() =>
              alert("공유 기능은 다음 단계에서 연결합니다.")
            }
            aria-label="공유"
          >
            <ShareIcon />
          </button>
        </div>
      </div>

      {/* MAIN TREND */}
      <section className="detail-main-card">
        <div className="detail-main-top">
          <div className="detail-category">
            {trend.category}
          </div>

          <div className="detail-stage">
            {trend.stage}
          </div>
        </div>

        <div className="detail-emoji">
          {trend.emoji}
        </div>

        <h1>{trend.title}</h1>

        {trend.description && (
          <p className="detail-description">
            {trend.description}
          </p>
        )}

        {/* 6-4단계: 일일 상승(daily)은 실API가 아예 제공하지 않는 필드라
            (normalizeApiTrend가 항상 null) "데이터 없음" 대신 칸 자체를
            숨깁니다. 3칸 그리드에서 가운데 칸만 없어지면 빈 자리가
            남으므로, 남은 칸 개수에 맞춰 grid-template-columns를
            동적으로 바꿉니다. */}
        <div
          className="detail-growth-row"
          style={{ gridTemplateColumns: `repeat(${trend.daily ? 3 : 2}, 1fr)` }}
        >
          <div>
            <span>관심도 상승</span>
            <strong>{formatGrowth(trend.growth)}</strong>
          </div>

          {trend.daily && (
            <div>
              <span>일일 상승</span>
              <strong>{trend.daily}</strong>
            </div>
          )}

          <div>
            <span>🔮 NEXT</span>
            <strong>{formatNextLevel(trend.nextLevel, trend.nextAvailable)}</strong>
          </div>
        </div>

        {trend.nextAvailable && trend.nextScore !== null && trend.nextScore !== undefined && (
          <div className="detail-next-score">
            <span>{formatNextScore(trend.nextScore, trend.nextAvailable)}</span>
          </div>
        )}
      </section>

      {/* TREND GRAPH */}
      <section className="detail-section">
        <div className="detail-section-title">
          <div>
            <span className="section-label">
              TREND MOMENTUM
            </span>

            <h2>지금 얼마나 빠르게 뜨고 있을까?</h2>
          </div>

          <span className="graph-period">최근 7일</span>
        </div>

        {/* 6-4단계: 7일 시계열 데이터를 실제로 제공할 수 없는 상태라서
            (trendHistory.js가 이 트렌드를 위해 쌓아둔 데이터가 있다는
            보장이 없음) 하드코딩된 가짜 그래프 대신 안내 문구로
            대체합니다 - 실제 차트 구현은 별도 후속 과제입니다. */}
        {isPro ? (
          <div className="monitoring-empty">
            아직 이 트렌드의 히스토리 데이터가 충분히 쌓이지 않았어요.
            <br />
            그래프는 데이터가 모이면 표시됩니다.
          </div>
        ) : (
          <div className="detail-pro-lock">
            <div className="detail-pro-lock-icon">🔒</div>

            <strong>상세 트렌드 그래프</strong>

            <p>
              PRO에서 7일 · 30일 · 90일
              <br />
              트렌드 변화를 확인할 수 있어요.
            </p>

            <button onClick={onOpenPro}>
              PRO로 전체 분석 보기
            </button>
          </div>
        )}
      </section>

      {/* SIGNAL CARDS */}
      <section className="detail-section">
        <div className="detail-section-title">
          <div>
            <span className="section-label">TREND SIGNAL</span>
            <h2>트렌드 신호</h2>
          </div>
        </div>

        {/* 6-4단계: daily/interest/startDate는 실API에 없는 필드라
            (normalizeApiTrend가 항상 null/빈 값) "데이터 없음" 대신
            카드 자체를 숨기고, NEXT 가능성만 항상 표시합니다. 남은
            카드 개수에 맞춰 grid-template-columns도 같이 바꿔서
            빈 칸이 남지 않게 합니다. */}
        <div
          className="signal-grid"
          style={{ gridTemplateColumns: `repeat(${1 + [trend.daily, trend.interest, trend.startDate].filter(Boolean).length}, 1fr)` }}
        >
          {trend.daily && (
            <div className="signal-card">
              <div className="signal-icon">↗</div>
              <span>상승 속도</span>
              <strong>{trend.daily}</strong>
              <small>하루 평균 증가</small>
            </div>
          )}

          {trend.interest !== null && trend.interest !== undefined && (
            <div className="signal-card">
              <div className="signal-icon">👀</div>
              <span>현재 관심도</span>
              <strong>{trend.interest}</strong>
              <small>100점 기준</small>
            </div>
          )}

          <div className="signal-card">
            <div className="signal-icon">🔮</div>
            <span>NEXT 가능성</span>
            <strong>{formatNextLevel(trend.nextLevel, trend.nextAvailable)}</strong>
            <small>미래 확산 예측</small>
          </div>

          {trend.startDate && (
            <div className="signal-card">
              <div className="signal-icon">📅</div>
              <span>발견 시작</span>
              <strong>{trend.startDate}</strong>
              <small>상승 신호 포착</small>
            </div>
          )}
        </div>
      </section>

      {/* TREND STAGE */}
      <section className="detail-section">
        <div className="detail-section-title">
          <div>
            <span className="section-label">TREND STAGE</span>
            <h2>지금 어느 단계일까?</h2>
          </div>
        </div>

        <div className="stage-card">
          <div className="stage-line">
            <div
              className="stage-progress"
              style={{ width: `${((activeStageIndex + 1) / STAGE_DEFINITIONS.length) * 100}%` }}
            />
          </div>

          <div className="stage-items">
            {STAGE_DEFINITIONS.map((s, index) => (
              <div
                className={`stage-item${index === activeStageIndex ? " active" : ""}`}
                key={s.label}
              >
                <span>{s.emoji}</span>
                <small>{s.label}</small>
              </div>
            ))}
          </div>

          <div className="stage-message">
            <strong>{STAGE_DEFINITIONS[activeStageIndex].headline}</strong>
            <span>{STAGE_DEFINITIONS[activeStageIndex].message}</span>
          </div>
        </div>
      </section>

      {/* AI ANALYSIS */}
      <section className="detail-ai-section">
        <div className="detail-section-title">
          <span>🤖 AI TREND ANALYSIS</span>
          <h3>왜 지금 뜨고 있어?</h3>
        </div>

        {trend.aiAnalysis && trend.aiAnalysis.available === true && trend.aiAnalysis.status === "completed" ? (
          <div className="detail-ai-card">
            {/* Summary */}
            {trend.aiAnalysis.summary && (
              <div className="ai-summary">
                <p>{trend.aiAnalysis.summary}</p>
              </div>
            )}

            {/* Attention Reason */}
            {trend.aiAnalysis.attentionReason && (
              <div className="ai-section">
                <h4>왜 지금 주목해야 할까?</h4>
                <div className="ai-attention">
                  <p>{trend.aiAnalysis.attentionReason}</p>
                </div>
              </div>
            )}

            {/* Trend Interpretation */}
            {trend.aiAnalysis.trendInterpretation && (
              <div className="ai-section">
                <h4>AI가 보는 현재 흐름</h4>
                <div className="ai-interpretation">
                  <p>{trend.aiAnalysis.trendInterpretation}</p>
                </div>
              </div>
            )}

            {/* Why Trending */}
            {Array.isArray(trend.aiAnalysis.whyTrending) && trend.aiAnalysis.whyTrending.length > 0 && (
              <div className="ai-section">
                <h4>왜 뜨고 있어?</h4>
                <div className="ai-why-list">
                  {trend.aiAnalysis.whyTrending.map((reason, index) => (
                    <div className="ai-why-item" key={index}>
                      <span className="ai-why-number">{String(index + 1).padStart(2, "0")}</span>
                      <p>{reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Key Signals */}
            {Array.isArray(trend.aiAnalysis.keySignals) && trend.aiAnalysis.keySignals.length > 0 && (
              <div className="ai-section">
                <h4>핵심 신호</h4>
                <div className="ai-signals-grid">
                  {trend.aiAnalysis.keySignals.map((signal, index) => (
                    <div className="ai-signal-item" key={index}>
                      <span>{signal.label}</span>
                      <strong>{signal.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Related Topics */}
            {Array.isArray(trend.aiAnalysis.relatedTopics) && trend.aiAnalysis.relatedTopics.length > 0 && (
              <div className="ai-section">
                <h4>관련 토픽</h4>
                <div className="ai-topics-list">
                  {trend.aiAnalysis.relatedTopics.map((topic, index) => (
                    <span className="ai-topic-tag" key={index}>#{topic}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Action Suggestion */}
            {Array.isArray(trend.aiAnalysis.actionSuggestion) && trend.aiAnalysis.actionSuggestion.length > 0 && (
              <div className="ai-section">
                <h4>지금 활용한다면</h4>
                <ul className="ai-action-list">
                  {trend.aiAnalysis.actionSuggestion.map((action, index) => (
                    <li key={index}>{action}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Content Ideas */}
            {Array.isArray(trend.aiAnalysis.contentIdeas) && trend.aiAnalysis.contentIdeas.length > 0 && (
              <div className="ai-section">
                <h4>💡 콘텐츠 아이디어</h4>
                <ul className="ai-ideas-list">
                  {trend.aiAnalysis.contentIdeas.map((idea, index) => (
                    <li key={index}>{idea}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Evidence */}
            {Array.isArray(trend.aiAnalysis.evidence) && trend.aiAnalysis.evidence.length > 0 && (
              <div className="ai-section">
                <h4>분석 근거</h4>
                <div className="ai-evidence-list">
                  {trend.aiAnalysis.evidence.map((ev, index) => (
                    <div className="ai-evidence-item" key={index}>
                      <div>
                        <strong>{ev.title}</strong>
                        <span>{ev.source}{ev.pubDate ? ` · ${ev.pubDate}` : ""}</span>
                      </div>
                      {ev.link && ev.link.startsWith("http") && (
                        <a
                          href={ev.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ai-evidence-link"
                        >
                          기사 보기
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : trend.aiAnalysis && trend.aiAnalysis.status === "insufficient_data" ? (
          <div className="detail-ai-card detail-ai-insufficient">
            <div className="ai-insufficient-icon">📊</div>
            <p>데이터가 아직 충분하지 않아요.</p>
            <span>현재 확보된 데이터가 더 쌓이면 더 자세한 분석을 제공할 수 있어요.</span>
          </div>
        ) : (
          <div className="detail-ai-card detail-ai-loading">
            <div className="ai-loading-icon">🤖</div>
            <p>AI 분석 준비 중</p>
          </div>
        )}
      </section>

      {/* PLATFORM FLOW */}
      <section className="detail-section">
        <div className="detail-section-title">
          <div>
            <span className="section-label">SPREAD FLOW</span>
            <h2>어디서 퍼지고 있을까?</h2>
          </div>
        </div>

        {/* 6-4단계: platforms 데이터를 제공하는 소스가 없어서(실API에
            아예 없는 필드) Instagram/TikTok/Shorts/Threads 고정 흐름을
            실제 데이터처럼 보여주지 않고 안내 문구로 대체합니다. */}
        <div className="monitoring-empty">
          아직 채널별 확산 데이터가 없어요.
        </div>
      </section>

      {/* HASHTAGS - 6-4단계: hashtags를 제공하는 소스가 없어서 항상
          비어있으므로, 빈 섹션 헤더만 남는 것을 막기 위해 값이 있을
          때만 섹션 자체를 렌더링합니다. */}
      {trend.hashtags && trend.hashtags.length > 0 && (
      <section className="detail-section">
        <div className="detail-section-title">
          <div>
            <span className="section-label">RELATED</span>
            <h2>함께 뜨는 키워드</h2>
          </div>
        </div>

        <div className="hashtag-list">
          {trend.hashtags.map((tag) => (
            <span className="hashtag" key={tag}>
              #{tag}
            </span>
          ))}
        </div>
      </section>
      )}

      {trend.articles?.length > 0 && (
        <section className="detail-section detail-articles-section">
          <div className="detail-section-title">
            <div>
              <span className="section-label">RELATED NEWS</span>
              <h2>관련 기사</h2>
            </div>
          </div>

          <div className="detail-article-list">
            {trend.articles.map((article, index) => (
              <article className="detail-article-item" key={article.link || index}>
                <div>
                  <strong>{formatTrendValue(article.title)}</strong>
                  <span>
                    {formatTrendValue(article.source)} · {formatTrendValue(article.pubDate)}
                  </span>
                </div>

                {article.link && (
                  <a
                    href={article.link}
                    target="_blank"
                    rel="noreferrer"
                  >
                    기사 보기
                    <ArrowIcon />
                  </a>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {/* PRO */}
      {isPro ? (
        <section className="detail-pro-card detail-pro-active-card">
          <div className="detail-pro-glow" />

          <div className="pro-small-badge">✓ PRO</div>

          <h2>
            PRO 심층 분석
          </h2>

          <p>
            이 트렌드의 변화와 확산 신호를
            <br />
            PRO에서 확인하고 있어요.
          </p>

          <div className="pro-active-grid">
            <div className="pro-active-item">
              <span>현재 단계</span>
              <strong>{formatTrendValue(trend.stage)}</strong>
              <small>트렌드 상태</small>
            </div>

            <div className="pro-active-item">
              <span>상승 속도</span>
              <strong>{formatGrowth(trend.growth)}</strong>
              <small>성장률</small>
            </div>

            <div className="pro-active-item">
              <span>NEXT 가능성</span>
              <strong>{formatNextLevel(trend.nextLevel, trend.nextAvailable)}</strong>
              <small>미래 확산 예측</small>
            </div>
          </div>

          {trend.nextAvailable && trend.nextScore !== null && trend.nextScore !== undefined && (
            <div className="pro-next-detail">
              <div className="pro-next-score-display">
                <span>NEXT Score</span>
                <strong>{formatNextScore(trend.nextScore, trend.nextAvailable)}</strong>
              </div>
              <p>
                이 트렌드는 현재 빠르게 확산되고 있으며,
                <br />
                앞으로의 확산 가능성이 높은 상태입니다.
              </p>
            </div>
          )}

          {!trend.nextAvailable && (
            <div className="pro-next-detail">
              <p>
                현재 데이터가 충분하지 않아
                <br />
                NEXT 분석을 제공할 수 없습니다.
              </p>
            </div>
          )}

          <div className="pro-active-status">
            <span>✓</span>
            <p>
              PRO 심층 분석이 활성화되어 있습니다.
            </p>
          </div>
        </section>
      ) : (
        <section className="detail-pro-card">
          <div className="detail-pro-glow" />

          <div className="pro-small-badge">PRO</div>

          <h2>
            더 깊은 트렌드 데이터를
            <br />
            확인해보세요.
          </h2>

          <p>
            NEXT 상세 분석과 확산 예측,
            <br />
            트렌드 심층 인사이트를 확인할 수 있어요.
          </p>

          <button
            className="pro-detail-button"
            onClick={onOpenPro}
          >
            PRO 알아보기
            <ArrowIcon />
          </button>
        </section>
      )}

      <TrendPicks trend={trend} />

      {!isPro && <AdPlaceholder />}

      <footer className="footer">
        <Logo />
        <span>트렌드는 지금부터.</span>
      </footer>
    </div>
  );
}

// ============================================================
// 4-2단계: 키워드 모니터링 대시보드
// ============================================================
// 기존 Home/Explore/My 페이지, 목업 trends 배열, personalization.js/
// notifications.js/pushNotifications.js와는 완전히 독립적으로 동작합니다.
// GET /api/keywords, POST /api/keywords, DELETE /api/keywords/:id,
// GET /api/trend-score, GET /api/{youtube,news,naver,composite}/trend-history
// 만 사용합니다.

function DataQualityBadge({ dataQuality }) {
  const label =
    {
      ok: "정상",
      partial: "일부",
      partial_unreliable: "일부 불안정",
      unreliable: "불안정",
      insufficient_data: "데이터 부족",
    }[dataQuality] || dataQuality || "알 수 없음";

  return <span className={`dq-badge dq-${dataQuality || "unknown"}`}>{label}</span>;
}

// 백엔드가 던지는 reason 코드(youtubeTrendGrowth.js/newsTrendGrowth.js가
// throw하는 error.code 등, 예: "trend_growth_no_data")를 화면에 그대로
// 노출하지 않고 사람이 읽는 문구로 바꿉니다. 백엔드는 전혀 수정하지 않고
// 이 매핑만 프론트엔드에 둡니다 - 매핑에 없는 새 코드가 와도 같은 기본
// 문구로 처리해서(fallback) 화면이 깨지지 않게 합니다.
const SOURCE_REASON_MESSAGES = {
  trend_growth_no_data: "아직 표시할 데이터가 충분하지 않아요",
  insufficient_data: "아직 표시할 데이터가 충분하지 않아요",
};
const DEFAULT_SOURCE_REASON_MESSAGE = "아직 표시할 데이터가 충분하지 않아요";

function formatSourceReason(reason) {
  return SOURCE_REASON_MESSAGES[reason] || DEFAULT_SOURCE_REASON_MESSAGE;
}

// 5-1단계: AI 설명(explanation)이 아직 캐시/생성되지 않았을 때 표시할
// 문구입니다. 4-3단계와 동일한 원칙(내부 에러 문자열을 그대로 노출하지
// 않고 사람이 읽는 기본 문구로 통일) - explanationResult.error 값은
// 화면에 절대 노출하지 않습니다.
const EXPLANATION_PLACEHOLDER = "아직 설명이 준비되지 않았어요";

function SourceScoreCard({ label, source }) {
  if (!source || !source.available) {
    return (
      <div className="source-score-card unavailable">
        <span className="source-score-label">{label}</span>
        <p className="source-score-reason">{formatSourceReason(source?.reason)}</p>
        <span className="dq-badge dq-insufficient_data">데이터 없음</span>
      </div>
    );
  }

  const { value, dataQuality } = source.trendScore || {};

  return (
    <div className="source-score-card">
      <span className="source-score-label">{label}</span>
      <strong className="source-score-value">
        {value === null || value === undefined ? "-" : `${value > 0 ? "+" : ""}${value}`}
      </strong>
      <DataQualityBadge dataQuality={dataQuality} />
      <p className="source-score-explanation">{source.explanation?.text || EXPLANATION_PLACEHOLDER}</p>
    </div>
  );
}

function TrendHistoryChart({ title, data, color }) {
  const hasData = Array.isArray(data) && data.some((point) => point.value !== null && point.value !== undefined);

  return (
    <div className="history-chart-card">
      <h3>{title}</h3>
      {!hasData ? (
        <div className="history-chart-empty">아직 표시할 데이터가 충분하지 않아요.</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
            <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }} />
            <YAxis tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }} />
            <Tooltip
              contentStyle={{ background: "#141414", border: "1px solid rgba(255,255,255,0.15)" }}
              labelStyle={{ color: "#fff" }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// Phase C: 키워드 모니터링은 로그인 필수 + 소유자별 격리로 바뀌어서,
// 이 컴포넌트는 이제 App()의 session/isPro를 props로 받습니다. session이
// 없으면(비로그인) 아래에서 대시보드 대신 로그인 유도 화면을 반환합니다.
function KeywordDashboardPage({ session, isPro, onOpenPro, onRequireLogin }) {
  const [keywords, setKeywords] = useState([]);
  const [keywordsLoading, setKeywordsLoading] = useState(true);
  const [keywordsError, setKeywordsError] = useState("");
  const [newKeyword, setNewKeyword] = useState("");
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [limitError, setLimitError] = useState("");
  const accessToken = session?.access_token;

  const [scoreData, setScoreData] = useState(null);
  const [scoreLoading, setScoreLoading] = useState(false);
  const [scoreError, setScoreError] = useState("");

  const [histories, setHistories] = useState({
    youtube: [],
    news: [],
    naver: [],
    composite: [],
  });
  const [historiesLoading, setHistoriesLoading] = useState(false);

  const activeKeywords = useMemo(
    () => keywords.filter((k) => k.is_active),
    [keywords]
  );

  const selectedKeyword = useMemo(
    () => keywords.find((k) => k.id === selectedId) || null,
    [keywords, selectedId]
  );

  const loadKeywords = async () => {
    if (!accessToken) return;

    setKeywordsLoading(true);
    setKeywordsError("");

    try {
      const data = await fetchKeywords(accessToken);
      setKeywords(data.keywords || []);
    } catch {
      setKeywordsError("키워드 목록을 불러오지 못했어요.");
    } finally {
      setKeywordsLoading(false);
    }
  };

  useEffect(() => {
    if (accessToken) {
      loadKeywords();
    }
  }, [accessToken]);

  const handleAddKeyword = async (event) => {
    event.preventDefault();
    const trimmed = newKeyword.trim();
    if (!trimmed || !accessToken) return;

    setAdding(true);
    setLimitError("");
    try {
      await addKeyword(trimmed, accessToken);
      setNewKeyword("");
      await loadKeywords();
    } catch (error) {
      // Phase C: 무료 플랜 3개 제한(403)은 alert 대신 PRO 유도 배너로
      // 보여줍니다 - 그 외 실패는 기존처럼 alert.
      if (error.status === 403) {
        setLimitError(error.message || "무료 플랜은 키워드 3개까지 등록 가능합니다");
      } else {
        alert(error.message || "키워드를 추가하지 못했어요.");
      }
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteKeyword = async (id) => {
    if (!accessToken) return;

    try {
      await deleteKeyword(id, accessToken);
      if (selectedId === id) {
        setSelectedId(null);
      }
      await loadKeywords();
    } catch {
      alert("키워드를 삭제하지 못했어요.");
    }
  };

  useEffect(() => {
    if (!selectedKeyword) {
      setScoreData(null);
      setHistories({ youtube: [], news: [], naver: [], composite: [] });
      return;
    }

    let cancelled = false;
    const keyword = selectedKeyword.keyword;

    async function loadScore() {
      setScoreLoading(true);
      setScoreError("");

      try {
        // 5-1단계: /api/trend-score(compositeTrendScore.js)는 개별
        // /api/{youtube,news,naver}/trend-growth 라우트를 거치지 않고
        // 계산 함수를 직접 호출하므로 sources.{youtube,news,naver}에
        // explanation이 없습니다 - 그래서 개별 엔드포인트를 병렬로 따로
        // 호출해서 explanation만 꺼내 붙입니다. 값(트렌드 점수)은
        // /api/trend-score 쪽(소스 단위 가중치가 정규화된 값)을 그대로
        // 신뢰하고 덮어쓰지 않습니다.
        const [scoreResult, ytResult, newsResult, naverResult] = await Promise.allSettled([
          fetchTrendScore(keyword, accessToken),
          fetchYoutubeTrendGrowth(keyword, accessToken),
          fetchNewsTrendGrowth(keyword, accessToken),
          fetchNaverTrendGrowth(keyword, accessToken),
        ]);

        if (cancelled) return;

        if (scoreResult.status !== "fulfilled") {
          setScoreError("종합 점수를 불러오지 못했어요.");
          return;
        }

        const data = scoreResult.value;
        const withExplanation = {
          ...data,
          sources: {
            youtube: {
              ...data.sources.youtube,
              explanation: ytResult.status === "fulfilled" ? ytResult.value.explanation : null,
            },
            news: {
              ...data.sources.news,
              explanation: newsResult.status === "fulfilled" ? newsResult.value.explanation : null,
            },
            naver: {
              ...data.sources.naver,
              explanation: naverResult.status === "fulfilled" ? naverResult.value.explanation : null,
            },
          },
        };

        setScoreData(withExplanation);
      } catch {
        if (!cancelled) setScoreError("종합 점수를 불러오지 못했어요.");
      } finally {
        if (!cancelled) setScoreLoading(false);
      }
    }

    async function loadHistories() {
      setHistoriesLoading(true);

      const [yt, news, naver, composite] = await Promise.allSettled([
        fetchYoutubeHistory(keyword, accessToken),
        fetchNewsHistory(keyword, accessToken),
        fetchNaverHistory(keyword, accessToken),
        fetchCompositeHistory(keyword, accessToken),
      ]);

      if (cancelled) return;

      const toValueSeries = (result, dateKey, valueKey, extract) => {
        if (result.status !== "fulfilled") return [];
        return (result.value.history || []).map((row) => ({
          date: row[dateKey],
          value: extract ? extract(row) : row[valueKey],
        }));
      };

      setHistories({
        youtube: toValueSeries(yt, "date", "video_count"),
        news: toValueSeries(news, "date", "mention_count"),
        naver: toValueSeries(naver, "cache_date", null, (row) => row.trend_score?.value ?? null),
        composite: toValueSeries(composite, "snapshot_date", "composite_value"),
      });
      setHistoriesLoading(false);
    }

    loadScore();
    loadHistories();

    return () => {
      cancelled = true;
    };
  }, [selectedKeyword, accessToken]);

  // Phase C: 비로그인 상태면 대시보드 대신 로그인 유도 화면만 보여줍니다.
  // 기존 대시보드 레이아웃(카드/그래프)은 그대로 두고 이 컴포넌트
  // 안에서만 분기합니다 - 라우팅 구조 변경 없음.
  if (!session?.user?.id) {
    return (
      <div className="content monitoring-page">
        <section className="monitoring-header">
          <span className="section-label">MONITORING</span>
          <h1>
            키워드
            <br />
            <span>모니터링</span>
          </h1>
          <p>감시할 키워드를 등록하고, 소스별 트렌드 점수 변화를 확인하세요.</p>
        </section>

        <section className="monitoring-section">
          <div className="monitoring-login-prompt">
            <p>키워드 모니터링은 로그인 후 이용할 수 있어요.</p>
            <button onClick={onRequireLogin}>로그인</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="content monitoring-page">
      <section className="monitoring-header">
        <span className="section-label">MONITORING</span>
        <h1>
          키워드
          <br />
          <span>모니터링</span>
        </h1>
        <p>감시할 키워드를 등록하고, 소스별 트렌드 점수 변화를 확인하세요.</p>
      </section>

      <section className="monitoring-section">
        <form className="monitoring-add-form" onSubmit={handleAddKeyword}>
          <input
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            placeholder="감시할 키워드를 입력하세요"
            disabled={adding}
          />
          <button type="submit" disabled={adding || !newKeyword.trim()}>
            {adding ? "추가 중..." : "추가"}
          </button>
        </form>

        <p className="monitoring-usage">
          {isPro ? "PRO · 키워드 무제한" : `${activeKeywords.length}/3개 사용 중`}
        </p>

        {limitError && (
          <div className="monitoring-limit-banner">
            <p>{limitError} PRO로 업그레이드하시겠어요?</p>
            <button onClick={onOpenPro}>PRO 보기</button>
          </div>
        )}

        {keywordsLoading ? (
          <div className="monitoring-empty">키워드 목록을 불러오는 중...</div>
        ) : keywordsError ? (
          <div className="monitoring-empty">{keywordsError}</div>
        ) : activeKeywords.length === 0 ? (
          <div className="monitoring-empty">등록된 키워드가 없어요. 위에서 추가해보세요.</div>
        ) : (
          <ul className="monitoring-keyword-list">
            {activeKeywords.map((item) => (
              <li
                key={item.id}
                className={selectedId === item.id ? "selected" : ""}
                onClick={() => setSelectedId(item.id)}
              >
                <span>{item.keyword}</span>
                <button
                  className="monitoring-delete-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteKeyword(item.id);
                  }}
                  aria-label={`${item.keyword} 삭제`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selectedKeyword && (
        <section className="monitoring-section">
          <div className="section-header">
            <div>
              <span className="section-label">CURRENT SCORE</span>
              <h2>{selectedKeyword.keyword}</h2>
            </div>
          </div>

          {scoreLoading ? (
            <div className="monitoring-empty">종합 점수를 불러오는 중...</div>
          ) : scoreError ? (
            <div className="monitoring-empty">{scoreError}</div>
          ) : scoreData ? (
            <>
              <div className="composite-score-card">
                <span>종합 점수</span>
                <strong>
                  {scoreData.compositeScore.value === null
                    ? "-"
                    : `${scoreData.compositeScore.value > 0 ? "+" : ""}${scoreData.compositeScore.value}`}
                </strong>
                <DataQualityBadge dataQuality={scoreData.compositeScore.dataQuality} />
                <p className="composite-score-explanation">{scoreData.explanation?.text || EXPLANATION_PLACEHOLDER}</p>
              </div>

              <div className="source-score-grid">
                <SourceScoreCard label="YouTube" source={scoreData.sources.youtube} />
                <SourceScoreCard label="뉴스" source={scoreData.sources.news} />
                <SourceScoreCard label="네이버" source={scoreData.sources.naver} />
              </div>
            </>
          ) : null}

          <div className="history-chart-grid">
            {historiesLoading ? (
              <div className="monitoring-empty">그래프 데이터를 불러오는 중...</div>
            ) : (
              <>
                <TrendHistoryChart title="YouTube 영상 수" data={histories.youtube} color="#ff5c5c" />
                <TrendHistoryChart title="뉴스 언급량" data={histories.news} color="#5c9dff" />
                <TrendHistoryChart title="네이버 Trend Score" data={histories.naver} color="#5cffb0" />
                <TrendHistoryChart title="종합 점수" data={histories.composite} color="#ffd15c" />
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

// ============================================================
// Phase A: 로그인/회원가입 모달
// ============================================================
// 기존 페이지 레이아웃은 건드리지 않고, 상단바 profile-button 클릭 시
// 뜨는 오버레이 모달 하나만 새로 추가합니다. Supabase Auth의
// signInWithPassword/signUp을 그대로 호출합니다(자체 인증 로직 없음).

function AuthModal({ onClose }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      if (mode === "login") {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
        onClose();
      } else {
        const { error: authError } = await supabase.auth.signUp({ email, password });
        if (authError) throw authError;
        setMessage("가입 확인 이메일을 보냈어요. 메일함을 확인해주세요.");
      }
    } catch (err) {
      setError(err.message || "요청을 처리하지 못했어요.");
    } finally {
      setLoading(false);
    }
  };

  // Phase A-1: signInWithOAuth()는 브라우저를 구글/카카오 로그인 페이지로
  // 실제로 리디렉션시킵니다(팝업이 아님) - 성공하면 provider의 페이지로
  // 이동해버리므로 이 함수 자체는 이후 로직(onClose 등)을 실행할 기회가
  // 없습니다. 로그인 완료 후 앱으로 돌아왔을 때의 세션 반영은 App()에
  // 이미 있는 onAuthStateChange 리스너 하나로 충분합니다(이메일 로그인과
  // 동일한 경로 - 별도 분기/리스너를 추가하지 않았습니다).
  const handleOAuthLogin = async (provider) => {
    setError("");
    const { error: authError } = await supabase.auth.signInWithOAuth({ provider });
    if (authError) {
      setError(authError.message || "소셜 로그인을 시작하지 못했어요.");
    }
  };

  return (
    <div className="auth-modal-overlay" onClick={onClose}>
      <div className="auth-modal" onClick={(event) => event.stopPropagation()}>
        <button className="auth-modal-close" onClick={onClose} aria-label="닫기">
          ×
        </button>

        <h2>{mode === "login" ? "로그인" : "회원가입"}</h2>

        <form onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="이메일"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <input
            type="password"
            placeholder="비밀번호 (6자 이상)"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={6}
          />

          {error && <p className="auth-modal-error">{error}</p>}
          {message && <p className="auth-modal-message">{message}</p>}

          <button type="submit" disabled={loading}>
            {loading ? "처리 중..." : mode === "login" ? "로그인" : "회원가입"}
          </button>
        </form>

        <div className="auth-modal-divider">
          <span>또는</span>
        </div>

        <div className="auth-modal-oauth">
          <button
            type="button"
            className="auth-oauth-button auth-oauth-google"
            onClick={() => handleOAuthLogin("google")}
          >
            Google로 계속하기
          </button>
          <button
            type="button"
            className="auth-oauth-button auth-oauth-kakao"
            onClick={() => handleOAuthLogin("kakao")}
          >
            카카오로 계속하기
          </button>
        </div>

        <button
          className="auth-modal-switch"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setError("");
            setMessage("");
          }}
        >
          {mode === "login" ? "계정이 없으신가요? 회원가입" : "이미 계정이 있으신가요? 로그인"}
        </button>
      </div>
    </div>
  );
}

// Phase D: /billing/callback 리다이렉트 이후 진행 상태(카드 등록 처리 중 /
// 구독 활성화 완료 / 실패)를 보여주는 오버레이입니다. AuthModal과 동일한
// 오버레이 스타일(auth-modal-overlay)을 재사용합니다.
function BillingStatusOverlay({ status, message, onClose }) {
  return (
    <div className="auth-modal-overlay" onClick={status === "processing" ? undefined : onClose}>
      <div className="auth-modal" onClick={(event) => event.stopPropagation()}>
        {status !== "processing" && (
          <button className="auth-modal-close" onClick={onClose} aria-label="닫기">
            ×
          </button>
        )}

        {status === "processing" && (
          <>
            <h2>구독 처리 중...</h2>
            <p className="auth-modal-message">카드 등록 결과를 확인하고 있어요. 잠시만 기다려주세요.</p>
          </>
        )}

        {status === "success" && (
          <>
            <h2>🎉 구독이 활성화됐습니다!</h2>
            <p className="auth-modal-message">이제 PRO 기능을 바로 이용하실 수 있어요.</p>
          </>
        )}

        {status === "error" && (
          <>
            <h2>구독 처리에 실패했어요</h2>
            <p className="auth-modal-error">{message || "잠시 후 다시 시도해주세요."}</p>
          </>
        )}
      </div>
    </div>
  );
}

function App() {
  // Push Notification 초기화
  useEffect(() => {
    initializePushNotifications().then((result) => {
      if (result.success) {
        console.log('[왓츠트렌드] Push Notification 초기화 완료:', result.status);
      } else {
        console.log('[왓츠트렌드] Push Notification 초기화 실패:', result.status);
      }
    });
  }, []);

  // Phase A: isPro는 더 이상 localStorage가 아니라 로그인 세션 +
  // user_profiles.tier에서 파생됩니다. 로그인하지 않았으면 profile이
  // null이라 isPro는 항상 false입니다(기존 무료 사용자 경험 그대로) -
  // 기존 12곳의 isPro 조건문 자체는 전혀 건드리지 않았습니다(변수명/동작
  // 방식 유지, 값을 어디서 가져오는지만 교체).
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    // Phase A-1: 이 리스너는 로그인 수단(이메일/구글/카카오)을 구분하지
    // 않습니다 - Supabase Auth는 어떤 방식으로 로그인했든 동일한 session/
    // user 객체를 콜백에 넘겨주므로, OAuth 리디렉션이 돌아왔을 때도 이
    // 하나의 리스너가 그대로 처리합니다(별도 리스너 추가 불필요 - 실제로
    // 중복 등록 없이 이 useEffect가 컴포넌트 마운트 시 1회만 구독합니다).
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!session?.user?.id) {
      setProfile(null);
      return;
    }

    supabase
      .from("user_profiles")
      .select("tier")
      .eq("id", session.user.id)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("[왓츠트렌드] 프로필 조회 실패:", error.message);
          setProfile(null);
          return;
        }
        setProfile(data);
      });

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const isPro = profile?.tier === "pro";

  // showPro를 여기로 옮겨뒀습니다(원래는 activeTab 등과 함께 아래쪽에
  // 선언돼 있었음) - 바로 아래 /billing/callback 처리 useEffect가
  // setShowPro를 마운트 직후에 호출해야 해서, 선언보다 먼저 참조되는
  // TDZ 문제를 피하려면 이 순서가 필요합니다.
  const [showPro, setShowPro] = useState(false);

  // Phase D: 실제 토스페이먼츠 자동결제(빌링) 흐름. 카드 등록창은 브라우저를
  // successUrl/failUrl로 실제 리다이렉트시키므로(팝업 아님), 이 함수는
  // 리다이렉트가 일어나기 전까지만 실행됩니다 - 이후 처리는 아래 두
  // useEffect(콜백 URL 파싱 + confirm-billing 호출)가 담당합니다.
  const [paymentStarting, setPaymentStarting] = useState(false);
  const [billingStatus, setBillingStatus] = useState(null); // null | 'processing' | 'success' | 'error'
  const [billingMessage, setBillingMessage] = useState("");
  const [pendingBillingAuth, setPendingBillingAuth] = useState(null);

  const handleStartPayment = async (plan) => {
    if (!session?.user?.id) {
      alert("구독은 로그인 후 이용할 수 있어요.");
      setShowAuthModal(true);
      return;
    }

    setPaymentStarting(true);
    try {
      const { customerKey } = await startBilling(plan, session.access_token);
      const tossPayments = await loadTossPayments(import.meta.env.VITE_TOSS_CLIENT_KEY);
      const payment = tossPayments.payment({ customerKey });

      // successUrl/failUrl을 같은 경로로 통일하고, 아래 useEffect가
      // authKey(성공)/message(실패) 중 무엇이 붙어왔는지로 구분합니다.
      await payment.requestBillingAuth({
        method: "CARD",
        successUrl: `${window.location.origin}/billing/callback`,
        failUrl: `${window.location.origin}/billing/callback`,
        customerEmail: session.user.email,
      });
    } catch (error) {
      console.error("[왓츠트렌드] 카드 등록 시작 실패:", error.message);
      alert(error.message || "카드 등록을 시작하지 못했어요.");
    } finally {
      setPaymentStarting(false);
    }
  };

  // /billing/callback으로 돌아왔을 때 URL을 1회만 파싱합니다(기존
  // trend/keyword 쿼리 파라미터 처리 useEffect와 동일한 패턴). 이 시점에
  // session이 아직 준비되지 않았을 수 있어(getSession()이 비동기), 여기서는
  // authKey/customerKey만 저장해두고 실제 confirm-billing 호출은 아래
  // 별도 useEffect가 session이 준비된 뒤에 수행합니다.
  useEffect(() => {
    if (window.location.pathname !== "/billing/callback") return;

    const params = new URLSearchParams(window.location.search);
    const authKey = params.get("authKey");
    const customerKey = params.get("customerKey");
    const failMessage = params.get("message");

    window.history.replaceState({}, "", "/");
    setShowPro(true);

    if (authKey && customerKey) {
      setBillingStatus("processing");
      setPendingBillingAuth({ authKey, customerKey });
    } else if (failMessage) {
      setBillingStatus("error");
      setBillingMessage(failMessage);
    }
  }, []);

  useEffect(() => {
    if (!pendingBillingAuth || !session?.access_token) return;

    const { authKey, customerKey } = pendingBillingAuth;
    setPendingBillingAuth(null);

    confirmBilling({ authKey, customerKey }, session.access_token)
      .then((data) => {
        setProfile((prev) => ({ ...prev, tier: data.tier }));
        setBillingStatus("success");
      })
      .catch((error) => {
        setBillingStatus("error");
        setBillingMessage(error.message || "구독 확정에 실패했어요.");
      });
  }, [pendingBillingAuth, session?.access_token]);

  const handleLogout = async () => {
    const confirmed = window.confirm("로그아웃 하시겠어요?");
    if (!confirmed) return;
    await supabase.auth.signOut();
  };

  const [activeTab, setActiveTab] = useState("home");
  const [selectedTrend, setSelectedTrend] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notificationSettings, setNotificationSettings] = useState(() => {
    return getNotificationSettings();
  });
  const [unreadCount, _setUnreadCount] = useState(() => {
    return getUnreadNotificationCount();
  });

  // Service Worker 메시지 수신 (등록은 위 Push Notification 초기화에서 처리)
  useEffect(() => {
    if (!isServiceWorkerSupported()) {
      return;
    }

    // Service Worker로부터 메시지 수신 (알림 클릭 등)
    const handleMessage = (event) => {
      if (event.data && event.data.type === 'NOTIFICATION_CLICK') {
        setActiveTab('home');
        setSelectedTrend(null);
      }
    };

    navigator.serviceWorker.addEventListener('message', handleMessage);

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleMessage);
    };
  }, []);

  // URL 파라미터 처리 (알림 클릭으로 온 경우)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const trendId = params.get('trend');
    const keyword = params.get('keyword');

    if (trendId || keyword) {
      // URL 파라미터 제거 (뒤로가기 시 재방문 방지)
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const [savedTrendIds, setSavedTrendIds] = useState([
    normalizedTrends[1].id,
    normalizedTrends[3].id,
  ]);
  const [savedTrendData, setSavedTrendData] = useState({});

  const savedTrends = useMemo(
    () => savedTrendIds
      .map(
        (id) =>
          savedTrendData[id] ??
          normalizedTrends.find((trend) => trend.id === id)
      )
      .filter(Boolean),
    [savedTrendData, savedTrendIds]
  );

  // 최근 본 트렌드 추적 (DetailPage 진입 시)
  useEffect(() => {
    if (selectedTrend) {
      addViewedTrend(selectedTrend);
    }
  }, [selectedTrend]);

  const tabs = [
    { id: "home", label: "홈", icon: <HomeIcon /> },
    { id: "explore", label: "탐색", icon: <SearchIcon /> },
    { id: "my", label: "MY", icon: <BookmarkIcon /> },
    { id: "monitoring", label: "모니터링", icon: <ChartIcon /> },
    { id: "profile", label: "프로필", icon: <UserIcon /> },
  ];

  const goExplore = () => {
    setSelectedTrend(null);
    setActiveTab("explore");
  };

  const selectTrend = (trend) => {
    const normalizedTrend = normalizedTrends.find(
      (item) => item.id === trend.id
    );

    setSelectedTrend(normalizedTrend ?? trend);
  };

  const toggleSave = (trend) => {
    const exists = savedTrendIds.includes(trend.id);

    if (exists) {
      setSavedTrendIds((current) =>
        current.filter((id) => id !== trend.id)
      );
      setSavedTrendData((current) => {
        const next = { ...current };
        delete next[trend.id];
        return next;
      });

      // 개인화 데이터에서도 제거
      removeSavedTrend(trend.id);

      return;
    }

    if (!isPro && savedTrendIds.length >= 5) {
      alert(
        "무료 사용자는 트렌드를 최대 5개까지 저장할 수 있어요."
      );

      return;
    }

    setSavedTrendIds((current) => [...current, trend.id]);
    setSavedTrendData((current) => ({
      ...current,
      [trend.id]: trend,
    }));

    // 개인화 데이터에도 저장
    addSavedTrend(trend);
  };

  const updateNotificationSettings = (newSettings) => {
    const updated = { ...notificationSettings, ...newSettings };
    setNotificationSettings(updated);
    saveNotificationSettings(updated);
    // Push를 켜둔 상태라면 서버의 사용자별 설정도 함께 갱신합니다 (18-3).
    // 구독이 없으면 syncNotificationSettingsToServer가 조용히 아무 것도 하지 않습니다.
    syncNotificationSettingsToServer(updated);
  };

  const goBackToProfile = () => {
    setShowNotifications(false);
    setActiveTab("profile");
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <Logo />

        <nav className="side-nav">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={activeTab === tab.id ? "active" : ""}
              onClick={() => {
                setSelectedTrend(null);
                setActiveTab(tab.id);
              }}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="pro-mini">
            <span className="pro-mini-icon">✦</span>

            <div>
              <strong>WHAT'S TREND PRO</strong>
              <p>더 깊게 발견하세요</p>
            </div>
          </div>

          <p className="sidebar-copy">
            트렌드는 늘,
            <br />
            먼저 발견하는 사람이
            <br />
            가장 앞서갑니다.
          </p>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="mobile-logo">
            <Logo />
          </div>

          <div className="topbar-search">
            <SearchIcon />
            <input placeholder="뭐가 궁금하세요?" />
          </div>

          <div className="topbar-actions">
            <button className="icon-button">
              <BellIcon />
              {unreadCount > 0 && (
                <span className={`notification-dot ${unreadCount > 1 ? "with-count" : ""}`}>
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>

            <button
              className="profile-button"
              onClick={() => {
                if (session) {
                  handleLogout();
                } else {
                  setShowAuthModal(true);
                }
              }}
            >
              <span className="profile-avatar">
                {session?.user?.email ? session.user.email[0].toUpperCase() : "J"}
              </span>
              <span className="profile-name">{session ? "로그아웃" : "MY"}</span>
            </button>
          </div>
        </header>

        {showOnboarding ? (
          <OnboardingPage
            onComplete={() => {
              setShowOnboarding(false);
              setActiveTab("home");
            }}
            onSkip={() => {
              setShowOnboarding(false);
              setActiveTab("home");
            }}
          />
        ) : showPro ? (
          <ProPage
            onClose={() => setShowPro(false)}
            isPro={isPro}
            onStartPayment={handleStartPayment}
            paymentStarting={paymentStarting}
          />
        ) : selectedTrend ? (
          <DetailPage
            trend={selectedTrend}
            onBack={goExplore}
            onSave={toggleSave}
            isSaved={savedTrends.some(
              (item) => item.id === selectedTrend.id
            )}
            isPro={isPro}
            onOpenPro={() => setShowPro(true)}
          />
        ) : activeTab === "home" ? (
          <HomePage
            onSelectTrend={selectTrend}
            onExplore={goExplore}
            isPro={isPro}
          />
        ) : activeTab === "explore" ? (
          <ExplorePage
            onSelectTrend={selectTrend}
            savedTrends={savedTrends}
            onSave={toggleSave}
            isPro={isPro}
          />
        ) : activeTab === "my" ? (
          <MyPage
            savedTrends={savedTrends}
            onSelectTrend={selectTrend}
            onSave={toggleSave}
            isPro={isPro}
            onOpenPro={() => setShowPro(true)}
          />
        ) : showNotifications ? (
          <NotificationSettingsPage
            onClose={goBackToProfile}
            settings={notificationSettings}
            onUpdateSettings={updateNotificationSettings}
          />
        ) : activeTab === "monitoring" ? (
          <KeywordDashboardPage
            session={session}
            isPro={isPro}
            onOpenPro={() => setShowPro(true)}
            onRequireLogin={() => setShowAuthModal(true)}
          />
        ) : activeTab === "profile" ? (
          <ProfilePage
            onOpenPro={() => setShowPro(true)}
            onOpenNotifications={() => setShowNotifications(true)}
            isPro={isPro}
            session={session}
          />
        ) : (
          <div className="content placeholder-page">
            <span className="section-label">
              {activeTab.toUpperCase()}
            </span>
            <h1>곧 만나요.</h1>
          </div>
        )}
      </main>

      <nav className="bottom-nav">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? "active" : ""}
            onClick={() => {
              setSelectedTrend(null);
              setActiveTab(tab.id);
            }}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}

      {billingStatus && (
        <BillingStatusOverlay
          status={billingStatus}
          message={billingMessage}
          onClose={() => {
            setBillingStatus(null);
            setBillingMessage("");
          }}
        />
      )}
    </div>
  );
}

export default App;

