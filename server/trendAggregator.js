const stopWords = new Set([
  "뉴스",
  "오늘",
  "관련",
  "기자",
  "사진",
  "영상",
  "공개",
  "예정",
  "발표",
  "논란",
  "화제",
  "이유",
  "소식",
  "등",
  "및",
  "위해",
  "통해",
  "대한",
  "이번",
  "최근",
  "단독",
  "속보",
  "현장",
  "그룹",
  "배우",
  "가수",
  "전했다",
  "밝혔다",
  "알려졌다",
  "인기",
  "출연",
  "방송",
  "무대",
  "서비스",
  "시장",
  "전망",
]);

import { addAIAnalysisToTrends } from "./aiAnalyzer.js";
import { recordTrendSnapshot, getPreviousSnapshot } from "./trendHistory.js";

const KoreanParticles = [
  "으로부터",
  "에게서",
  "에서는",
  "으로는",
  "까지는",
  "부터는",
  "이라는",
  "이라면",
  "에서",
  "에게",
  "으로",
  "로서",
  "처럼",
  "보다",
  "까지",
  "부터",
  "에는",
  "으로",
  "은",
  "는",
  "이",
  "가",
  "을",
  "를",
  "에",
  "의",
  "와",
  "과",
  "도",
  "만",
];

const STAGE_SCORES = {
  "📈 상승 중": 1.0,
  "🔥 폭발 직전": 0.9,
  "🌱 초기 발견": 0.7,
  "💤 지속": 0.4,
  "📉 하락": 0.1,
};

const NEXT_LEVELS = [
  { min: 90, level: "🔥 매우 높음" },
  { min: 75, level: "🚀 높음" },
  { min: 60, level: "📈 가능성 있음" },
  { min: 40, level: "🌱 관찰 필요" },
  { min: 0, level: "😴 낮음" },
];

function getNextLevel(nextScore) {
  if (
    nextScore === null ||
    nextScore === undefined ||
    typeof nextScore !== "number" ||
    Number.isNaN(nextScore) ||
    !Number.isFinite(nextScore)
  ) {
    return "데이터 부족";
  }

  for (const { min, level } of NEXT_LEVELS) {
    if (nextScore >= min) {
      return level;
    }
  }

  return "😴 낮음";
}

function stripHtml(value) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

// 19-7: 조사(이/가, 은/는, 을/를, 과/와)는 한국어에서 직전 음절의 받침
// 유무에 따라 형태가 갈리는 "이형태" 관계입니다(받침 있으면 이/은/을/과,
// 받침 없으면 가/는/를/와). 예: "사람"(받침 ㅁ)+이 -> "사람이"는 정상이지만,
// "두바"(받침 없음)+이는 문법적으로 성립하지 않으므로 "두바이"의 "이"는
// 조사가 아니라 고유명사(두바이)의 마지막 음절일 가능성이 높습니다.
// 이 규칙이 없던 기존 로직은 "두바이"를 무조건 "두바"로 잘못 잘랐습니다.
// 이 규칙은 위 4쌍(받침 유무로 형태가 결정되는 조사)에만 적용하고, 그 외
// 조사(도/만/에/의 등, 받침에 따라 형태가 바뀌지 않음)는 기존 방식 그대로
// 둡니다 - 이 조사들은 받침 여부로 옳고 그름을 판단할 근거가 없기 때문입니다.
const PARTICLE_ALLOMORPHS = {
  이: true, // 받침 있는 음절 뒤에만 옴 (없으면 "가")
  가: false,
  은: true, // 받침 있는 음절 뒤에만 옴 (없으면 "는")
  는: false,
  을: true, // 받침 있는 음절 뒤에만 옴 (없으면 "를")
  를: false,
  과: true, // 받침 있는 음절 뒤에만 옴 (없으면 "와")
  와: false,
};

// 한글 음절 하나에 받침(종성)이 있는지 확인합니다. 한글 음절이 아니면 null.
function hasFinalConsonant(char) {
  if (!char) {
    return null;
  }

  const code = char.charCodeAt(0);

  if (code < 0xac00 || code > 0xd7a3) {
    return null;
  }

  return (code - 0xac00) % 28 !== 0;
}

