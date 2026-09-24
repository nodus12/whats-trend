// AI 트렌드 분석 데이터 구조 및 기반 구현
// 이 파일은 AI 분석을 위한 데이터 구조와 입력 데이터를 준비합니다.
// 실제 AI API 호출은 하지 않습니다.

/**
 * AI 분석 입력 데이터 구조를 생성합니다.
 * 실제 trend 데이터만 사용하며, 임의의 값을 생성하지 않습니다.
 * @param {Object} trend - 트렌드 객체
 * @returns {Object} AI 분석 입력 데이터
 */
export function buildAIInput(trend) {
  if (!trend) {
    return null;
  }

  // 기사 데이터 정리 - 실제 존재하는 정보만 사용
  const articles = Array.isArray(trend.articles)
    ? trend.articles.map((article) => ({
        title: article.title || null,
        source: article.source || null,
        pubDate: article.pubDate || null,
        link: article.link || null,
      }))
    : [];

  return {
    keyword: trend.keyword || null,
    mentionCount: typeof trend.mentionCount === "number" ? trend.mentionCount : null,
    recentMentionCount:
      typeof trend.recentMentionCount === "number" ? trend.recentMentionCount : null,
    previousMentionCount:
      typeof trend.previousMentionCount === "number" ? trend.previousMentionCount : null,
    growthRate: typeof trend.growthRate === "number" ? trend.growthRate : null,
    growthAvailable: Boolean(trend.growthAvailable),
    relevanceScore:
      typeof trend.relevanceScore === "number" ? trend.relevanceScore : null,
    stage: trend.stage || null,
    stageEmoji: trend.stageEmoji || null,
    nextScore: typeof trend.nextScore === "number" ? trend.nextScore : null,
    nextLevel: trend.nextLevel || null,
    nextAvailable: Boolean(trend.nextAvailable),
    articles,
    articleCount: articles.length,
  };
}

/**
 * AI 분석 결과의 기본 구조를 생성합니다.
 * 실제 AI 분석이 수행되지 않은 상태의 기본값을 반환합니다.
 * @returns {Object} AI 분석 기본 구조
 */
export function createAIAnalysisDefault() {
  return {
    available: false,
    status: "not_available",
    summary: null,
    whyTrending: [],
    keySignals: [],
    relatedTopics: [],
    contentIdeas: [],
    evidence: [],
  };
}

/**
 * 근거 기반 증거 구조를 생성합니다.
 * 실제 기사 데이터만 사용합니다.
 * @param {Object} article - 기사 객체
 * @returns {Object} 증거 구조
 */
export function buildEvidence(article) {
  if (!article) {
    return null;
  }

  return {
    type: "article",
    title: article.title || null,
    source: article.source || null,
    pubDate: article.pubDate || null,
    link: article.link || null,
  };
}

/**
 * 완료 상태의 AI 분석 구조를 생성합니다.
 * @returns {Object} 완료 상태의 AI 분석 기본 구조
 */
function createAIAnalysisCompleted() {
  return {
    available: true,
    status: "completed",
    summary: "",
    attentionReason: null,
    trendInterpretation: null,
    whyTrending: [],
    keySignals: [],
    relatedTopics: [],
    contentIdeas: [],
    actionSuggestion: [],
    evidence: [],
  };
}

/**
 * 데이터 부족 상태의 AI 분석 구조를 생성합니다.
 * @returns {Object} 데이터 부족 상태의 AI 분석 구조
 */
export function createAIAnalysisInsufficientData() {
  return {
    available: false,
    status: "insufficient_data",
    summary: null,
    attentionReason: null,
    trendInterpretation: null,
    whyTrending: [],
    keySignals: [],
    relatedTopics: [],
    contentIdeas: [],
    actionSuggestion: [],
    evidence: [],
  };
}

/**
 * Attention Reason 생성 - "왜 지금 이 트렌드를 주목해야 하는가?"
 * @param {Object} input - AI 분석 입력 데이터
 * @returns {string|null} 주목 이유
 */
function generateAttentionReason(input) {
  const growthRate = input.growthRate;
  const hasGrowth = input.growthAvailable && typeof growthRate === "number";
  const stage = input.stage;

  // 성장률 기반
  if (hasGrowth && growthRate > 0) {
    return `최근 언급량이 ${growthRate}% 증가하며 빠른 확산 신호를 확인할 수 있습니다.`;
  }

  // Stage 기반
  if (stage === "폭발 직전") {
    return "빠른 증가세가 나타나고 있어 확산 속도를 주목할 필요가 있습니다.";
  }
  if (stage === "상승 중") {
    return "관련 관심이 증가하고 있어 초기 확산 흐름을 확인할 수 있습니다.";
  }
  if (stage === "초기 발견") {
    return "아직 크게 확산되지 않았지만 초기 관심 신호가 포착되고 있습니다.";
  }
  if (stage === "지속") {
    return "높은 관심이 유지되고 있어 단기 유행을 넘어 지속성을 살펴볼 수 있습니다.";
  }
  if (stage === "하락") {
    return "최근 관심이 둔화되고 있어 현재 확산세가 약해지는지 확인할 필요가 있습니다.";
  }

  // NEXT 기반
  if (input.nextAvailable && input.nextLevel) {
    return "현재 성장 신호를 바탕으로 추가 확산 가능성을 살펴볼 만합니다.";
  }

  return null;
}

