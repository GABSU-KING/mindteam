/**
 * MindTeam 도메인 타입.
 *
 * ⚠️ 감정 종류는 절대 유니온 타입으로 고정하지 않는다.
 *    `'joy' | 'sadness' | ...` 같은 선언이 이 파일에 들어오는 순간 CLAUDE.md 규칙 2를 어기는 것이다.
 *    감정은 언제나 DB `agents` 테이블에서 읽어온 `name: string` 이다.
 */

/** 성격 벡터. 축은 고정, 값은 개입이 쌓이면서 아주 조금씩 움직인다. */
export type Personality = {
  warmth: number;
  intensity: number;
  verbosity: number;
  optimism: number;
};

export const PERSONALITY_AXES = [
  "warmth",
  "intensity",
  "verbosity",
  "optimism",
] as const satisfies readonly (keyof Personality)[];

export const NEUTRAL_PERSONALITY: Personality = {
  warmth: 0.5,
  intensity: 0.5,
  verbosity: 0.5,
  optimism: 0.5,
};

/** 한 번의 개입으로 성격이 움직일 수 있는 최대치 (CLAUDE.md: 0.05) */
export const MAX_PERSONALITY_SHIFT = 0.05;

/** 활성 에이전트 수 제한 (CLAUDE.md: 2~8명) */
export const MIN_ACTIVE_AGENTS = 2;
export const MAX_ACTIVE_AGENTS = 8;

/** 한 라운드에 발화하는 에이전트 수 */
export const MIN_SPEAKERS = 2;
export const MAX_SPEAKERS = 4;

export type Agent = {
  id: string;
  user_id: string;
  name: string;
  emoji: string;
  color: string;
  role_line: string | null;
  system_prompt: string;
  weight: number;
  personality: Personality;
  is_seed: boolean;
  sort_order: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AgentMessage = {
  id: string;
  user_id: string;
  agent_id: string;
  content: string;
  triggered_by_user: boolean;
  created_at: string;
};

export type RiskLevel = "none" | "low" | "high";

export type ScaleMapping = {
  /** PHQ-9 문항 번호(1~9) → 0~3 */
  phq9?: Record<string, number>;
  /** GAD-7 문항 번호(1~7) → 0~3 */
  gad7?: Record<string, number>;
  /** PERMA 요소(P/E/R/M/A) → 0~1 */
  perma?: Record<string, number>;
  risk?: RiskLevel;
};

export type UserIntervention = {
  id: string;
  user_id: string;
  content: string;
  /** 활성 에이전트 "이름" 기준 공명도. 키는 DB에서 온 이름이지 고정 상수가 아니다. */
  emotion_signals: Record<string, number> | null;
  scale_mapping: ScaleMapping | null;
  created_at: string;
};

export type MentalScore = {
  user_id: string;
  date: string;
  depression: number | null;
  anxiety: number | null;
  wellbeing: number | null;
  social: number | null;
  note: string | null;
};

/**
 * 대화 한 라운드 동안 각 감정이 어떤 상태인지.
 * - resting: 이번 라운드에 뽑히지 않았다. 쉬고 있다.
 * - queued:  뽑혔지만 아직 자기 차례가 아니다.
 * - thinking: 지금 말을 고르고 있다.
 * - spoke:   이번 라운드에 말을 끝냈다.
 */
export type AgentActivity = "resting" | "queued" | "thinking" | "spoke";

/** 대화 화면에서 에이전트 발화와 사용자 개입을 한 줄로 합친 항목 */
export type TimelineItem =
  | { kind: "agent"; id: string; createdAt: string; agentId: string; content: string }
  | { kind: "user"; id: string; createdAt: string; content: string; risk: RiskLevel };

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

/** DB의 jsonb 를 신뢰하지 않고 항상 정규화해서 쓴다. */
export function normalizePersonality(raw: unknown): Personality {
  const source = (raw ?? {}) as Partial<Record<keyof Personality, unknown>>;
  const out = { ...NEUTRAL_PERSONALITY };
  for (const axis of PERSONALITY_AXES) {
    const value = source[axis];
    if (typeof value === "number") out[axis] = clamp01(value);
  }
  return out;
}
