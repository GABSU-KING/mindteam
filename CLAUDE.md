# MindTeam

사용자의 마음속 감정들이 서로 대화하고, 사용자는 그 대화를 지켜보다 끼어드는 iOS 앱.
영화 인사이드 아웃에서 착안. 개입이 쌓일수록 각 감정 에이전트의 성격이 변한다.

## 기술 스택

- **앱**: React Native + Expo (SDK 최신) + TypeScript + Expo Router
- **백엔드**: Supabase (PostgreSQL + Auth + Realtime + Row Level Security)
- **LLM**: Anthropic API, 모델 `claude-sonnet-4-6`
- **배포**: Expo EAS Build → App Store

## 핵심 규칙 (반드시 지킬 것)

1. **Anthropic API 키를 앱 번들에 넣지 말 것.** 모든 LLM 호출은 Supabase Edge Function을 경유한다. 앱은 Edge Function만 호출한다.
2. **감정 에이전트는 고정 5개가 아니다.** 가입 시 기본 5개를 시드하지만, 사용자가 추가/삭제할 수 있다. 코드 어디에도 `'joy' | 'sadness' | ...` 같은 유니온 타입으로 감정을 하드코딩하지 말 것. 감정은 항상 DB `agents` 테이블에서 읽어온다.
3. **삭제는 소프트 삭제.** `archived_at`을 채운다. 과거 `agent_messages`의 외래키가 깨지면 안 된다.
4. **활성 에이전트 수는 2~8명.** DB 트리거와 UI 양쪽에서 강제한다.
5. **심리 점수를 사용자에게 숫자로 보여주지 말 것.** 내부 저장만 하고, 화면에는 문장으로 번역해서 보여준다.

## 데이터 모델

`schema.sql` 참조. 핵심 테이블:

- `agents` — 감정 에이전트. 사용자별로 행이 생긴다. `weight`(발화 확률), `personality`(성격 벡터 jsonb), `system_prompt`
- `agent_messages` — 에이전트들이 주고받은 대화
- `user_interventions` — 사용자가 끼어든 발화. 심리 분석의 원천 데이터
- `mental_scores` — 누적 심리 점수 시계열 (우울/불안/웰빙/사회성)

## 에이전트 오케스트레이션

대화는 라운드로빈이 아니라 **가중치 기반 발화자 선택**이다.

1. 사용자가 개입하면 Edge Function `analyze-intervention` 호출
2. LLM이 발화에서 감정 신호를 추출 → 각 활성 에이전트의 `weight`를 조정 (0.0~1.0)
3. Edge Function `generate-dialogue`가 weight를 확률로 삼아 2~4명의 발화자를 뽑는다
4. 뽑힌 에이전트는 자기 `system_prompt` + `personality` + 최근 대화 맥락으로 발화를 생성
5. `agent_messages`에 insert → Supabase Realtime이 앱으로 push

`personality`는 개입이 누적될 때마다 아주 조금씩만 움직인다. 한 번의 대화로 성격이 급변하면 안 된다 (변화량 상한 0.05).

## 에이전트 추가 흐름

사용자가 이름(예: "호기심")과 한 줄 역할 설명만 입력한다.
Edge Function `create-agent`가 그걸로 `system_prompt`를 LLM에게 생성시킨다.
새 에이전트의 초기 `weight`는 기존 에이전트 평균값, `personality`는 중립값으로 시작한다.

## 심리 분석 레이어

`user_interventions`의 내용에서 감정 신호를 추출해 PHQ-9 / GAD-7 / PERMA 항목에 매핑하고 `mental_scores`에 누적한다.
주간/월간 요약은 숫자가 아닌 이야기 형식으로 생성한다.

**이건 스크리닝 보조 도구다. 진단이 아니다.** 자해 관련 신호가 감지되면 대화 흐름 안에서 전문 상담 연결을 부드럽게 제안하는 경로를 반드시 넣는다.

## 톤 & 카피

- 전부 한국어. 존댓말과 반말이 섞이지 않게 한다 (에이전트는 반말, 시스템 메시지는 존댓말)
- 에이전트마다 말투가 뚜렷하게 달라야 한다. 기쁨은 짧고 밝게, 슬픔은 느리고 길게, 고요함은 담백하게
- 사용자를 환자 취급하지 않는다. "우울 점수가 높습니다" 같은 문장은 금지

## 디자인

다크 테마. 배경 `#07090F`, 표면 `#0D1018`.
에이전트마다 고유 색상을 가지며 그 색이 말풍선·아바타·글로우에 일관되게 쓰인다.
과한 애니메이션 금지. 새 발화가 도착할 때의 페이드인 정도만.

## 개발 순서

1. Expo 프로젝트 + Supabase 연결 + Apple 로그인
2. `schema.sql` 적용, RLS 정책 확인, 가입 시 기본 5개 시드
3. 에이전트 목록 화면 (추가/삭제 포함)
4. Edge Functions 3종: `create-agent`, `analyze-intervention`, `generate-dialogue`
5. 대화 화면 + Realtime 구독
6. 심리 분석 누적 + 주간 요약
