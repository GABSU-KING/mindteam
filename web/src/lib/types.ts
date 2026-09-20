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

/**
 * 발화에 도달하기까지 감정이 밟은 한 단계.
 * 사용자가 "AI가 생각하면서 말하는 것처럼" 보고 싶어 하는 그 과정이다.
 */
export type ThinkingStep = {
  /** 단계 제목. 예: "무슨 일이 있었나" */
  label: string;
  /** 그 단계에서 실제로 떠올린 것. 한두 문장. */
  detail: string;
};

export type AgentMessage = {
  id: string;
  user_id: string;
  agent_id: string;
  content: string;
  triggered_by_user: boolean;
  thinking_steps: ThinkingStep[] | null;
  model: string | null;
  created_at: string;
};

/**
 * 자아 축.
 *
 * 감정의 `personality`(말투 축)와는 다른 층이다 — 저건 어떻게 말하는지,
 * 이건 자기를 어떤 사람으로 여기는지다.
 * 기준 자아(사용자가 쓴 글)와 자라난 자아(대화에서 합성)를 같은 축으로 재서 대조한다.
 */
export type IdentityAxes = {
  /** 주체성 — 내 삶을 내가 고른다는 감각 */
  agency: number;
  /** 관계성 — 사람들과 이어져 있다는 감각 */
  connection: number;
  /** 안정성 — 흔들려도 돌아올 중심이 있다는 감각 */
  stability: number;
  /** 개방성 — 모르는 것과 새로운 것을 향해 열린 정도 */
  openness: number;
  /** 자기 관용 — 스스로에게 얼마나 관대한가 */
  selfKindness: number;
  /** 방향성 — 어디로 가고 싶은지 아는 정도 */
  direction: number;
};

export const IDENTITY_AXES = [
  "agency",
  "connection",
  "stability",
  "openness",
  "selfKindness",
  "direction",
] as const satisfies readonly (keyof IdentityAxes)[];

export const IDENTITY_AXIS_LABEL: Record<keyof IdentityAxes, string> = {
  agency: "주체성",
  connection: "관계성",
  stability: "안정성",
  openness: "개방성",
  selfKindness: "자기 관용",
  direction: "방향성",
};

export const IDENTITY_AXIS_HINT: Record<keyof IdentityAxes, string> = {
  agency: "내 삶을 내가 고른다는 감각",
  connection: "사람들과 이어져 있다는 감각",
  stability: "흔들려도 돌아올 중심이 있다는 감각",
  openness: "모르는 것과 새로운 것을 향해 열린 정도",
  selfKindness: "스스로에게 얼마나 관대한가",
  direction: "어디로 가고 싶은지 아는 정도",
};

export const NEUTRAL_IDENTITY: IdentityAxes = {
  agency: 0.5,
  connection: 0.5,
  stability: 0.5,
  openness: 0.5,
  selfKindness: 0.5,
  direction: 0.5,
};

export function normalizeIdentityAxes(raw: unknown): IdentityAxes {
  const source = (raw ?? {}) as Partial<Record<keyof IdentityAxes, unknown>>;
  const out = { ...NEUTRAL_IDENTITY };
  for (const axis of IDENTITY_AXES) {
    const value = source[axis];
    if (typeof value === "number") out[axis] = clamp01(value);
  }
  return out;
}

export type SelfPortrait = {
  user_id: string;
  content: string;
  axes: IdentityAxes | null;
  created_at: string;
  updated_at: string;
};

export type IdentitySnapshot = {
  id: string;
  user_id: string;
  message_count: number;
  axes: IdentityAxes;
  summary: string;
  /** 기준 자아와의 축별 차이 (자라난 자아 - 기준 자아). null 이면 기준이 아직 없다. */
  drift: Partial<IdentityAxes> | null;
  drift_note: string | null;
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
  | {
      kind: "agent";
      id: string;
      createdAt: string;
      agentId: string;
      content: string;
      steps: ThinkingStep[] | null;
    }
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