/**
 * 19-10: 문자열 끝에 붙은 한국어 조사를 안전하게 제거합니다.
 * tokenizeTitleTokens()가 내부적으로 사용하며, 다른 파일에서 재사용할 수
 * 있도록 export합니다(같은 조사 판단 로직을 여러 곳에 복제하지 않기 위함).
 *
 * 19-7까지: 받침 이형태 조사(이/가, 은/는, 을/를, 과/와)는 직전 문자가
 * 한글 음절일 때만 받침 유무로 판단하고, 판단할 수 없으면(라틴 문자/숫자 등)
 * 보수적으로 제거하지 않았습니다. 그 결과 "두바이" 같은 순수 한글 고유명사는
 * 안전하게 보호했지만, "AI가"/"AI는"/"AI를"/"AI와"처럼 라틴 문자 뒤에 조사가
 * 붙은 경우까지 함께 보호되어 조사가 제거되지 않는 부작용이 있었습니다.
 *
 * 19-10: 직전 문자가 한글 음절이 아닌 경우(라틴 문자/숫자)는 받침 개념 자체가
 * 적용되지 않으므로 받침 이형태 규칙으로 판단할 수 없지만, 이 경우는 안전하게
 * 제거합니다 - "라틴 문자 뒤에 곧바로 한글 조사가 이어지는" 조합이 실제로
 * 하나의 고유명사/외래어인 사례는 사실상 없기 때문입니다(순수 한글 단어와
 * 다른 지점). 즉 판단 기준은 그대로(받침 유무)이고, "판단 불가 시 처리"만
 * "한글 음절인데 판단 불가(거의 없음) -> 유지"와 "애초에 한글 음절이 아님
 * (라틴/숫자) -> 제거"로 세분화했습니다. 한글 음절 뒤의 판단 로직은 전혀
 * 바꾸지 않았으므로 "두바이"/"사람이"/"학교는" 등 기존 동작은 그대로입니다.
 *
 * @param {string} word
 * @returns {string}
 */
export function stripTrailingParticle(word) {
  for (const particle of KoreanParticles) {
    if (word.endsWith(particle) && word.length > particle.length + 1) {
      const requiresFinalConsonant = PARTICLE_ALLOMORPHS[particle];

      if (requiresFinalConsonant !== undefined) {
        const precedingChar = word[word.length - particle.length - 1];
        const precedingHasFinal = hasFinalConsonant(precedingChar);

        // 직전 문자가 한글 음절인데 이형태 규칙과 맞지 않으면(예: "두바"+이)
        // 조사가 아니라 단어의 일부일 가능성이 높으므로 건너뜁니다.
        if (precedingHasFinal !== null && precedingHasFinal !== requiresFinalConsonant) {
          continue;
        }
        // precedingHasFinal === null(라틴 문자/숫자 등 한글 음절이 아님)인
        // 경우는 받침 규칙을 적용할 수 없지만, 아래로 내려가 그대로 제거합니다.
      }

      return word.slice(0, -particle.length);
    }
  }

  return word;
}

// 19-7: 불용어 필터링 전(조사 제거 후) 단어 순서를 그대로 보존한 토큰
// 배열입니다. keywordFiltering.js가 인접한 두 단어로 복합 키워드 후보
// ("두바이 초콜릿" 등)를 만들 때, 중간에 불용어가 있었는지 확인하려면
// 불용어가 제거되기 전의 순서 정보가 필요해서 별도로 export합니다.
// tokenizeTitle()의 최종 반환값(아래)은 이 배열에서 불용어만 한 번 더
// 제거한 것과 완전히 동일합니다 - 기존 동작을 바꾸지 않았습니다.
export function tokenizeTitleTokens(title = "") {
  const cleanedTitle = stripHtml(String(title))
    .toLowerCase()
    .replace(/[^가-힣a-z0-9\s]/gi, " ");

  const tokens = cleanedTitle.match(/[가-힣a-z][가-힣a-z0-9]{1,}/gi) ?? [];

  return tokens.map(stripTrailingParticle).filter((token) => {
    return token.length >= 2 && !/^\d+$/.test(token);
  });
}

// 19-6: keywordExtraction.js가 News/Threads 같은 "텍스트 기반" Signal에서
// 동일한 키워드 추출 로직을 재사용할 수 있도록 export합니다. 함수 내용/동작은
// 전혀 바꾸지 않았고, 가시성만 추가했습니다(기존 aggregateTrends() 내부 호출도 그대로).
export function tokenizeTitle(title = "") {
  return tokenizeTitleTokens(title).filter((token) => !stopWords.has(token));
}

// 19-7: keywordFiltering.js가 기존 stopWords 목록을 중복 정의하지 않고
// 그대로 재사용할 수 있도록 export합니다.
export function isStopWord(token) {
  return stopWords.has(token);
}

function normalizePhrase(value = "") {
  return stripHtml(String(value))
    .toLowerCase()
    .replace(/[^가-힣a-z0-9]/gi, "");
}

function isRelatedKeyword(keyword, query, queryTokens) {
  const normalizedKeyword = normalizePhrase(keyword);
  const normalizedQuery = normalizePhrase(query);

  if (!normalizedKeyword || !normalizedQuery) {
    return false;
  }

  return (
    normalizedKeyword.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedKeyword) ||
    queryTokens.some(
      (queryToken) =>
        normalizedKeyword.includes(queryToken) ||
        queryToken.includes(normalizedKeyword)
    )
  );
}

