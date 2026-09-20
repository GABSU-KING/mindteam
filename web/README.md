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
3. 이어서 `web/sql/02-identity-and-budget.sql` 을 Run. **필수입니다** —
   자아 추적과 예산 원장이 여기 있고, 예산 원장이 없으면 대화가 시작되지 않습니다.
4. (선택) `web/sql/web-additions.sql` 도 실행합니다.
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
| `/room` | 감정들의 대화. 끊임없이 지켜보기, 끼어들기, 감정별 상태·모델·토큰·예산 |
| `/self` | 기준 자아(직접 쓴 글)와 대화에서 자라난 자아의 대조 |
| `/insights` | 문장으로 된 돌아보기와 주간 편지 |

## 서버 라우트 (Edge Function 대응)

| 경로 | 원래 Edge Function | 하는 일 |
|---|---|---|
| `POST /api/agents` | `create-agent` | 이름+한 줄 역할 → LLM 이 `system_prompt`·색·이모지 생성 후 insert |
| `POST /api/intervene` | `analyze-intervention` | 발화에서 감정 신호 추출 → `weight` 갱신, `personality` 최대 0.05 이동, 척도 누적 |
| `POST /api/dialogue` | `generate-dialogue` | `weight` 를 확률로 2~4명 추첨 → 순차 발화 생성 → `agent_messages` insert. **NDJSON 스트림**으로 진행 상황을 흘려보낸다 |
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

## 상태 · 모델 · 토큰 표시

대화 화면 상단의 상태 표시줄이 세 가지를 보여 줍니다.

**감정별 상태.** 한 라운드 동안 각 감정은 네 상태를 지납니다 — `쉬는 중`(이번에 안 뽑힘),
`차례 기다림`(뽑혔지만 아직), `생각 중`(지금 생성 중, 자기 색으로 빛남), `말했어요`(끝냄).
라운드가 끝나도 마지막 상태가 남아 있어 누가 말하고 누가 쉬었는지 보입니다.

**모델.** `ANTHROPIC_MODEL` 값이 아니라 API 응답에 실려 온 실제 모델명을 표시합니다.

**토큰.** `이번`은 이 라운드 누적(개입 분석 1회 + 발화 생성 2~4회), `누적`은 이 브라우저
세션 전체입니다. 발화가 하나씩 완성될 때마다 올라갑니다. 칩에 마우스를 올리면 입력·캐시
읽기·출력이 나뉘어 보입니다.

이게 가능한 이유는 `/api/dialogue` 가 JSON 한 덩어리가 아니라 NDJSON 스트림이기 때문입니다.
한 라운드는 LLM 을 2~4번 순차로 부르므로 수 초가 걸리는데, 그동안 진행 상황이 실시간으로
넘어옵니다. 이벤트 정의와 파서는 [`src/lib/stream.ts`](src/lib/stream.ts) 에 있습니다.

토큰 사용량은 DB 에 저장하지 않습니다 — 스키마를 건드리지 않으려고 세션 메모리에만 둡니다.
새로고침하면 `누적`이 0으로 돌아갑니다.

## 예산 — 월 $20 상한

`MONTHLY_BUDGET_USD` (기본 20)는 **표시용이 아니라 실제 차단선**입니다.

모든 LLM 호출 앞에 게이트가 있습니다. `usage_ledger` 를 DB 함수로 합산해 이번 달 지출을
구하고, 이번 호출의 추정 비용이 남은 예산을 넘으면 **호출하지 않습니다**. 클라이언트가 얼마나
자주 요청하든 이 지점을 통과하지 못하면 토큰은 한 개도 쓰이지 않습니다.
원장 테이블에는 update/delete RLS 정책을 일부러 만들지 않았습니다 — 기록을 지워 상한을
빠져나가는 길을 막습니다.

실제 비용은 추정보다 클 수 있어서, 추정치의 3배(`OVERSHOOT_GUARD`)가 남아 있을 때만
통과시킵니다. 한도 근처에서 몇 센트를 남기는 대신 상한이 진짜 상한이 됩니다.

**모델 배분.** 끊임없이 돌아가는 평소 대화는 `claude-haiku-4-5`, 개입 응답·분석·자아 합성은
`claude-sonnet-4-6` 입니다. 평소 대화를 sonnet 으로 올리면 같은 예산으로 볼 수 있는 시간이
3분의 1 정도로 줄어듭니다.

**대화 간격.** "남은 예산 ÷ 남은 시간" 으로 정하지 않습니다 — 그러면 30일 내내 지켜본다고
가정하게 되어, 예산이 꽉 차 있을 때도 10분에 한 번씩만 말합니다. 대신 *남은 예산 비율* 과
*남은 시간 비율* 을 견줍니다. 예산이 시간보다 여유로우면 최소 간격(12초)으로 촘촘하게,
예산이 더 빨리 줄고 있으면 그 비율만큼 벌립니다. 월초에 몰아 쓰는 것도, 예산이 남았는데
뜸해지는 것도 막습니다. 탭이 가려져 있으면 아예 돌지 않습니다.

한 달 시뮬레이션 결과(발화자 3명, 20초 간격 환산): 약 1,850라운드 / **10시간 정도** 관람.
발화자가 4명이고 개입이 섞이면 5~6시간입니다.

## 자아

두 개의 자아를 같은 여섯 축(주체성·관계성·안정성·개방성·자기 관용·방향성)으로 재서 대조합니다.

- **기준 자아** — 사용자가 직접 쓴 자기 소개글. `self_portraits` 에 저장되고 축으로 환산됩니다.
- **자라난 자아** — 감정들의 대화와 개입에서 합성. 발화 24개마다 `identity_snapshots` 에 한 장씩.

축 값은 내부 저장만 합니다. 화면에는 서버에서 `describeDrift()` 로 문장으로 바꾼 뒤에만
내려갑니다 — 원본 숫자는 브라우저에 도달하지 않습니다. 크게 갈라진 축만 시각적으로 도드라지게
표시해서, 어디를 봐야 할지 바로 보이도록 했습니다.

## 생각의 단계

각 감정은 발화 전에 2~4단계를 밟고, 그 단계가 화면에 펼쳐집니다. 발화와 함께 도구 호출로
한 번에 받아오고(`agent_messages.thinking_steps` 에 저장), 한 단계씩 나타나 보이는 것은
클라이언트의 표시 속도일 뿐입니다 — 없는 과정을 꾸며 내지 않습니다. 지나간 발화의 단계는
접힌 채로 남아 언제든 펼쳐 볼 수 있습니다.

단계를 늘리면 출력 토큰이 늘어 예산이 그만큼 빨리 줍니다 (`MAX_STEPS`).

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
