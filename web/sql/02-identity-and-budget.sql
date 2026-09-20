-- ─────────────────────────────────────────────
-- MindTeam 추가 스키마 2 — 자아 형성 추적과 예산 원장
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run
-- 선행: 루트의 schema.sql 이 먼저 적용되어 있어야 한다
-- ─────────────────────────────────────────────

-- ─────────────────────────────────────────────
-- 발화의 사고 과정
-- 감정이 무슨 단계를 밟아 그 말에 도달했는지. 자아 형성 과정을 되짚는 원천.
-- [{"label":"무슨 일이 있었나","detail":"..."}, ...]
-- ─────────────────────────────────────────────
alter table public.agent_messages
  add column if not exists thinking_steps jsonb;

-- 어느 모델이 만든 발화인지 (평소 대화는 저렴한 모델, 개입 응답은 좋은 모델)
alter table public.agent_messages
  add column if not exists model text;

-- ─────────────────────────────────────────────
-- self_portraits : 사용자가 직접 쓴 기준 자아
-- 사용자당 한 행. 언제든 고칠 수 있다.
-- ─────────────────────────────────────────────
create table if not exists public.self_portraits (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  content    text not null,
  -- LLM 이 축으로 환산한 값. 내부 저장만 하고 화면에는 문장으로 번역해서 보여준다.
  axes       jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint self_portraits_len check (char_length(content) between 1 and 4000)
);

-- ─────────────────────────────────────────────
-- identity_snapshots : 대화에서 자라난 자아의 시계열
-- 발화가 쌓일 때마다 한 장씩 찍어서, 자아가 어떻게 움직였는지 되짚을 수 있게 한다.
-- ─────────────────────────────────────────────
create table if not exists public.identity_snapshots (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,

  -- 이 스냅샷이 몇 번째 발화까지 반영했는가. 다음 스냅샷 시점을 정하는 기준.
  message_count  int  not null default 0,

  axes           jsonb not null,   -- 자아 축별 0~1
  summary        text  not null,   -- 사용자에게 그대로 보이는 문장 (숫자 금지)
  -- 기준 자아(self_portraits.axes)와 축별 차이. 없으면 기준이 아직 없다는 뜻.
  drift          jsonb,
  drift_note     text,             -- 차이를 설명하는 문장 (숫자 금지)

  created_at     timestamptz not null default now()
);

create index if not exists identity_snapshots_timeline_idx
  on public.identity_snapshots (user_id, created_at desc);

-- ─────────────────────────────────────────────
-- usage_ledger : 토큰·비용 원장
-- 월 예산 상한을 서버에서 강제하는 근거다. 호출 직전에 이 표를 합산해 판단한다.
-- ─────────────────────────────────────────────
create table if not exists public.usage_ledger (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,

  purpose            text not null,   -- ambient | response | analysis | identity | profile | summary
  model              text not null,

  input_tokens       int  not null default 0,
  output_tokens      int  not null default 0,
  cache_read_tokens  int  not null default 0,
  cache_write_tokens int  not null default 0,
  cost_usd           numeric(12, 6) not null default 0,

  created_at         timestamptz not null default now(),

  constraint usage_ledger_cost_nonneg check (cost_usd >= 0)
);

-- 이번 달 합산을 빠르게 하기 위한 인덱스
create index if not exists usage_ledger_month_idx
  on public.usage_ledger (user_id, created_at desc);

-- ─────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────
alter table public.self_portraits      enable row level security;
alter table public.identity_snapshots  enable row level security;
alter table public.usage_ledger        enable row level security;

drop policy if exists "own portrait" on public.self_portraits;
create policy "own portrait" on public.self_portraits
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own snapshots" on public.identity_snapshots;
create policy "own snapshots" on public.identity_snapshots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 원장은 읽기와 추가만 허용한다.
-- update/delete 정책을 일부러 만들지 않는다 — 기록을 지워서 예산 상한을 빠져나가는 길을 막는다.
drop policy if exists "own ledger read"   on public.usage_ledger;
drop policy if exists "own ledger insert" on public.usage_ledger;
create policy "own ledger read" on public.usage_ledger
  for select using (auth.uid() = user_id);
create policy "own ledger insert" on public.usage_ledger
  for insert with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- 이번 달 지출 합산
-- 원장을 전부 내려받아 JS 에서 더하면 라운드마다 수천 행을 읽게 된다.
-- security invoker 라서 RLS 가 그대로 적용된다 — 남의 원장은 보이지 않는다.
-- ─────────────────────────────────────────────
create or replace function public.month_spend(p_from timestamptz)
returns table (cost numeric, calls bigint)
language sql
security invoker
stable
as $$
  select coalesce(sum(cost_usd), 0)::numeric, count(*)::bigint
    from public.usage_ledger
   where user_id = auth.uid()
     and created_at >= p_from;
$$;

create or replace function public.month_spend_by_purpose(p_from timestamptz)
returns table (purpose text, cost numeric, calls bigint)
language sql
security invoker
stable
as $$
  select l.purpose, coalesce(sum(l.cost_usd), 0)::numeric, count(*)::bigint
    from public.usage_ledger l
   where l.user_id = auth.uid()
     and l.created_at >= p_from
   group by l.purpose
   order by 2 desc;
$$;

-- ─────────────────────────────────────────────
-- Realtime
-- ─────────────────────────────────────────────
-- 자아 스냅샷이 새로 찍히면 화면이 바로 받도록.
-- 이미 추가된 경우 에러가 나므로 조건을 걸어 둔다.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'identity_snapshots'
  ) then
    alter publication supabase_realtime add table public.identity_snapshots;
  end if;
end $$;