function countQueryTitles(articles, query) {
  const normalizedQuery = normalizePhrase(query);

  return articles.filter((article) =>
    normalizePhrase(article.title).includes(normalizedQuery)
  ).length;
}

export function calculateGrowthRate(recentCount, previousCount) {
  if (previousCount > 0) {
    return {
      growthRate: Math.round(
        ((recentCount - previousCount) / previousCount) * 1000
      ) / 10,
      growthAvailable: true,
    };
  }

  return {
    growthRate: null,
    growthAvailable: false,
  };
}

export function determineTrendStage(trend) {
  const initialStage = {
    stage: "초기 발견",
    stageEmoji: "🌱",
  };

  if (
    !trend.growthAvailable ||
    typeof trend.growthRate !== "number"
  ) {
    return initialStage;
  }

  if (
    trend.growthRate < 0 &&
    trend.recentMentionCount < trend.previousMentionCount
  ) {
    return {
      stage: "하락",
      stageEmoji: "📉",
    };
  }

  const hasEnoughMentions =
    trend.mentionCount >= 4 && trend.recentMentionCount >= 3;

  if (trend.growthRate >= 100 && hasEnoughMentions) {
    return {
      stage: "폭발 직전",
      stageEmoji: "🔥",
    };
  }

  if (trend.growthRate > 0) {
    return {
      stage: "상승 중",
      stageEmoji: "📈",
    };
  }

  if (trend.mentionCount >= 4 && trend.growthRate === 0) {
    return {
      stage: "지속",
      stageEmoji: "💤",
    };
  }

  return initialStage;
}

/**
 * 키워드의 이번 호출 mentionCount를 이전 호출 시점의 스냅샷과 비교해
 * growthRate를 계산합니다. (server/trendHistory.js의 시계열 스냅샷 저장소 사용)
 *
 * 한 번의 RSS 응답 안에서 기사 시간대를 나누어 비교하던 기존 방식은
 * 상위 10개 기사만 가져오는 구조상 "24~48시간 전" 구간에 기사가 거의
 * 남지 않아 growthAvailable이 항상 false가 되는 한계가 있었습니다.
 * 이 함수는 대신 서로 다른 시점의 API 호출 결과를 비교합니다.
 *
 * @param {string} keyword
 * @param {number} mentionCount - 이번 호출에서 집계된 총 언급 수
 * @param {Date} now
 * @returns {{recentMentionCount:number, previousMentionCount:number, growthRate:number|null, growthAvailable:boolean}}
 */
function getHistoryBasedMetrics(keyword, mentionCount, now = new Date()) {
  if (typeof mentionCount !== "number" || !Number.isFinite(mentionCount)) {
    return {
      recentMentionCount: 0,
      previousMentionCount: 0,
      growthRate: null,
      growthAvailable: false,
    };
  }

  const timestamp = now.getTime();
  const previousSnapshot = getPreviousSnapshot(keyword, timestamp);
  const previousMentionCount = previousSnapshot ? previousSnapshot.count : 0;

  const growth = calculateGrowthRate(mentionCount, previousMentionCount);

  // 다음 호출에서 "이전 스냅샷"으로 쓸 수 있도록 이번 결과를 기록합니다.
  // (비교에 사용한 뒤에 기록해야 이번 스냅샷이 스스로와 비교되지 않습니다.)
  recordTrendSnapshot(keyword, mentionCount, timestamp);

  return {
    recentMentionCount: mentionCount,
    previousMentionCount,
    ...growth,
  };
}

function calculateMaxMetrics(trends) {
  const maxMetrics = {
    maxIncreaseRatio: 0,
    maxGrowthRate: 0,
    maxMentionCount: 0,
    maxRelevance: 0,
    maxArticleCount: 0,
  };

  for (const trend of trends) {
    if (trend.growthRate !== null && trend.growthAvailable !== false) {
      if (trend.previousMentionCount > 0) {
        const ratio = trend.recentMentionCount / trend.previousMentionCount;
        if (Number.isFinite(ratio)) {
          maxMetrics.maxIncreaseRatio = Math.max(maxMetrics.maxIncreaseRatio, ratio);
        }
      }
      maxMetrics.maxGrowthRate = Math.max(maxMetrics.maxGrowthRate, Math.max(0, trend.growthRate));
    }
    maxMetrics.maxMentionCount = Math.max(maxMetrics.maxMentionCount, trend.mentionCount);
    maxMetrics.maxRelevance = Math.max(maxMetrics.maxRelevance, trend.relevanceScore);
    maxMetrics.maxArticleCount = Math.max(maxMetrics.maxArticleCount, trend.articles.length);
  }

  return maxMetrics;
}

