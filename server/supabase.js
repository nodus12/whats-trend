// 20-11: Supabase client 생성/export
//
// 기존 database.js(SQLite, 로컬 signal_history/trend_history 등)와는 완전히
// 별개의 저장소입니다. Supabase는 이번 단계에서 도입하는 YouTube 일별
// 트렌드 데이터(youtube_daily_trends)만 담당하며, database.js가 관리하는
// 기존 테이블에는 전혀 관여하지 않습니다.
//
// 이 파일은 database.js가 SQLite 연결을 다른 모든 파일이 공유해서 쓰도록
// 만든 것과 동일한 이유로, Supabase client를 한 곳에서만 생성해서
// export합니다 - 향후 다른 기능이 Supabase를 쓰게 되어도 client 생성
// 코드가 여러 파일에 흩어지지 않도록 합니다.
//
// naverDataLabCollector.js/googleTrendsCollector.js의 isNaverConfigured()/
// isGoogleTrendsConfigured()와 동일한 패턴으로, 환경변수가 없으면 client를
// 만들지 않고 명확히 "설정 안 됨" 상태를 노출합니다 - 잘못된 값으로 조용히
// 실패하는 대신, 호출하는 쪽이 이 상태를 보고 graceful하게 처리할 수 있게
// 합니다.
import { createClient } from "@supabase/supabase-js";

let cachedClient = null;
let cachedClientKey = null;

/**
 * SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY가 환경변수에 설정되어 있는지
 * 확인합니다.
 * @returns {boolean}
 */
export function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Supabase client를 반환합니다. 환경변수가 설정되어 있지 않으면 client를
 * 만들지 않고 null을 반환합니다(네트워크 시도 자체를 하지 않음).
 *
 * 같은 프로세스 안에서는 환경변수가 바뀌지 않는 한 client를 재사용합니다
 * (매 호출마다 새 client를 만들지 않기 위함). 테스트 등에서 환경변수를
 * 바꾼 뒤 다시 호출하면 새 client로 갱신됩니다.
 *
 * @returns {import('@supabase/supabase-js').SupabaseClient|null}
 */
export function getSupabaseClient() {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const key = `${process.env.SUPABASE_URL}::${process.env.SUPABASE_SERVICE_ROLE_KEY}`;

  if (cachedClient && cachedClientKey === key) {
    return cachedClient;
  }

  cachedClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  cachedClientKey = key;

  return cachedClient;
}
