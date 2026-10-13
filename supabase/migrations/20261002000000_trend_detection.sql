-- 9-2단계(Trend Detection 1차): 테이블 설계.
-- 1차에서는 이 파일을 만들기만 하고, 코드는 아직 이 테이블에 쓰지 않습니다.
-- 2차(Provider/저장/스케줄러 연결) 전에 Supabase SQL Editor에서 실행하세요.
-- 기존 테이블은 건드리지 않습니다(추가만 함). 여러 번 실행해도 안전합니다.

-- 소스별 관측값을 시간순으로 쌓는 테이블.
-- metadata에는 원문 기사/게시물 본문을 넣지 않습니다(CLAUDE.md §41) -
-- 출처 이름, 기사 수, permalink 정도만 둡니다.
create table if not exists trend_signals (
  id bigint generated always as identity primary key,
  keyword text not null,
  keyword_key text not null,          -- keywordExtraction.toCanonicalKeywordKey() 결과(표기 차이 병합용)
  source text not null,               -- youtube / news / naver ...
  signal_type text not null,          -- exposure / demand / buzz / diffusion (collectors/signal.js의 sourceType)
  value numeric not null,
  normalized_value numeric,           -- 0~100 (multiSignalTrendEngine.normalizeSignalValue)
  collected_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- (keyword_key, source, collected_at) 조회용 + 같은 관측값 중복 저장 방지(upsert 기준).
create unique index if not exists trend_signals_key_source_time_uniq
  on trend_signals (keyword_key, source, collected_at);
create index if not exists trend_signals_collected_at_idx
  on trend_signals (collected_at);

-- 계산 결과를 시점별로 남기는 테이블.
create table if not exists trend_snapshots (
  id bigint generated always as identity primary key,
  keyword text not null,
  keyword_key text not null,
  collected_at timestamptz not null,
  volume_score numeric,
  growth_score numeric,
  velocity_score numeric,
  acceleration_score numeric,
  novelty_score numeric,
  spread_score numeric,
  trend_score numeric not null,
  opportunity_score numeric,
  trend_stage text not null check (trend_stage in ('WATCH', 'EARLY', 'RISING', 'HOT', 'VIRAL')),
  trend_type text,                    -- NEW / RISING / SEASONAL / HOT / SATURATED / STABLE (판단 보류면 null)
  source_count integer not null default 0,
  observation_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists trend_snapshots_key_time_uniq
  on trend_snapshots (keyword_key, collected_at);
create index if not exists trend_snapshots_time_score_idx
  on trend_snapshots (collected_at desc, trend_score desc);

-- 서버(service_role)만 접근합니다. 정책은 만들지 않습니다(auto_tracked_keywords와 동일).
alter table trend_signals enable row level security;
alter table trend_snapshots enable row level security;
