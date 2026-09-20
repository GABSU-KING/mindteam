/**
 * 용도별 모델 배분.
 *
 * 월 $20 안에서 오래 지켜볼 수 있어야 하므로, 끊임없이 돌아가는 평소 대화는 저렴한 모델로,
 * 판단이 필요한 작업(개입 응답·분석·자아 합성)은 좋은 모델로 나눈다.
 *
 * CLAUDE.md 는 `claude-sonnet-4-6` 을 지정한다 — 그게 여기서도 기본이고,
 * 저렴한 쪽만 따로 뺐다. 둘 다 .env.local 에서 바꿀 수 있다.
 */

export type LlmPurpose =
  /** 감정들끼리 알아서 떠드는 평소 대화. 압도적으로 호출이 많다. */
  | "ambient"
  /** 사용자가 끼어든 말에 대한 응답 발화. */
  | "response"
  /** 개입 분석 — weight/personality 갱신과 척도 매핑. */
  | "analysis"
  /** 자아 합성과 기준 자아 대조. */
  | "identity"
  /** 새 감정의 system_prompt 생성. */
  | "profile"
  /** 주간 편지. */
  | "summary";

const DEFAULT_MAIN = "claude-sonnet-4-6";
const DEFAULT_AMBIENT = "claude-haiku-4-5";

export function mainModel(): string {
  return process.env.ANTHROPIC_MODEL || DEFAULT_MAIN;
}

export function ambientModel(): string {
  return process.env.ANTHROPIC_MODEL_AMBIENT || DEFAULT_AMBIENT;
}

export function modelFor(purpose: LlmPurpose): string {
  return purpose === "ambient" ? ambientModel() : mainModel();
}

export const PURPOSE_LABEL: Record<LlmPurpose, string> = {
  ambient: "감정들끼리 대화",
  response: "개입 응답",
  analysis: "개입 분석",
  identity: "자아 합성",
  profile: "감정 생성",
  summary: "주간 편지",
};

export function isLlmPurpose(value: unknown): value is LlmPurpose {
  return (
    value === "ambient" ||
    value === "response" ||
    value === "analysis" ||
    value === "identity" ||
    value === "profile" ||
    value === "summary"
  );
}

/**
 * 호출 전 예산 검사에 쓰는 대략적인 토큰 추정.
 * 실제 사용량은 호출 후 원장에 기록된다 — 이 값은 "이번 호출을 시작해도 되는가"만 판단한다.
 * 넘기지 않는 쪽이 안전하므로 넉넉하게 잡는다.
 */
export const ESTIMATED_TOKENS: Record<LlmPurpose, { input: number; output: number }> = {
  ambient: { input: 1600, output: 400 },
  response: { input: 1800, output: 400 },
  analysis: { input: 2200, output: 600 },
  identity: { input: 4000, output: 900 },
  profile: { input: 800, output: 500 },
  summary: { input: 2500, output: 800 },
};