/**
 * Trend Interpretation 생성 - "현재 데이터가 의미하는 바는 무엇인가?"
 * @param {Object} input - AI 분석 입력 데이터
 * @returns {string|null} 트렌드 해석
 */
function generateTrendInterpretation(input) {
  const keyword = input.keyword || "이 트렌드";
  const growthRate = input.growthRate;
  const hasGrowth = input.growthAvailable && typeof growthRate === "number";
  const stage = input.stage;

  // 데이터 부족 시
  if (!hasGrowth && (!input.articles || input.articles.length === 0)) {
    return null;
  }

  // 성장 데이터가 있는 경우
  if (hasGrowth) {
    if (growthRate > 0 && stage) {
      return `최근 언급량이 이전 기간보다 증가하며 상승 구간에 진입하고 있습니다. 현재 확산 속도가 유지되는지 계속 확인할 가치가 있습니다.`;
    }
    if (growthRate < 0 && stage) {
      return `최근 언급량이 이전 기간보다 감소하며 하락 흐름이 나타나고 있습니다. 관심이 둔화되는지 지켜볼 필요가 있습니다.`;
    }
    if (growthRate === 0) {
      return `최근 언급량이 일정하게 유지되고 있습니다. 관심이 안정적으로 지속되는 상태입니다.`;
    }
  }

  // 기사 데이터만 있는 경우
  if (input.articles && input.articles.length > 0) {
    return `${keyword}에 대한 최근 언급이 확인되고 있습니다. 관련 기사와 콘텐츠가 이어지고 있는 상태입니다.`;
  }

  return null;
}

/**
 * Action Suggestion 생성 - "사용자가 지금 할 수 있는 것은 무엇인가?"
 * @param {Object} input - AI 분석 입력 데이터
 * @returns {string[]} 행동 제안 배열
 */
function generateActionSuggestion(input) {
  const keyword = input.keyword;
  if (!keyword) return [];

  const suggestions = [];
  const relatedTopics = generateRelatedTopics(input);

  // 기본 제안
  suggestions.push("관련 키워드와 콘텐츠 소재를 함께 살펴보세요.");

  // 관련 토픽 기반 제안
  if (relatedTopics.length > 0) {
    const topic = relatedTopics[0];
    suggestions.push(`${topic} 등 연관 토픽의 변화도 확인해보세요.`);
  }

  return suggestions.slice(0, 2);
}

/**
 * 데이터 충분성 판단
 * @param {Object} input - AI 분석 입력 데이터
 * @returns {boolean} 데이터 충분 여부
 */
function hasSufficientData(input) {
  if (!input) return false;
  if (!input.keyword) return false;
  if (!Array.isArray(input.articles) || input.articles.length === 0) return false;
  if (typeof input.mentionCount !== "number") return false;
  return true;
}

/**
 * Summary 생성 - 실제 데이터에 기반한 짧은 요약
 * @param {Object} input - AI 분석 입력 데이터
 * @returns {string} 생성된 요약
 */
function generateSummary(input) {
  const keyword = input.keyword || "이 트렌드";
  const growthRate = input.growthRate;
  const hasGrowth = input.growthAvailable && typeof growthRate === "number";

  if (hasGrowth) {
    if (growthRate > 0) {
      return `${keyword}은 이전 기간 대비 언급량이 ${growthRate}% 증가하며 상승세를 보이고 있습니다.`;
    } else if (growthRate < 0) {
      return `${keyword}은 이전 기간 대비 언급량이 ${Math.abs(growthRate)}% 감소하며 관심이 둔화되고 있습니다.`;
    } else {
      return `${keyword}은 최근에도 꾸준한 언급량을 유지하고 있습니다.`;
    }
  }

  if (input.articleCount > 0) {
    return `${keyword}에 대한 최근 언급이 확인되고 있지만 아직 충분한 기간 비교 데이터가 없습니다.`;
  }

  return `${keyword}에 대한 분석 데이터가 제한적입니다.`;
}

