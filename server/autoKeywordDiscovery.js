// 8-0단계: 무료 발견 피드(구글 뉴스 기반 /api/trends, server/trendMonitor.js의
// collectTrends())에서 새로 잡힌 키워드를 하루 1회 자동으로 골라
// auto_tracked_keywords에 저장합니다. 이 파일은 "무엇을 자동으로 수집
// 대상에 추가할지"만 책임지고, YouTube/News/Naver 수집이나 종합점수
// 계산 로직은 전혀 건드리지 않습니다(server/scheduler.js가 그대로 담당).
//
// 사용자가 직접 등록한 키워드(tracked_keywords)와는 완전히 분리된
// 테이블(auto_tracked_keywords)에 저장합니다 - tracked_keywords.user_id가
// NOT NULL이라(사전 확인 완료) 사용자 없는 자동 키워드를 그 테이블에
// 넣을 수 없기 때문입니다.
//
// collectTrends()/trendAggregator.js/trendMonitor.js의 기존 로직은 이
// 파일에서 전혀 수정하지 않고 그대로 호출만 합니다.
import { getSupabaseClient, isSupabaseConfigured } from "./supabase.js";
import { collectTrends } from "./trendMonitor.js";
import { listActiveTrackedKeywords } from "./trackedKeywords.js";

export const AUTO_TRACKED_KEYWORDS_TABLE = "auto_tracked_keywords";

