// 왓츠트렌드 개인화 데이터 구조 및 관리 유틸리티
// 이 파일은 사용자 개인화 데이터의 저장, 조회, 정규화를 담당합니다.
// 로그인/회원가입 없이 localStorage 기반으로 동작합니다.

const STORAGE_KEY = "whats-trend-personalization";
const ONBOARDING_KEY = "whats-trend-onboarding-completed";
const MAX_VIEWED_TRENDS = 20;
const MAX_ONBOARDING_CATEGORIES = 5;

/**
 * 개인화 데이터의 기본 구조를 반환합니다.
 * localStorage에 데이터가 없거나 손상된 경우 사용됩니다.
 * @returns {Object} 기본 개인화 데이터
 */
export function getDefaultPersonalizationData() {
  return {
    version: 1,
    interests: {
      categories: [],
      keywords: [],
    },
    behavior: {
      viewedTrends: [],
      savedTrends: [],
      hiddenTrends: [],
    },
    settings: {
      personalizationEnabled: true,
    },
  };
}

/**
 * 개인화 데이터를 안전하게 정규화합니다.
 * 누락된 필드나 잘못된 타입을 기본값으로 복구합니다.
 * @param {Object} data - 정규화할 데이터
 * @returns {Object} 정규화된 데이터
 */
export function normalizePersonalizationData(data) {
  const defaults = getDefaultPersonalizationData();

  if (!data || typeof data !== "object") {
    return defaults;
  }

  return {
    version: typeof data.version === "number" ? data.version : defaults.version,
    interests: {
      categories: Array.isArray(data.interests?.categories)
        ? data.interests.categories.filter((c) => typeof c === "string")
        : [],
      keywords: Array.isArray(data.interests?.keywords)
        ? data.interests.keywords.filter((k) => typeof k === "string")
        : [],
    },
    behavior: {
      viewedTrends: Array.isArray(data.behavior?.viewedTrends)
        ? data.behavior.viewedTrends.filter(
            (t) => t && typeof t === "object" && typeof t.id === "string"
          )
        : [],
      savedTrends: Array.isArray(data.behavior?.savedTrends)
        ? data.behavior.savedTrends.filter(
            (t) => t && typeof t === "object" && typeof t.id === "string"
          )
        : [],
      hiddenTrends: Array.isArray(data.behavior?.hiddenTrends)
        ? data.behavior.hiddenTrends.filter(
            (t) => t && typeof t === "object" && typeof t.id === "string"
          )
        : [],
    },
    settings: {
      personalizationEnabled:
        typeof data.settings?.personalizationEnabled === "boolean"
          ? data.settings.personalizationEnabled
          : true,
    },
  };
}

/**
 * localStorage에서 개인화 데이터를 읽어옵니다.
 * 오류가 발생하거나 데이터가 없으면 기본값을 반환합니다.
 * @returns {Object} 개인화 데이터
 */
export function getPersonalizationData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return getDefaultPersonalizationData();
    }

    const parsed = JSON.parse(raw);
    return normalizePersonalizationData(parsed);
  } catch {
    return getDefaultPersonalizationData();
  }
}

/**
 * 개인화 데이터를 localStorage에 저장합니다.
 * @param {Object} data - 저장할 개인화 데이터
 * @returns {boolean} 저장 성공 여부
 */
