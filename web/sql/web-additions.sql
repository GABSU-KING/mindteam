-- MindTeam 웹 추가 SQL (선택 사항)
-- schema.sql 을 먼저 실행한 뒤에 적용합니다.

-- 사용자 개입도 Realtime 으로 밀어 준다.
-- 여러 탭/기기를 동시에 열어 두었을 때 내가 쓴 말이 다른 창에도 바로 뜨게 하려면 필요합니다.
-- 한 창에서만 쓴다면 없어도 동작합니다.
alter publication supabase_realtime add table public.user_interventions;