/**
 * whyTrending 생성 - 실제 수치 기반
 * @param {Object} input - AI 분석 입력 데이터
 * @returns {string[]} 트렌드 원인 설명 배열
 */
function generateWhyTrending(input) {
  const reasons = [];
  const growthRate = input.growthRate;
  const hasGrowth = input.growthAvailable && typeof growthRate === "number";
  const stage = input.stage;

  // A. 성장률 기반
  if (hasGrowth && growthRate > 0) {
    reasons.push(`최근 언급량이 이전 기간보다 ${growthRate}% 증가했습니다.`);
  } else if (hasGrowth && growthRate < 0) {
    reasons.push(`최근 언급량이 이전 기간보다 ${Math.abs(growthRate)}% 감소했습니다.`);
  }

  // B. 최근 언급량 기반
  if (typeof input.recentMentionCount === "number" && input.recentMentionCount >= 3) {
    reasons.push("최근 24시간 동안 관련 언급이 집중되고 있습니다.");
  }

  // C. Stage 기반
  const stageMessages = {
    "폭발 직전": "최근 증가폭이 커지며 빠르게 확산되는 흐름을 보이고 있습니다.",
    "상승 중": "관련 언급이 증가하면서 상승 구간에 진입하고 있습니다.",
    "초기 발견": "아직 대중적으로 크게 확산되지는 않았지만 관련 신호가 포착되고 있습니다.",
    "지속": "높은 관심이 유지되며 꾸준히 언급되고 있습니다.",
    "하락": "최근 언급량이 줄어들며 관심이 둔화되는 흐름입니다.",
  };

  if (stage && stageMessages[stage]) {
    reasons.push(stageMessages[stage]);
  }

  // D. NEXT 기반 (nextAvailable일 때만)
  if (input.nextAvailable && input.nextLevel) {
    reasons.push("현재 성장 신호를 바탕으로 추가 확산 가능성이 포착되고 있습니다.");
  }

  // 최대 3개로 제한
  return reasons.slice(0, 3);
}

/**
 * keySignals 생성 - 사용자가 한눈에 볼 수 있는 핵심 신호
 * @param {Object} input - AI 분석 입력 데이터
 * @returns {Object[]} 핵심 신호 배열
 */
function generateKeySignals(input) {
  const signals = [];

  if (input.stage) {
    signals.push({ label: "현재 단계", value: input.stage });
  }

  if (input.growthAvailable && typeof input.growthRate === "number") {
    const growthValue = input.growthRate >= 0 ? `+${input.growthRate}%` : `${input.growthRate}%`;
    signals.push({ label: "성장률", value: growthValue });
  }

  if (typeof input.recentMentionCount === "number") {
    signals.push({ label: "최근 언급", value: `${input.recentMentionCount}건` });
  }

  if (input.nextAvailable && input.nextLevel) {
    signals.push({ label: "NEXT", value: input.nextLevel });
  } else {
    signals.push({ label: "NEXT", value: "데이터 부족" });
  }

  return signals;
}

/**
 * 관련 토픽 추출 - 기사 제목에서 키워드 추출
 * @param {Object} input - AI 분석 입력 데이터
 * @returns {string[]} 관련 토픽 배열
 */