export function savePersonalizationData(data) {
  try {
    const normalized = normalizePersonalizationData(data);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

/**
 * 관심 카테고리를 업데이트합니다.
 * 중복 카테고리는 저장되지 않습니다.
 * @param {string[]} categories - 관심 카테고리 배열
 * @returns {boolean} 업데이트 성공 여부
 */
export function updateInterests(categories) {
  try {
    const data = getPersonalizationData();
    const validCategories = Array.isArray(categories)
      ? categories.filter((c) => typeof c === "string" && c.length > 0)
      : [];

    // 중복 제거
    data.interests.categories = [...new Set(validCategories)];
    return savePersonalizationData(data);
  } catch {
    return false;
  }
}

/**
 * 관심 카테고리를 추가합니다.
 * @param {string} category - 추가할 카테고리
 * @returns {boolean} 추가 성공 여부
 */
export function addInterestCategory(category) {
  try {
    if (typeof category !== "string" || category.length === 0) {
      return false;
    }

    const data = getPersonalizationData();
    if (!data.interests.categories.includes(category)) {
      data.interests.categories.push(category);
      return savePersonalizationData(data);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 관심 카테고리를 제거합니다.
 * @param {string} category - 제거할 카테고리
 * @returns {boolean} 제거 성공 여부
 */
export function removeInterestCategory(category) {
  try {
    const data = getPersonalizationData();
    data.interests.categories = data.interests.categories.filter(
      (c) => c !== category
    );
    return savePersonalizationData(data);
  } catch {
    return false;
  }
}

/**
 * 안정적인 trend ID를 생성합니다.
 * mock 트렌드와 API 트렌드 모두에서 동작합니다.
 * @param {Object} trend - 트렌드 객체
 * @returns {string} 안정적인 trend ID
 */
export function getStableTrendId(trend) {
  if (!trend) return null;

  // 1. 기존 id가 있으면 사용
  if (typeof trend.id === "string" && trend.id.length > 0) {
    return trend.id;
  }

  // 2. API 트렌드: keyword 기반 ID 생성
  if (typeof trend.keyword === "string" && trend.keyword.length > 0) {
    return `trend-${trend.keyword}`;
  }

  // 3. mock 트렌드: title 기반 ID 생성
  if (typeof trend.title === "string" && trend.title.length > 0) {
    return `trend-${trend.title}`;
  }

  return null;
}

/**
 * 최근 본 트렌드를 추가합니다.
 * 동일한 트렌드가 있으면 viewedAt만 업데이트합니다.
 * 최대 MAX_VIEWED_TRENDS개까지만 유지합니다.
 * @param {Object} trend - 본 트렌드 객체
 * @returns {boolean} 추가 성공 여부
 */
export function addViewedTrend(trend) {
  try {
    const id = getStableTrendId(trend);
    if (!id) return false;

    const data = getPersonalizationData();
    const now = new Date().toISOString();

    // 기존 항목 제거
    data.behavior.viewedTrends = data.behavior.viewedTrends.filter(
      (t) => t.id !== id
    );

    // 새 항목 추가 (최신순으로 앞에 추가)
    const viewedTrend = {
      id,
      keyword: trend.keyword || trend.title || id.replace("trend-", ""),
      category: trend.category || "전체",
      viewedAt: now,
    };

    data.behavior.viewedTrends.unshift(viewedTrend);

    // 최대 개수 제한
    if (data.behavior.viewedTrends.length > MAX_VIEWED_TRENDS) {
      data.behavior.viewedTrends = data.behavior.viewedTrends.slice(
        0,
        MAX_VIEWED_TRENDS
      );
    }

    return savePersonalizationData(data);
  } catch {
    return false;
  }
}

/**
 * 최근 본 트렌드를 제거합니다.
 * @param {string} trendId - 제거할 트렌드 ID
 * @returns {boolean} 제거 성공 여부
 */
export function removeViewedTrend(trendId) {
  try {
    if (typeof trendId !== "string") return false;

    const data = getPersonalizationData();
    data.behavior.viewedTrends = data.behavior.viewedTrends.filter(
      (t) => t.id !== trendId
    );
    return savePersonalizationData(data);
  } catch {
    return false;
  }
}

/**
 * 저장한 트렌드를 개인화 데이터에 동기화합니다.
 * 기존 MY 저장 기능과 연결됩니다.
 * @param {Object} trend - 저장한 트렌드 객체
 * @returns {boolean} 동기화 성공 여부
 */
export function addSavedTrend(trend) {
  try {
    const id = getStableTrendId(trend);
    if (!id) return false;

    const data = getPersonalizationData();
    const now = new Date().toISOString();

    // 기존 항목 제거
    data.behavior.savedTrends = data.behavior.savedTrends.filter(
      (t) => t.id !== id
    );

    // 새 항목 추가
    const savedTrend = {
      id,
      keyword: trend.keyword || trend.title || id.replace("trend-", ""),
      category: trend.category || "전체",
      savedAt: now,
    };

    data.behavior.savedTrends.unshift(savedTrend);
    return savePersonalizationData(data);
  } catch {
    return false;
  }
}

/**
 * 저장한 트렌드를 개인화 데이터에서 제거합니다.
 * @param {string} trendId - 제거할 트렌드 ID
 * @returns {boolean} 제거 성공 여부
 */
export function removeSavedTrend(trendId) {
  try {
    if (typeof trendId !== "string") return false;

    const data = getPersonalizationData();
    data.behavior.savedTrends = data.behavior.savedTrends.filter(
      (t) => t.id !== trendId
    );
    return savePersonalizationData(data);
  } catch {
    return false;
  }
}

/**
 * 관심 없는 트렌드를 추가합니다.
 * @param {Object} trend - 관심 없는 트렌드 객체
 * @returns {boolean} 추가 성공 여부
 */
export function addHiddenTrend(trend) {
  try {
    const id = getStableTrendId(trend);
    if (!id) return false;

    const data = getPersonalizationData();
    const now = new Date().toISOString();

    // 기존 항목 제거
    data.behavior.hiddenTrends = data.behavior.hiddenTrends.filter(
      (t) => t.id !== id
    );

    // 새 항목 추가
    const hiddenTrend = {
      id,
      keyword: trend.keyword || trend.title || id.replace("trend-", ""),
      hiddenAt: now,
    };

    data.behavior.hiddenTrends.unshift(hiddenTrend);
    return savePersonalizationData(data);
  } catch {
    return false;
  }
}

/**
 * 관심 없는 트렌드를 제거합니다.
 * @param {string} trendId - 제거할 트렌드 ID
 * @returns {boolean} 제거 성공 여부
 */
export function removeHiddenTrend(trendId) {
  try {
    if (typeof trendId !== "string") return false;

    const data = getPersonalizationData();
    data.behavior.hiddenTrends = data.behavior.hiddenTrends.filter(
      (t) => t.id !== trendId
    );
    return savePersonalizationData(data);
  } catch {
    return false;
  }
}

/**
 * 개인화 설정을 업데이트합니다.
 * @param {boolean} enabled - 개인화 활성화 여부
 * @returns {boolean} 업데이트 성공 여부
 */
export function setPersonalizationEnabled(enabled) {
  try {
    const data = getPersonalizationData();
    data.settings.personalizationEnabled = Boolean(enabled);
    return savePersonalizationData(data);
  } catch {
    return false;
  }
}

/**
 * 개인화 데이터를 초기화합니다.
 * @returns {boolean} 초기화 성공 여부
 */
export function resetPersonalizationData() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// 개인화 추천 점수 알고리즘
// ============================================================

/**
 * 텍스트를 안전하게 정규화합니다.
 * 소문자화, 앞뒤 공백 제거, 연속 공백 정리를 수행합니다.
 * @param {string} text - 정규화할 텍스트
 * @returns {string} 정규화된 텍스트
 */
export function normalizeText(text) {
  if (typeof text !== "string") return "";
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 두 텍스트가 관련이 있는지 간단히 판단합니다.
 * 외부 라이브러리 없이 안전한 문자열 비교만 수행합니다.
 * @param {string} text1 - 첫 번째 텍스트
 * @param {string} text2 - 두 번째 텍스트
 * @returns {boolean} 관련성 여부
 */
export function areTextsRelated(text1, text2) {
  const norm1 = normalizeText(text1);
  const norm2 = normalizeText(text2);

  if (!norm1 || !norm2) return false;
  if (norm1 === norm2) return true;

  // 하나가 다른 하나를 포함하는지 확인
  if (norm1.includes(norm2) || norm2.includes(norm1)) return true;

  // 공통 단어가 있는지 확인 (2글자 이상의 단어만)
  const words1 = norm1.split(" ").filter((w) => w.length >= 2);
  const words2 = norm2.split(" ").filter((w) => w.length >= 2);

  if (words1.length === 0 || words2.length === 0) return false;

  const commonWords = words1.filter((w) => words2.includes(w));
  return commonWords.length > 0;
}

/**
 * 최근 본 트렌드의 시간 기반 가중치를 계산합니다.
 * @param {string} viewedAt - 본 시간 (ISO 문자열)
 * @returns {number} 가중치 (0.2 ~ 1.0)
 */
function getViewedTimeWeight(viewedAt) {
  try {
    const viewedDate = new Date(viewedAt);
    const now = new Date();
    const diffMs = now - viewedDate;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffDays <= 3) return 1.0;
    if (diffDays <= 7) return 0.7;
    if (diffDays <= 20) return 0.4;
    return 0.2;
  } catch {
    return 0.3;
  }
}

/**
 * 카테고리 일치 점수를 계산합니다.
 * @param {Object} trend - 트렌드 객체
 * @param {Object} personalizationData - 개인화 데이터
 * @returns {number} 카테고리 일치 점수 (0 또는 30)
 */
function calculateCategoryMatch(trend, personalizationData) {
  try {
    const categories = personalizationData?.interests?.categories;
    if (!Array.isArray(categories) || categories.length === 0) return 0;

    const trendCategory = normalizeText(trend?.category || "");
    if (!trendCategory) return 0;

    // "전체"는 개인화 관심 카테고리로 취급하지 않음
    const validCategories = categories.filter(
      (c) => normalizeText(c) !== "전체"
    );
    if (validCategories.length === 0) return 0;

    const isMatch = validCategories.some(
      (c) => normalizeText(c) === trendCategory
    );

    return isMatch ? 30 : 0;
  } catch {
    return 0;
  }
}

/**
 * 키워드 일치 점수를 계산합니다.
 * @param {Object} trend - 트렌드 객체
 * @param {Object} personalizationData - 개인화 데이터
 * @returns {number} 키워드 일치 점수 (0 또는 25)
 */
function calculateKeywordMatch(trend, personalizationData) {
  try {
    const keywords = personalizationData?.interests?.keywords;
    if (!Array.isArray(keywords) || keywords.length === 0) return 0;

    const validKeywords = keywords.filter(
      (k) => typeof k === "string" && k.trim().length > 0
    );
    if (validKeywords.length === 0) return 0;

    const trendKeyword = normalizeText(trend?.keyword || "");
    const trendTitle = normalizeText(trend?.title || "");
    const trendText = `${trendKeyword} ${trendTitle}`.trim();

    if (!trendText) return 0;

    const isMatch = validKeywords.some((keyword) => {
      const normalizedKeyword = normalizeText(keyword);
      if (!normalizedKeyword) return false;
      return (
        trendText.includes(normalizedKeyword) ||
        normalizedKeyword.includes(trendKeyword)
      );
    });

    return isMatch ? 25 : 0;
  } catch {
    return 0;
  }
}

/**
 * 최근 본 트렌드와의 연관성 점수를 계산합니다.
 * @param {Object} trend - 트렌드 객체
 * @param {Object} personalizationData - 개인화 데이터
 * @returns {number} 최근 본 연관성 점수 (0 ~ 20)
 */
function calculateViewedRelation(trend, personalizationData) {
  try {
    const viewedTrends = personalizationData?.behavior?.viewedTrends;
    if (!Array.isArray(viewedTrends) || viewedTrends.length === 0) return 0;

    const trendId = getStableTrendId(trend);
    const trendKeyword = normalizeText(trend?.keyword || trend?.title || "");

    let maxScore = 0;

    for (const viewed of viewedTrends) {
      if (!viewed || typeof viewed !== "object") continue;

      const viewedKeyword = normalizeText(viewed.keyword || "");
      const timeWeight = getViewedTimeWeight(viewed.viewedAt);

      // 동일 트렌드 ID인 경우 강한 연관성
      if (trendId && viewed.id === trendId) {
        maxScore = Math.max(maxScore, 20 * timeWeight);
        continue;
      }

      // 키워드 포함 관계 확인
      if (
        trendKeyword &&
        viewedKeyword &&
        (trendKeyword.includes(viewedKeyword) ||
          viewedKeyword.includes(trendKeyword))
      ) {
        maxScore = Math.max(maxScore, 15 * timeWeight);
        continue;
      }

      // 공통 단어 기반 연관성
      if (
        trendKeyword &&
        viewedKeyword &&
        areTextsRelated(trendKeyword, viewedKeyword)
      ) {
        maxScore = Math.max(maxScore, 10 * timeWeight);
      }
    }

    return Math.min(20, maxScore);
  } catch {
    return 0;
  }
}

/**
 * 저장한 트렌드와의 연관성 점수를 계산합니다.
 * @param {Object} trend - 트렌드 객체
 * @param {Object} personalizationData - 개인화 데이터
 * @returns {number} 저장 연관성 점수 (0 ~ 15)
 */
function calculateSavedRelation(trend, personalizationData) {
  try {
    const savedTrends = personalizationData?.behavior?.savedTrends;
    if (!Array.isArray(savedTrends) || savedTrends.length === 0) return 0;

    const trendId = getStableTrendId(trend);
    const trendKeyword = normalizeText(trend?.keyword || trend?.title || "");

    let maxScore = 0;

    for (const saved of savedTrends) {
      if (!saved || typeof saved !== "object") continue;

      const savedKeyword = normalizeText(saved.keyword || "");

      // 동일 트렌드 ID인 경우 강한 연관성
      if (trendId && saved.id === trendId) {
        maxScore = Math.max(maxScore, 15);
        continue;
      }

      // 키워드 포함 관계 확인
      if (
        trendKeyword &&
        savedKeyword &&
        (trendKeyword.includes(savedKeyword) ||
          savedKeyword.includes(trendKeyword))
      ) {
        maxScore = Math.max(maxScore, 12);
        continue;
      }

      // 공통 단어 기반 연관성
      if (
        trendKeyword &&
        savedKeyword &&
        areTextsRelated(trendKeyword, savedKeyword)
      ) {
        maxScore = Math.max(maxScore, 8);
      }
    }

    return Math.min(15, maxScore);
  } catch {
    return 0;
  }
}

/**
 * hidden 트렌드 감점을 계산합니다.
 * @param {Object} trend - 트렌드 객체
 * @param {Object} personalizationData - 개인화 데이터
 * @returns {number} hidden 감점 (0 또는 -50)
 */
function calculateHiddenPenalty(trend, personalizationData) {
  try {
    const hiddenTrends = personalizationData?.behavior?.hiddenTrends;
    if (!Array.isArray(hiddenTrends) || hiddenTrends.length === 0) return 0;

    const trendId = getStableTrendId(trend);
    const isHidden = hiddenTrends.some((h) => h && h.id === trendId);

    return isHidden ? -50 : 0;
  } catch {
    return 0;
  }
}

/**
 * 트렌드가 hidden 상태인지 확인합니다.
 * @param {Object} trend - 트렌드 객체
 * @param {Object} personalizationData - 개인화 데이터
 * @returns {boolean} hidden 여부
 */
export function isTrendHidden(trend, personalizationData) {
  try {
    const trendId = getStableTrendId(trend);
    if (!trendId) return false;

    const hiddenTrends = personalizationData?.behavior?.hiddenTrends;
    if (!Array.isArray(hiddenTrends)) return false;

    return hiddenTrends.some((h) => h && h.id === trendId);
  } catch {
    return false;
  }
}

// ============================================================
// 16-6 행동 기반 개인화 추천 고도화
// ============================================================

/**
 * 특정 트렌드의 조회 횟수를 계산합니다.
 * @param {Object} trend - 트렌드 객체
 * @param {Array} viewedTrends - 조회한 트렌드 배열
 * @returns {number} 조회 횟수
 */
function getViewedCount(trend, viewedTrends) {
  try {
    if (!Array.isArray(viewedTrends) || viewedTrends.length === 0) return 0;

    const trendId = getStableTrendId(trend);
    const trendKeyword = normalizeText(trend?.keyword || trend?.title || "");

    let count = 0;
    for (const viewed of viewedTrends) {
      if (!viewed || typeof viewed !== "object") continue;

      if (trendId && viewed.id === trendId) {
        count += 1;
        continue;
      }

      const viewedKeyword = normalizeText(viewed.keyword || "");
      if (
        trendKeyword &&
        viewedKeyword &&
        (trendKeyword.includes(viewedKeyword) ||
          viewedKeyword.includes(trendKeyword))
      ) {
        count += 1;
      }
    }

    return count;
  } catch {
    return 0;
  }
}

/**
 * 반복 조회 보너스를 계산합니다 (diminishing returns 적용).
 * 같은 트렌드를 여러 번 보면 관심이 높다고 판단하되,
 * 무한정 점수가 오르지 않도록 합니다.
 * @param {number} viewCount - 조회 횟수
 * @returns {number} 반복 조회 보너스 (0 ~ 10)
 */
function calculateRepeatViewBonus(viewCount) {
  try {
    const count = Number(viewCount);
    if (!Number.isFinite(count) || count <= 1) return 0;

    if (count === 2) return 4;
    if (count === 3) return 6;
    if (count === 4) return 8;
    return 10;
  } catch {
    return 0;
  }
}

/**
 * 최근 행동 가중치를 계산합니다.
 * 최근에 조회/저장한 트렌드일수록 높은 가중치를 부여합니다.
 * @param {Object} trend - 트렌드 객체
 * @param {Object} personalizationData - 개인화 데이터
 * @returns {number} 최근 행동 가중치 (0 ~ 10)
 */
function calculateRecentBehaviorBonus(trend, personalizationData) {
  try {
    const data = personalizationData || getDefaultPersonalizationData();
    const viewedTrends = data?.behavior?.viewedTrends;
    const savedTrends = data?.behavior?.savedTrends;

    if (
      (!Array.isArray(viewedTrends) || viewedTrends.length === 0) &&
      (!Array.isArray(savedTrends) || savedTrends.length === 0)
    ) {
      return 0;
    }

    const trendId = getStableTrendId(trend);
    const trendKeyword = normalizeText(trend?.keyword || trend?.title || "");

    let maxRecentScore = 0;
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    if (Array.isArray(viewedTrends)) {
      for (const viewed of viewedTrends) {
        if (!viewed || typeof viewed !== "object") continue;

        const viewedKeyword = normalizeText(viewed.keyword || "");
        const isMatch =
          (trendId && viewed.id === trendId) ||
          (trendKeyword &&
            viewedKeyword &&
            (trendKeyword.includes(viewedKeyword) ||
              viewedKeyword.includes(trendKeyword)));

        if (isMatch && viewed.viewedAt) {
          const viewedTime = new Date(viewed.viewedAt).getTime();
          if (!Number.isNaN(viewedTime)) {
            const daysAgo = Math.max(0, (now - viewedTime) / oneDayMs);
            let timeScore = 0;
            if (daysAgo < 1) timeScore = 8;
            else if (daysAgo < 3) timeScore = 6;
            else if (daysAgo < 5) timeScore = 4;
            else if (daysAgo < 7) timeScore = 2;
            maxRecentScore = Math.max(maxRecentScore, timeScore);
          }
        }
      }
    }

    if (Array.isArray(savedTrends)) {
      for (const saved of savedTrends) {
        if (!saved || typeof saved !== "object") continue;

        const savedKeyword = normalizeText(saved.keyword || "");
        const isMatch =
          (trendId && saved.id === trendId) ||
          (trendKeyword &&
            savedKeyword &&
            (trendKeyword.includes(savedKeyword) ||
              savedKeyword.includes(trendKeyword)));

        if (isMatch && saved.savedAt) {
          const savedTime = new Date(saved.savedAt).getTime();
          if (!Number.isNaN(savedTime)) {
            const daysAgo = Math.max(0, (now - savedTime) / oneDayMs);
            let timeScore = 2;
            if (daysAgo < 1) timeScore = 10;
            else if (daysAgo < 3) timeScore = 8;
            else if (daysAgo < 5) timeScore = 6;
            else if (daysAgo < 7) timeScore = 4;
            maxRecentScore = Math.max(maxRecentScore, timeScore);
          }
        }
      }
    }

    return Math.min(10, maxRecentScore);
  } catch {
    return 0;
  }
}

/**
 * 저장 행동 강화 점수를 계산합니다.
 * 저장은 단순 조회보다 강한 관심 신호로 판단합니다.
 * @param {Object} trend - 트렌드 객체
 * @param {Object} personalizationData - 개인화 데이터
 * @returns {number} 저장 행동 강화 점수 (0 ~ 20)
 */
function calculateSavedBehaviorBonus(trend, personalizationData) {
  try {
    const savedTrends = personalizationData?.behavior?.savedTrends;
    if (!Array.isArray(savedTrends) || savedTrends.length === 0) return 0;

    const trendId = getStableTrendId(trend);
    const trendKeyword = normalizeText(trend?.keyword || trend?.title || "");
    const trendCategory = normalizeText(trend?.category || "");

    let maxBonus = 0;

    for (const saved of savedTrends) {
      if (!saved || typeof saved !== "object") continue;

      const savedKeyword = normalizeText(saved.keyword || "");
      const savedCategory = normalizeText(saved.category || "");

      if (trendId && saved.id === trendId) {
        maxBonus = Math.max(maxBonus, 20);
        continue;
      }

      if (
        trendKeyword &&
        savedKeyword &&
        (trendKeyword.includes(savedKeyword) ||
          savedKeyword.includes(trendKeyword))
      ) {
        maxBonus = Math.max(maxBonus, 15);
        continue;
      }

      if (
        trendKeyword &&
        savedKeyword &&
        areTextsRelated(trendKeyword, savedKeyword)
      ) {
        maxBonus = Math.max(maxBonus, 10);
        continue;
      }

      if (trendCategory && savedCategory && trendCategory === savedCategory) {
        maxBonus = Math.max(maxBonus, 8);
      }
    }

    return Math.min(20, maxBonus);
  } catch {
    return 0;
  }
}

/**
 * 개인화 추천 점수를 계산합니다.
 * 점수는 항상 0~100 범위로 제한됩니다.
 * 16-6: 행동 기반 개인화 추천 고도화 적용
 * @param {Object} trend - 트렌드 객체
 * @param {Object} personalizationData - 개인화 데이터
 * @returns {Object} 점수 및 상세 정보
 */
export function calculatePersonalizationScore(trend, personalizationData) {
  try {
    // null/undefined 안전 처리
    if (!trend || typeof trend !== "object") {
      return {
        score: 0,
        reasons: [],
        signals: {
          categoryMatch: 0,
          keywordMatch: 0,
          viewedRelation: 0,
          savedRelation: 0,
          repeatViewBonus: 0,
          recentBehaviorBonus: 0,
          savedBehaviorBonus: 0,
          hiddenPenalty: 0,
        },
      };
    }

    // personalizationData가 없으면 기본값 사용
    const data = personalizationData || getDefaultPersonalizationData();

    // 각 항목 계산
    const categoryMatch = calculateCategoryMatch(trend, data);
    const keywordMatch = calculateKeywordMatch(trend, data);
    const viewedRelation = calculateViewedRelation(trend, data);
    const savedRelation = calculateSavedRelation(trend, data);
    const hiddenPenalty = calculateHiddenPenalty(trend, data);

    // 16-6 신규: 행동 기반 신호
    const viewedCount = getViewedCount(trend, data?.behavior?.viewedTrends);
    const repeatViewBonus = calculateRepeatViewBonus(viewedCount);
    const recentBehaviorBonus = calculateRecentBehaviorBonus(trend, data);
    const savedBehaviorBonus = calculateSavedBehaviorBonus(trend, data);

    // 기본 점수 + 각 항목 합산
    // 우선순위: 저장 > 최근 반복 조회 > 최근 조회 > 관심 카테고리 > 키워드 > 기본
    const rawScore =
      10 +
      categoryMatch +
      keywordMatch +
      viewedRelation +
      savedRelation +
      repeatViewBonus +
      recentBehaviorBonus +
      savedBehaviorBonus +
      hiddenPenalty;

    // 0~100 범위로 제한
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));

    // 이유 생성
    const reasons = getPersonalizationReasons(trend, data);

    return {
      score,
      reasons,
      signals: {
        categoryMatch,
        keywordMatch,
        viewedRelation,
        savedRelation,
        repeatViewBonus,
        recentBehaviorBonus,
        savedBehaviorBonus,
        hiddenPenalty,
      },
    };
  } catch {
    // 오류 발생 시 안전한 기본값
    return {
      score: 10,
      reasons: ["지금 뜨고 있는 트렌드예요"],
      signals: {
        categoryMatch: 0,
        keywordMatch: 0,
        viewedRelation: 0,
        savedRelation: 0,
        repeatViewBonus: 0,
        recentBehaviorBonus: 0,
        savedBehaviorBonus: 0,
        hiddenPenalty: 0,
      },
    };
  }
}

/**
 * 여러 트렌드의 개인화 점수를 계산합니다.
 * 원본 배열을 변경하지 않고 새로운 배열을 반환합니다.
 * @param {Array} trends - 트렌드 배열
 * @param {Object} personalizationData - 개인화 데이터
 * @returns {Array} personalizationScore가 추가된 트렌드 배열
 */
export function calculatePersonalizationScores(trends, personalizationData) {
  try {
    if (!Array.isArray(trends)) return [];

    return trends.map((trend) => {
      const { score, reasons } = calculatePersonalizationScore(
        trend,
        personalizationData
      );

      // 원본을 변경하지 않고 새로운 객체 반환
      return {
        ...trend,
        personalizationScore: score,
        personalizationReasons: reasons,
      };
    });
  } catch {
    return trends;
  }
}

/**
 * 추천 이유를 생성합니다.
 * 16-6: 행동 기반 추천 이유 추가
 * @param {Object} trend - 트렌드 객체
 * @param {Object} personalizationData - 개인화 데이터
 * @returns {string[]} 추천 이유 배열 (최대 4개)
 */
export function getPersonalizationReasons(trend, personalizationData) {
  try {
    const data = personalizationData || getDefaultPersonalizationData();
    const reasons = [];

    // 우선순위 1: 저장 행동 관련 이유 (가장 강한 신호)
    const savedBehaviorBonus = calculateSavedBehaviorBonus(trend, data);
    if (savedBehaviorBonus > 0) {
      reasons.push("저장한 트렌드와 관련 있어요");
    }

    // 우선순위 2: 반복 조회 이유
    const viewedCount = getViewedCount(trend, data?.behavior?.viewedTrends);
    if (viewedCount >= 3) {
      reasons.push("최근 자주 본 주제와 관련 있어요");
    }

    // 우선순위 3: 최근 행동 이유
    const recentBehaviorBonus = calculateRecentBehaviorBonus(trend, data);
    if (recentBehaviorBonus >= 6) {
      reasons.push("최근 관심이 높아진 분야예요");
    }

    // 우선순위 4: 최근 본 트렌드 연관성
    if (calculateViewedRelation(trend, data) > 0 && reasons.length < 4) {
      reasons.push("최근 본 트렌드와 관련 있어요");
    }

    // 우선순위 5: 관심 카테고리
    if (calculateCategoryMatch(trend, data) > 0 && reasons.length < 4) {
      reasons.push("관심 카테고리와 일치해요");
    }

    // 우선순위 6: 관심 키워드
    if (calculateKeywordMatch(trend, data) > 0 && reasons.length < 4) {
      reasons.push("관심 키워드와 일치해요");
    }

    // 이유가 없으면 기본 이유 제공
    if (reasons.length === 0) {
      reasons.push("지금 뜨고 있는 트렌드예요");
    }

    // 최대 4개로 제한
    return reasons.slice(0, 4);
  } catch {
    return ["지금 뜨고 있는 트렌드예요"];
  }
}

// ============================================================
// 온보딩 관련 함수
// ============================================================

/**
 * 온보딩을 완료 상태로 표시합니다.
 * @returns {boolean} 저장 성공 여부
 */
export function setOnboardingCompleted() {
  try {
    localStorage.setItem(ONBOARDING_KEY, "true");
    return true;
  } catch {
    return false;
  }
}

/**
 * 온보딩 완료 여부를 확인합니다.
 * @returns {boolean} 온보딩 완료 여부
 */
export function isOnboardingCompleted() {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * 온보딩을 다시 표시하도록 초기화합니다.
 * @returns {boolean} 초기화 성공 여부
 */
export function resetOnboarding() {
  try {
    localStorage.removeItem(ONBOARDING_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * 온보딩을 표시해야 하는지 확인합니다.
 * 관심사가 있거나 온보딩을 이미 완료했으면 표시하지 않습니다.
 * @returns {boolean} 온보딩 표시 여부
 */
export function shouldShowOnboarding() {
  try {
    // 이미 온보딩을 완료했으면 표시하지 않음
    if (isOnboardingCompleted()) return false;

    // 관심사가 있으면 표시하지 않음
    const data = getPersonalizationData();
    const categories = data?.interests?.categories;
    if (Array.isArray(categories) && categories.length > 0) return false;

    return true;
  } catch {
    return false;
  }
}

/**
 * 온보딩 카테고리 최대 선택 개수를 반환합니다.
 * @returns {number} 최대 선택 개수
 */
export function getMaxOnboardingCategories() {
  return MAX_ONBOARDING_CATEGORIES;
}
