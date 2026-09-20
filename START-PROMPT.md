# Claude Code 시작 가이드

## 0. 준비물

| 항목 | 받는 곳 |
|---|---|
| Anthropic API 키 | console.anthropic.com |
| Supabase 프로젝트 URL + anon key | supabase.com (무료 티어 OK) |
| Xcode + iOS 시뮬레이터 | Mac App Store |
| Apple Developer 계정 | 실기기 테스트·배포 시에만 필요 |

## 1. 폴더 준비

```bash
mkdir mindteam && cd mindteam
# CLAUDE.md 와 schema.sql 을 이 폴더에 복사
claude
```

## 2. Supabase 준비

1. Supabase에서 새 프로젝트 생성
2. SQL Editor에 `schema.sql` 전체를 붙여넣고 Run
3. Authentication > Providers에서 Apple 활성화
4. Project Settings > API에서 URL과 anon key 복사

## 3. Claude Code 1단계 프롬프트

아래를 그대로 붙여넣으세요.

---

CLAUDE.md와 schema.sql을 읽고 MindTeam 프로젝트를 시작해줘.

이번 단계에서 할 일:

1. Expo + TypeScript + Expo Router로 프로젝트 초기화
2. Supabase 클라이언트 설정 (`lib/supabase.ts`), 키는 `.env`에서 읽고 `.gitignore`에 추가
3. Apple 로그인 화면
4. 감정 에이전트 목록 화면:
   - `agents` 테이블에서 `archived_at is null`인 행만 불러와 카드 그리드로 표시
   - 카드에 이모지, 이름, 역할 한 줄, 고유 색상
   - 카드 길게 누르면 삭제 (소프트 삭제 — `archived_at` 업데이트). 활성 2명 이하면 막고 "감정은 최소 2명이 필요합니다" 토스트
   - 상단에 "감정 들이기" 버튼 → 이름 + 한 줄 역할 + 이모지 입력 시트. 활성 8명이면 버튼 비활성화
   - Supabase Realtime으로 `agents` 테이블 구독해서 목록 자동 갱신

중요: 감정 종류를 타입이나 상수로 하드코딩하지 마. 전부 DB에서 읽어온다.

이번 단계에서는 LLM 호출과 대화 화면은 만들지 마. 먼저 위까지 동작시키고 시뮬레이터에서 확인할게.

---

## 4. 이후 단계 프롬프트 (순서대로)

**2단계 — 에이전트 생성 Edge Function**
> Supabase Edge Function `create-agent`를 만들어줘. 사용자가 입력한 이름과 한 줄 역할을 받아서 Anthropic API로 그 감정의 system_prompt를 생성하고 agents 테이블에 insert해줘. 초기 weight는 해당 유저의 기존 활성 에이전트 weight 평균, personality는 전부 0.5. API 키는 Edge Function 환경변수에서만 읽어. 앱에서 이 함수를 호출하도록 "감정 들이기" 시트를 연결해줘.

**3단계 — 대화 화면**
> 대화 화면을 만들어줘. agent_messages를 시간순으로 보여주고 Realtime으로 구독해. 각 메시지는 해당 agent의 emoji/color/name을 쓰고, 에이전트별로 말풍선 정렬을 번갈아가며 배치해. 하단에 사용자 개입 입력창.

**4단계 — 오케스트레이션**
> Edge Function 두 개를 만들어줘. `analyze-intervention`은 사용자 발화에서 감정 신호를 추출해 활성 에이전트들의 weight를 갱신하고 personality를 최대 0.05만큼만 이동시킨다. `generate-dialogue`는 weight를 확률로 삼아 2~4명을 뽑고 각자의 system_prompt와 personality, 최근 대화 10개를 맥락으로 발화를 생성해 agent_messages에 insert한다. 개입 → 분석 → 대화 생성이 이어지도록 연결해줘.

**5단계 — 심리 분석**
> user_interventions에 감정 신호와 척도 매핑을 저장하고, 일자별로 mental_scores를 누적하는 로직을 만들어줘. 주간 요약은 숫자 없이 문장으로만 생성하고, 자해 관련 신호가 감지되면 전문 상담 연결을 제안하는 분기를 넣어줘.

## 5. 팁

- 한 프롬프트에 너무 많이 담지 마세요. 단계마다 시뮬레이터에서 확인하고 넘어가는 게 훨씬 빠릅니다.
- 막히면 `/clear` 후 CLAUDE.md를 다시 읽히는 게 효과적입니다.
- `.env`가 커밋되지 않았는지 첫 커밋 전에 꼭 확인하세요.