function generateRelatedTopics(input) {
  const keyword = input.keyword;
  if (!keyword || !Array.isArray(input.articles)) return [];

  const topics = new Set();

  // 노이즈 불용어 목록
  const noiseWords = new Set([
    "PRO", "LIKE", "NEWS", "TODAY", "BEST", "TOP", "LIVE", "UPDATE",
    "RUN", "NEW", "HOT", "NOW", "HOW", "WHAT", "WHY", "TIP",
    "KBS", "MBC", "SBS", "YTN", "JTBC", "CNN", "BBC", "AP",
    "공식", "기자", "사진", "영상", "관련", "단독", "속보", "공개",
    "출시", "화제", "관심", "인기", "추천", "대해", "대한", "위한",
    "이번", "최근", "오늘", "어제", "내일", "모두", "많이", "너무",
    "성료", "개최", "진행", "밝혔다", "전했다", "예정", "현장",
    "관계자", "보도", "이날", "올해",
    // 도메인/소스 조각
    "DAUM", "NET", "COM", "ORG", "CO", "KR", "NAVER", "NATE",
    "GOOGLE", "YAHOO", "YOUTUBE", "INSTAGRAM", "TIKTOK",
    "daum", "net", "com", "org", "co", "kr", "naver", "nate",
    "google", "yahoo", "youtube", "instagram", "tiktok",
  ]);

  // 조사/접미 표현 패턴
  const particlePatterns = /(에서|으로|에게|까지|부터|만큼|보다|처럼|하고|이나|거나|든지|라도|이라도|나마|이나마|이야|이요|이여|이시여|이여라|이시여라|이로되|이로소이다|에|의|와|과|도|만|은|는|이|가|을|를)$/;

  for (const article of input.articles) {
    if (!article.title) continue;

    // 기사 제목에서 소스 접미사 제거 (예: "제목 - v.daum.net")
    const sourceSuffix = article.source ? ` - ${article.source}` : "";
    const titleWithoutSource = sourceSuffix && article.title.endsWith(sourceSuffix)
      ? article.title.slice(0, -sourceSuffix.length).trim()
      : article.title;

    const cleaned = titleWithoutSource
      .replace(/[^가-힣a-zA-Z0-9\s]/g, " ")
      .trim();

    const words = cleaned
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2)
      .filter((w) => !noiseWords.has(w))
      .filter((w) => !noiseWords.has(w.toUpperCase()));

    for (const word of words) {
      if (word === keyword) continue;

      // 너무 긴 단어 제거 (12자 이상, 단 키워드 포함 복합키워드는 허용)
      if (word.length > 12 && !word.includes(keyword) && !keyword.includes(word)) {
        continue;
      }

      // 조사/접미가 붙은 단어 제거
      if (particlePatterns.test(word)) {
        continue;
      }

      // 숫자만 있는 단어 제거
      if (/^\d+$/.test(word)) {
        continue;
      }

      // 키워드를 포함하는 복합 키워드 우선
      if (word.includes(keyword) || keyword.includes(word)) {
        topics.add(word);
        continue;
      }

      // 의미 있는 단어만 추가 (2-10자)
      if (word.length >= 2 && word.length <= 10) {
        topics.add(word);
      }
    }
  }

  return Array.from(topics).slice(0, 5);
}

/**
 * 콘텐츠 아이디어 생성 - 실제 데이터에 근거
 * @param {Object} input - AI 분석 입력 데이터
 * @returns {string[]} 콘텐츠 아이디어 배열
 */
function generateContentIdeas(input) {
  const keyword = input.keyword;
  const relatedTopics = generateRelatedTopics(input);
  const ideas = [];

  if (!keyword) return ideas;

  ideas.push(`요즘 뜨는 ${keyword} 트렌드, 실제로 얼마나 인기일까?`);

  if (relatedTopics.length > 0) {
    ideas.push(`이번 주 주목할 ${keyword} 관련 ${relatedTopics[0]} 정리`);
  }

  return ideas.slice(0, 2);
}

/**
 * Evidence 생성 - 실제 기사에서 최대 3개 선택
 * @param {Object} input - AI 분석 입력 데이터
 * @returns {Object[]} 증거 배열
 */
function generateEvidence(input) {
  if (!Array.isArray(input.articles) || input.articles.length === 0) return [];
  return input.articles.slice(0, 3).map((article) => buildEvidence(article)).filter(Boolean);
}

/**
 * 규칙 기반 트렌드 분석
 * @param {Object} input - AI 분석 입력 데이터
 * @returns {Object} AI 분석 결과
 */
function analyzeWithRules(input) {
  if (!hasSufficientData(input)) {
    return createAIAnalysisInsufficientData();
  }

  const result = createAIAnalysisCompleted();
  result.summary = generateSummary(input);
  result.attentionReason = generateAttentionReason(input);
  result.trendInterpretation = generateTrendInterpretation(input);
  result.whyTrending = generateWhyTrending(input);
  result.keySignals = generateKeySignals(input);
  result.relatedTopics = generateRelatedTopics(input);
  result.contentIdeas = generateContentIdeas(input);
  result.actionSuggestion = generateActionSuggestion(input);
  result.evidence = generateEvidence(input);

  return result;
}

/**
 * 트렌드 분석 함수 (Provider 독립 인터페이스)
 * @param {Object} input - AI 분석 입력 데이터
 * @returns {Object} AI 분석 결과
 */
export function analyzeTrend(input) {
  return analyzeWithRules(input);
}

/**
 * 트렌드에 AI 분석 결과를 추가합니다.
 * @param {Object} trend - 트렌드 객체
 * @returns {Object} AI 분석 결과가 추가된 트렌드 객체
 */
export function addAIAnalysisToTrend(trend) {
  if (!trend) return trend;

  const aiInput = buildAIInput(trend);
  const aiAnalysis = analyzeTrend(aiInput);

  return { ...trend, aiInput, aiAnalysis };
}

/**
 * 여러 트렌드에 AI 분석 결과를 추가합니다.
 * @param {Array} trends - 트렌드 배열
 * @returns {Array} AI 분석 결과가 추가된 트렌드 배열
 */
export function addAIAnalysisToTrends(trends) {
  if (!Array.isArray(trends)) return [];
  return trends.map((trend) => addAIAnalysisToTrend(trend));
}
