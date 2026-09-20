# 마인드팀 — 웹

마음속 감정들이 서로 대화하고, 사용자가 그 대화에 끼어드는 웹 서비스.
`../CLAUDE.md` 의 규칙과 `../schema.sql` 을 그대로 따릅니다.

## 준비물

| 항목 | 받는 곳 |
|---|---|
| Supabase 프로젝트 URL + anon key | supabase.com (무료 티어 OK) |
| Anthropic API 키 | console.anthropic.com |
| Node.js 20 이상 | nodejs.org |

## 설치

### 1. Supabase 준비

1. Supabase에서 새 프로젝트를 만듭니다.
2. SQL Editor에 저장소 루트의 `schema.sql` **전체**를 붙여넣고 Run.
3. (선택) `web/sql/web-additions.sql` 도 실행합니다.
4. Authentication → Providers 에서 **Email** 이 켜져 있는지 확인합니다.
   - 메일 확인 절차 없이 바로 써 보려면 Authentication → Sign In / Providers →
     Email 에서 *Confirm email* 을 잠시 꺼 두면 편합니다.
   - Apple 로그인을 쓰려면 Apple provider 를 켜고 `.env.local` 에
     `NEXT_PUBLIC_ENABLE_APPLE_LOGIN=true` 를 추가하세요.
5. Project Settings → API 에서 **Project URL** 과 **anon public** 키를 복사합니다.

### 2. 환경변수

```bash
cp .env.local.example .env.local
```

`.env.local` 을 열어 값을 채웁니다.

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
ANTHROPIC_API_KEY=...
```

`ANTHROPIC_API_KEY` 에는 **절대 `NEXT_PUBLIC_` 접두사를 붙이지 마세요.**
이 키는 서버 라우트에서만 읽히고 브라우저로 내려가지 않습니다.

### 3. 실행

```bash
npm install
npm run dev
```

http://localhost:3000 을 엽니다.

## 화면

| 경로 | 하는 일 |
|---|---|
| `/login` | 이메일+비밀번호 · 메일 링크 (Apple 은 선택) |
| `/agents` | 감정 목록. 들이기 / 보내기(소프트 삭제). Realtime 자동 갱신 |
| `/room` | 감정들의 대화. 하단에서 끼어들기 |
| `/insights` | 문장으로 된 돌아보기와 주간 편지 |

## 서버 라우트 (Edge Function 대응)

| 경로 | 원래 Edge Function | 하는 일 |
|---|---|---|
| `POST /api/agents` | `create-agent` | 이름+한 줄 역할 → LLM 이 `system_prompt`·색·이모지 생성 후 insert |
| `POST /api/intervene` | `analyze-intervention` | 발화에서 감정 신호 추출 → `weight` 갱신, `personality` 최대 0.05 이동, 척도 누적 |
| `POST /api/dialogue` | `generate-dialogue` | `weight` 를 확률로 2~4명 추첨 → 순차 발화 생성 → `agent_messages` insert |
| `POST /api/summary` | — | 주간 요약을 숫자 없이 이야기로 생성 |
| `POST /api/agents/seed` | — | 기본 5개 복구 (가입 트리거가 안 돈 계정용) |

## CLAUDE.md 규칙이 코드 어디에서 지켜지는가

1. **API 키가 앱 번들에 없다** — `src/lib/anthropic.ts` 가 `import "server-only"` 로 시작합니다.
   클라이언트 컴포넌트가 이 모듈을 건드리면 빌드가 깨지므로 키가 새어 나갈 경로 자체가 없습니다.
2. **감정 하드코딩 없음** — `src/lib/types.ts` 어디에도 감정 이름 유니온이 없습니다.
   감정은 항상 `agents` 테이블에서 읽습니다. 프롬프트의 감정 목록도 DB 에서 만듭니다.
3. **소프트 삭제** — `AgentsView` 는 `archived_at` 만 채웁니다. 과거 발화의 외래키가 살아 있고,
   대화 화면은 떠난 감정의 말도 이름·색과 함께 보여 줍니다.
4. **2~8명** — UI(`MIN_ACTIVE_AGENTS`/`MAX_ACTIVE_AGENTS`) 와 서버 라우트에서 막고,
   `schema.sql` 의 `agents_count_guard` 트리거가 마지막으로 한 번 더 막습니다.
5. **숫자 노출 금지** — `mental_scores` 의 값은 서버에서 `describeDimension()` 으로
   문장으로 바꾼 뒤에야 브라우저로 내려갑니다. 원본 숫자는 클라이언트에 도달하지 않습니다.
   `stripNumbers()` 가 LLM 이 흘린 점수 표현도 한 번 더 걷어냅니다.

## 알아 둘 것

- 이 서비스는 **스크리닝 보조 도구이며 진단이 아닙니다.** 자해 관련 신호가 잡히면
  대화 흐름 안에 상담 연결 카드가 나타납니다 (`src/components/CareCard.tsx`).
  감지는 LLM 판단과 키워드 사전 필터를 OR 로 합칩니다 — LLM 호출이 실패해도 안전망이 남습니다.
- 한 번의 개입으로 `personality` 가 0.05 보다 많이 움직일 수 있는 경로는 없습니다.
  LLM 은 방향(-1~1)만 주고, 상한은 `applyPersonalityNudge()` 가 곱셈으로 강제합니다.
- 발화 생성은 **순차**입니다. 뒤에 말하는 감정이 앞 감정의 방금 그 말을 듣고 반응해야 하니까요.
  그래서 말풍선이 한 번에 뜨지 않고 한 줄씩 도착합니다.

## 배포

Vercel 에 그대로 올라갑니다. 환경변수 3개를 Project Settings → Environment Variables 에
넣으세요. `/api/dialogue` 는 LLM 을 여러 번 부르므로 실행 시간이 깁니다 —
Hobby 플랜의 10초 제한에 걸리면 Pro 로 올리거나 `speakerCount` 를 2로 고정하세요.
