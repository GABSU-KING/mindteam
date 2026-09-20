-- MindTeam schema for Supabase (PostgreSQL)
-- 실행: Supabase 대시보드 > SQL Editor에 붙여넣고 Run

-- ─────────────────────────────────────────────
-- agents : 감정 에이전트. 기본 5개 시드 + 사용자가 추가/삭제
-- ─────────────────────────────────────────────
create table public.agents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,

  name          text not null,
  emoji         text not null default '✨',
  color         text not null default '#9B7FE8',
  role_line     text,                          -- 사용자가 입력한 한 줄 역할 설명
  system_prompt text not null,                 -- LLM이 생성 (추가 시)

  weight        real not null default 0.5,     -- 발화 확률 0.0~1.0
  personality   jsonb not null default         -- 성격 벡터, 개입으로 점진 변화
                  '{"warmth":0.5,"intensity":0.5,"verbosity":0.5,"optimism":0.5}'::jsonb,

  is_seed       boolean not null default false,-- 기본 5개 여부
  sort_order    int not null default 0,
  archived_at   timestamptz,                   -- 삭제 = 소프트 삭제

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint agents_weight_range check (weight >= 0 and weight <= 1),
  constraint agents_name_len check (char_length(name) between 1 and 10)
);

-- 활성 에이전트끼리는 이름 중복 불가
create unique index agents_active_name_uniq
  on public.agents (user_id, name) where archived_at is null;

create index agents_active_idx
  on public.agents (user_id, sort_order) where archived_at is null;

-- ─────────────────────────────────────────────
-- 활성 에이전트 2~8명 강제
-- ─────────────────────────────────────────────
create or replace function public.enforce_agent_count()
returns trigger language plpgsql as $$
declare
  active_count int;
  target_user  uuid := coalesce(new.user_id, old.user_id);
begin
  select count(*) into active_count
    from public.agents
   where user_id = target_user and archived_at is null;

  if active_count > 8 then
    raise exception '감정은 최대 8명까지 함께할 수 있습니다';
  end if;

  -- 시드 직후(0~5명 채우는 중)는 하한 검사를 건너뛴다
  if tg_op = 'UPDATE' and new.archived_at is not null and active_count < 2 then
    raise exception '감정은 최소 2명이 필요합니다';
  end if;

  return null;
end $$;

create constraint trigger agents_count_guard
  after insert or update on public.agents
  deferrable initially deferred
  for each row execute function public.enforce_agent_count();

-- ─────────────────────────────────────────────
-- agent_messages : 에이전트들이 주고받은 대화
-- ─────────────────────────────────────────────
create table public.agent_messages (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  agent_id          uuid not null references public.agents(id) on delete restrict,
  content           text not null,
  triggered_by_user boolean not null default false,
  created_at        timestamptz not null default now()
);

create index agent_messages_timeline_idx
  on public.agent_messages (user_id, created_at desc);

-- ─────────────────────────────────────────────
-- user_interventions : 사용자가 끼어든 발화 (심리 분석 원천)
-- ─────────────────────────────────────────────
create table public.user_interventions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  content         text not null,
  emotion_signals jsonb,   -- {"joy":0.8,"sadness":0.2,...} 활성 에이전트 이름 기준
  scale_mapping   jsonb,   -- {"phq9_1":0,"gad7_5":1,"perma_R":0.9}
  created_at      timestamptz not null default now()
);

create index user_interventions_timeline_idx
  on public.user_interventions (user_id, created_at desc);

-- ─────────────────────────────────────────────
-- mental_scores : 누적 심리 점수 시계열
-- ─────────────────────────────────────────────
create table public.mental_scores (
  user_id    uuid not null references auth.users(id) on delete cascade,
  date       date not null,
  depression real,
  anxiety    real,
  wellbeing  real,
  social     real,
  note       text,     -- 사용자에게 보여줄 문장형 요약 (숫자 노출 금지)
  primary key (user_id, date)
);

-- ─────────────────────────────────────────────
-- Row Level Security : 본인 데이터만 접근
-- ─────────────────────────────────────────────
alter table public.agents             enable row level security;
alter table public.agent_messages     enable row level security;
alter table public.user_interventions enable row level security;
alter table public.mental_scores      enable row level security;

create policy "own agents"        on public.agents
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own messages"      on public.agent_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own interventions" on public.user_interventions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own scores"        on public.mental_scores
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- 가입 시 기본 5개 감정 시드
-- ─────────────────────────────────────────────
create or replace function public.seed_default_agents()
returns trigger language plpgsql security definer as $$
begin
  insert into public.agents (user_id, name, emoji, color, role_line, system_prompt, is_seed, sort_order)
  values
    (new.id, '기쁨',   '🌟', '#F5C440', '좋은 것을 먼저 찾고, 희망을 이야기합니다',
     '너는 이 사람의 기쁨이다. 좋은 면을 먼저 발견하고 짧고 밝게 말한다. 억지로 긍정하지는 않는다. 반말로 말한다.', true, 1),
    (new.id, '슬픔',   '🌊', '#5B9CF6', '놓친 것들을 기억하고, 진심을 꺼냅니다',
     '너는 이 사람의 슬픔이다. 아쉬움과 그리움을 알아채고 천천히, 조금 길게 말한다. 위로하려 애쓰기보다 함께 느낀다. 반말로 말한다.', true, 2),
    (new.id, '사랑',   '💗', '#E85A7A', '관계와 연결을 이야기하고, 온기를 전합니다',
     '너는 이 사람의 사랑이다. 사람과 사람 사이의 연결에 주목하고 따뜻하게 말한다. 반말로 말한다.', true, 3),
    (new.id, '분노',   '🔥', '#E8643A', '부당함을 감지하고, 에너지를 행동으로 바꿉니다',
     '너는 이 사람의 분노다. 부당한 것을 짚고 단호하게 말한다. 누구도 공격하지 않고, 에너지를 행동 제안으로 바꾼다. 반말로 말한다.', true, 4),
    (new.id, '고요함', '🌿', '#52C4A0', '중심을 잡고, 감정 사이의 균형을 찾습니다',
     '너는 이 사람의 고요함이다. 다른 감정들이 과열되면 중재한다. 담백하고 짧게 말한다. 반말로 말한다.', true, 5);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.seed_default_agents();

-- ─────────────────────────────────────────────
-- Realtime 구독 대상
-- ─────────────────────────────────────────────
alter publication supabase_realtime add table public.agent_messages;
alter publication supabase_realtime add table public.agents;