// ExplorePage와 동일한 10개 카테고리(사용자 지시 원문 순서 유지).
export const DISCOVERY_CATEGORIES = [
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

export const MAX_AUTO_KEYWORDS = 10;
export const AUTO_KEYWORD_EXPIRY_DAYS = 14;
const DISCOVERY_TIME_WARNING_MS = 3 * 60 * 1000; // 3분

/**
 * 공백/대소문자 차이를 무시하고 키워드를 비교하기 위한 정규화.
 * @param {string} keyword
 * @returns {string}
 */
function normalizeForCompare(keyword) {
  return String(keyword).trim().toLowerCase().replace(/\s+/g, "");
}

// 9-0단계: 후보 필터 보강.
//
// 카테고리명 완전일치 제외 - "맛집/푸드"처럼 "/"로 묶인 복합 카테고리명은
// 그 문자열 전체와의 완전일치만으로는 구성 단어("맛집", "푸드")가
// 후보로 새는 것을 막지 못했습니다(8-0단계 실측 [2]에서 "맛집"이
// "맛집/푸드" 카테고리 결과로 새어 들어온 실제 사례). 그래서 카테고리명을
// "/"로 나눈 구성 단어도 함께 제외 대상 집합에 넣습니다.
//
// 완전일치만 제외하고 부분포함(substring)으로는 제외하지 않습니다 -
// "아시안게임"은 카테고리 구성 단어 "게임"을 포함하지만 독자적인 의미를
// 가진 정상 키워드이므로(8-0단계 실측에서 실제로 선정됨), 부분포함
// 매칭을 쓰면 이런 정상 키워드까지 잘못 제외됩니다.
function buildCategorySeedWords(category) {
  const parts = category
    .split("/")
    .map((part) => normalizeForCompare(part))
    .filter(Boolean);
  return [normalizeForCompare(category), ...parts];
}

const CATEGORY_SEED_WORDS = new Set(DISCOVERY_CATEGORIES.flatMap(buildCategorySeedWords));

// 조사가 붙은 조각 단어 제외 - 한국어 조사 처리에 한계가 있는 기존
// keywordExtraction.js/trendAggregator.js(섹션 14 참고)를 그대로 거쳐
// 나온 후보 중, 여전히 조사가 안 떨어진 조각이 섞여 나오는 경우를
// 한 번 더 걸러냅니다. 3글자 이하로 좁힌 이유: 조사 한 글자가 실제
// 단어의 마지막 글자와 우연히 겹치는 정상 2~3글자 단어(예: "회의",
// "명의")가 있어, 길이 제한 없이 적용하면 오탐이 늘어날 위험이 있기
// 때문입니다. 4글자 이상은 이 규칙으로 걸러지지 않습니다(예:
// "패션위크서"는 5글자라 이 규칙만으로는 안 걸러짐 - 9-0단계 검증
// [1]에서 실측 보고).
const JOSA_ENDINGS = ["서", "로", "는", "은", "이", "가", "을", "를", "에", "의"];
const JOSA_FRAGMENT_MAX_LENGTH = 3;

/**
 * 후보 하나를 최종 후보로 쓸지 판단합니다. 필터 규칙을 이 함수 하나로
 * 모아서, 나중에 규칙을 추가/조정하기 쉽게 합니다.
 *
 * 확장 지점: 새 필터 규칙(예: 금칙어, 지나치게 일반적인 단어 등)은
 * 아래 return 문 앞에 조건을 추가하면 됩니다.
 *
 * @param {{keyword:string, normalized:string}} candidate
 * @param {Set<string>} existingNormalized
 * @returns {{rejected:boolean, reason?:string}}
 */
function evaluateCandidate({ keyword, normalized }, existingNormalized) {
  if (!keyword || keyword.length < 2) {
    return { rejected: true, reason: "too_short" };
  }

  if (CATEGORY_SEED_WORDS.has(normalized)) {
    return { rejected: true, reason: "category_seed_word" };
  }

  if (keyword.length <= JOSA_FRAGMENT_MAX_LENGTH && JOSA_ENDINGS.some((josa) => keyword.endsWith(josa))) {
    return { rejected: true, reason: "josa_fragment" };
  }

  if (existingNormalized.has(normalized)) {
    return { rejected: true, reason: "already_tracked" };
  }

  return { rejected: false };
}

/**
 * 후보 키워드 배열을 "어떤 것을 먼저 고를지" 하나의 규칙으로 정렬합니다.
 * 새 점수 엔진을 따로 만들지 않기 위해, 선정 로직은 이 함수 하나로
 * 통합합니다.
 *
 * 현재 규칙: growthAvailable && growthRate > 0인 후보를 먼저, 그 안에서는
 * growthRate 내림차순. 그 다음은 growthAvailable이 false이거나 growthRate가
 * 0 이하인 후보(제외하지 않고 순위만 뒤로 - 지시사항), mentionCount
 * 내림차순.
 *
 * 확장 지점: 나중에 multiSignalScore/earlySignalScore 등 다른 신호를
 * 반영하고 싶으면, candidate 객체에 해당 값을 실어서 넘기고 아래 정렬
 * 비교 함수에 조건을 추가하면 됩니다(다른 파일은 손댈 필요 없음).
 * @param {Array<{keyword:string, category:string, growthRate:number|null, growthAvailable:boolean, mentionCount:number}>} candidates
 */
function rankCandidates(candidates) {
  return [...candidates].sort((a, b) => {
    const aRising = a.growthAvailable && typeof a.growthRate === "number" && a.growthRate > 0;
    const bRising = b.growthAvailable && typeof b.growthRate === "number" && b.growthRate > 0;

    if (aRising !== bRising) {
      return aRising ? -1 : 1;
    }

    if (aRising && bRising && a.growthRate !== b.growthRate) {
      return b.growthRate - a.growthRate;
    }

    return (b.mentionCount ?? 0) - (a.mentionCount ?? 0);
  });
}

/**
 * 오늘(UTC) 이미 발견 단계가 실행되었는지 확인합니다(하루 1회 제한).
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @returns {Promise<boolean>}
 */
async function hasRunToday(client) {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayStartIso = todayStart.toISOString();

  const { data, error } = await client
    .from(AUTO_TRACKED_KEYWORDS_TABLE)
    .select("id")
    .or(`discovered_at.gte.${todayStartIso},last_seen_at.gte.${todayStartIso}`)
    .limit(1);

  if (error) {
    const sanitized = new Error(`오늘 실행 여부 확인 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "auto_discovery_today_check_failed";
    throw sanitized;
  }

  return Array.isArray(data) && data.length > 0;
}

/**
 * 9-1단계: 대시보드가 "자동 발견" 탭에 보여줄 목록입니다. 로그인 여부만
 * 확인하면 누구나 볼 수 있는 읽기 전용 목록이라(자동 키워드는 특정
 * 사용자 소유가 아님), userId로 필터링하지 않습니다. is_active=true인
 * 것만 반환합니다(만료 처리는 expireAutoKeywords()가 이미 담당).
 * @returns {Promise<Array<{keyword:string, discovered_at:string, expires_at:string}>>}
 */
export async function listActiveAutoKeywords() {
  if (!isSupabaseConfigured()) {
    const error = new Error("Supabase가 설정되지 않았습니다.");
    error.code = "supabase_not_configured";
    throw error;
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from(AUTO_TRACKED_KEYWORDS_TABLE)
    .select("keyword, discovered_at, expires_at")
    .eq("is_active", true)
    .order("discovered_at", { ascending: false });

  if (error) {
    const sanitized = new Error(`자동 발견 키워드 조회 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "auto_discovery_list_failed";
    throw sanitized;
  }

  return data ?? [];
}

/**
 * 만료된(expires_at이 지난) 자동 키워드를 is_active=false로 바꿉니다.
 * discoverTrendingKeywords()의 하루 1회 제한과 무관하게, 스케줄러가
 * 실행될 때마다(하루 3회) 매번 호출해도 안전합니다(단순 비교/업데이트).
 * @returns {Promise<{expired:number}>}
 */
export async function expireAutoKeywords() {
  if (!isSupabaseConfigured()) {
    return { expired: 0, skipped: true, reason: "supabase_not_configured" };
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from(AUTO_TRACKED_KEYWORDS_TABLE)
    .update({ is_active: false })
    .lt("expires_at", new Date().toISOString())
    .eq("is_active", true)
    .select("id, keyword");

  if (error) {
    const sanitized = new Error(`자동 키워드 만료 처리 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "auto_discovery_expire_failed";
    throw sanitized;
  }

  const expiredRows = data ?? [];
  if (expiredRows.length > 0) {
    console.log(
      `[Auto Discovery] 만료 처리된 키워드 ${expiredRows.length}개:`,
      expiredRows.map((row) => row.keyword)
    );
  }

  return { expired: expiredRows.length };
}

/**
 * 무료 발견 피드(10개 카테고리)를 순회하며 새로 뜨는 키워드를 찾아
 * auto_tracked_keywords에 upsert합니다. 하루 1회만 실제로 동작하고,
 * 이미 오늘 실행되었다면 즉시 skipped를 반환합니다.
 *
 * 카테고리 하나가 실패해도 나머지 카테고리는 계속 진행합니다(격리).
 *
 * @returns {Promise<{skipped:boolean, reason?:string, selected?:Array<object>, elapsedMs?:number}>}
 */
export async function discoverTrendingKeywords() {
  if (!isSupabaseConfigured()) {
    console.log("[Auto Discovery] Supabase가 설정되지 않아 건너뜁니다.");
    return { skipped: true, reason: "supabase_not_configured" };
  }

  const client = getSupabaseClient();

  let alreadyRunToday = false;
  try {
    alreadyRunToday = await hasRunToday(client);
  } catch (error) {
    console.error("[Auto Discovery] 오늘 실행 여부 확인 실패(이번 사이클은 건너뜀):", error.message);
    return { skipped: true, reason: "today_check_failed" };
  }

  if (alreadyRunToday) {
    console.log("[Auto Discovery] 오늘 이미 발견 단계를 실행했으므로 건너뜁니다.");
    return { skipped: true, reason: "already_run_today" };
  }

  const startedAt = Date.now();

  const [userKeywords, existingAutoRows] = await Promise.all([
    listActiveTrackedKeywords(),
    client.from(AUTO_TRACKED_KEYWORDS_TABLE).select("keyword").eq("is_active", true),
  ]);

  if (existingAutoRows.error) {
    console.error("[Auto Discovery] 기존 자동 키워드 조회 실패(이번 사이클은 건너뜀):", existingAutoRows.error.message);
    return { skipped: true, reason: "existing_auto_keywords_query_failed" };
  }

  const existingNormalized = new Set([
    ...userKeywords.map((row) => normalizeForCompare(row.keyword)),
    ...(existingAutoRows.data ?? []).map((row) => normalizeForCompare(row.keyword)),
  ]);

  const candidateMap = new Map();

  for (const category of DISCOVERY_CATEGORIES) {
    try {
      const { trends } = await collectTrends(category);

      for (const trend of trends) {
        const keyword = typeof trend.keyword === "string" ? trend.keyword.trim() : "";
        const normalized = normalizeForCompare(keyword);

        const evaluation = evaluateCandidate({ keyword, normalized }, existingNormalized);
        if (evaluation.rejected) {
          continue;
        }

        if (candidateMap.has(normalized)) {
          continue; // 여러 카테고리에 같은 키워드가 나오면 먼저 잡힌 것만 사용
        }

        candidateMap.set(normalized, {
          keyword,
          category,
          growthRate: trend.growthRate,
          growthAvailable: Boolean(trend.growthAvailable),
          mentionCount: typeof trend.mentionCount === "number" ? trend.mentionCount : 0,
        });
      }
    } catch (error) {
      console.error(`[Auto Discovery] "${category}" 카테고리 수집 실패(다음 카테고리로 계속 진행):`, error.message);
    }
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(`[Auto Discovery] 카테고리 ${DISCOVERY_CATEGORIES.length}개 탐색 소요 시간: ${elapsedMs}ms`);
  if (elapsedMs > DISCOVERY_TIME_WARNING_MS) {
    console.warn(`[Auto Discovery] 소요 시간이 3분(180000ms)을 초과했습니다: 실제 ${elapsedMs}ms`);
  }

  const ranked = rankCandidates([...candidateMap.values()]);
  const selected = ranked.slice(0, MAX_AUTO_KEYWORDS);

  if (selected.length > 0) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + AUTO_KEYWORD_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const upsertRows = selected.map((candidate) => ({
      keyword: candidate.keyword,
      source_category: candidate.category,
      discovery_score: typeof candidate.growthRate === "number" ? candidate.growthRate : null,
      last_seen_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      is_active: true,
    }));

    const { error: upsertError } = await client
      .from(AUTO_TRACKED_KEYWORDS_TABLE)
      .upsert(upsertRows, { onConflict: "keyword" });

    if (upsertError) {
      const sanitized = new Error(`자동 키워드 upsert 실패: ${upsertError.message ?? "unknown_error"}`);
      sanitized.code = "auto_discovery_upsert_failed";
      throw sanitized;
    }
  }

  console.log(
    `[Auto Discovery] 선정된 키워드 ${selected.length}개:`,
    selected.map((c) => `${c.keyword}(${c.category}, growthRate=${c.growthRate}, growthAvailable=${c.growthAvailable}, mentionCount=${c.mentionCount})`)
  );

  return { skipped: false, selected, elapsedMs };
}