function calculateNextScore(trend, maxMetrics) {
  if (trend.growthRate === null || trend.growthAvailable === false) {
    return {
      nextScore: null,
      nextLevel: "데이터 부족",
      nextAvailable: false,
    };
  }

  let recentIncreaseNormalized = 0;
  if (trend.previousMentionCount > 0) {
    const increaseRatio = trend.recentMentionCount / trend.previousMentionCount;
    if (Number.isFinite(increaseRatio) && maxMetrics.maxIncreaseRatio > 0) {
      recentIncreaseNormalized = Math.min(increaseRatio / maxMetrics.maxIncreaseRatio, 1);
    }
  } else if (trend.recentMentionCount > 0) {
    recentIncreaseNormalized = 1;
  }

  let growthRateNormalized = 0;
  if (maxMetrics.maxGrowthRate > 0) {
    growthRateNormalized = Math.min(Math.max(0, trend.growthRate) / maxMetrics.maxGrowthRate, 1);
  }

  let mentionCountNormalized = 0;
  const maxLog = Math.log(maxMetrics.maxMentionCount + 1);
  if (maxLog > 0) {
    mentionCountNormalized = Math.min(Math.log(trend.mentionCount + 1) / maxLog, 1);
  }

  let relevanceNormalized = 0;
  if (maxMetrics.maxRelevance > 0) {
    relevanceNormalized = Math.min(trend.relevanceScore / maxMetrics.maxRelevance, 1);
  }

  let articleCountNormalized = 0;
  if (maxMetrics.maxArticleCount > 0) {
    articleCountNormalized = Math.min(trend.articles.length / maxMetrics.maxArticleCount, 1);
  }

  const stageScore = STAGE_SCORES[trend.stage] ?? 0.5;

  const rawScore =
    recentIncreaseNormalized * 35 +
    growthRateNormalized * 25 +
    mentionCountNormalized * 15 +
    relevanceNormalized * 10 +
    articleCountNormalized * 10 +
    stageScore * 5;

  const nextScore = Math.min(100, Math.max(0, Math.round(rawScore * 10) / 10));

  const nextLevel = getNextLevel(nextScore);

  return {
    nextScore,
    nextLevel,
    nextAvailable: true,
  };
}

function calculateNextScores(trends) {
  const maxMetrics = calculateMaxMetrics(trends);

  return trends.map((trend) => ({
    ...trend,
    ...calculateNextScore(trend, maxMetrics),
  }));
}

function enrichTrends(trends) {
  const withNextScores = calculateNextScores(trends);
  return addAIAnalysisToTrends(withNextScores);
}

export function aggregateTrends(
  newsItems = [],
  query = "AI",
  now = new Date()
) {
  const keywordMap = new Map();
  const queryTokens = tokenizeTitle(query);

  for (const article of newsItems) {
    const keywords = new Set(tokenizeTitle(article.title));

    for (const keyword of keywords) {
      if (!isRelatedKeyword(keyword, query, queryTokens)) {
        continue;
      }

      const current = keywordMap.get(keyword) ?? {
        keyword,
        mentionCount: 0,
        relevanceScore: 0,
        articles: [],
      };

      current.mentionCount += 1;
      current.articles.push(article);
      const queryTitleCount = countQueryTitles(
        current.articles,
        query
      );
      const normalizedKeyword = normalizePhrase(keyword);
      const normalizedQuery = normalizePhrase(query);
      const isExactQuery = normalizedKeyword === normalizedQuery;
      const isDirectMatch = normalizedKeyword.includes(normalizedQuery);

      current.relevanceScore =
        current.mentionCount +
        (isDirectMatch ? (isExactQuery ? 1 : 5) : 0) +
        (isExactQuery ? 0 : 2) +
        (isExactQuery ? 0 : queryTitleCount * 3);
      keywordMap.set(keyword, current);
    }
  }

  return (
    enrichTrends(
      Array.from(keywordMap.values())
        .map((trend) => {
          const timeMetrics = getHistoryBasedMetrics(
            trend.keyword,
            trend.mentionCount,
            now
          );
          const stage = determineTrendStage({
            ...trend,
            ...timeMetrics,
          });

          return {
            ...trend,
            ...timeMetrics,
            ...stage,
          };
        })
        .sort((first, second) => {
          if (second.relevanceScore !== first.relevanceScore) {
            return second.relevanceScore - first.relevanceScore;
          }

          if (second.growthAvailable !== first.growthAvailable) {
            return Number(second.growthAvailable) - Number(first.growthAvailable);
          }

          if (
            second.growthRate !== null &&
            first.growthRate !== null &&
            second.growthRate !== first.growthRate
          ) {
            return second.growthRate - first.growthRate;
          }

          return (
            second.mentionCount - first.mentionCount ||
            first.keyword.localeCompare(second.keyword, "ko")
          );
        })
    )
  );
}
