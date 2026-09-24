// Phase A: 클라이언트(브라우저)용 Supabase client. server/supabase.js와
// 완전히 별개의 파일입니다 - 그 파일은 SUPABASE_SERVICE_ROLE_KEY(RLS를
// 우회하는 서버 전용 비밀키)로 생성되고 이 파일은 VITE_SUPABASE_ANON_KEY
// (브라우저에 노출돼도 되는 공개 키, RLS 정책의 제한을 받음)로 생성됩니다.
// 이 두 키를 혼동하면 안 됩니다 - server/supabase.js는 이 작업에서
// 전혀 건드리지 않았습니다.
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
