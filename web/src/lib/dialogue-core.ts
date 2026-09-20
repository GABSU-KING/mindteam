/**
 * 오케스트레이션의 순수 로직.
 *
 * LLM 도 Supabase 도 건드리지 않는다 — 전부 결정적이거나 난수만 쓰는 함수다.
 * 이 파일이 따로 있는 이유: CLAUDE.md 에서 가장 조용히 틀리기 쉬운 두 규칙
 * (성격 변화량 상한 0.05, 가중치 기반 2~4명 추첨)을 외부 의존 없이 검증할 수 있게 하려고.
 * LLM 을 부르는 쪽은 `orchestrator.ts` 다.
 */

import {
  clamp01,
  MAX_PERSONALITY_SHIFT,
  MAX_SPEAKERS,
  MIN_SPEAKERS,
  PERSONALITY_AXES,
  type Agent,
  type AgentMessage,
  type Personality,
} from "@/lib/types";

/* ───────────────────────────────────────────────
 * 가중치 기반 발화자 선택
 * 라운드로빈이 아니다. weight 를 확률로 삼아 2~4명을 비복원 추출한다.
 * ─────────────────────────────────────────────── */

/** weight 가 0 이어도 완전히 침묵하지는 않도록 바닥값을 둔다. */
export const WEIGHT_FLOOR = 0.03;

export function pickSpeakers(agents: Agent[], count?: number): Agent[] {
  if (agents.length === 0) return [];

  const desired =
    count ?? MIN_SPEAKERS + Math.floor(Math.random() * (MAX_SPEAKERS - MIN_SPEAKERS + 1));
  const k = Math.min(Math.max(desired, 1), agents.length);

  const pool = [...agents];
  const picked: Agent[] = [];

  for (let i = 0; i < k; i++) {
    const weights = pool.map((a) => Math.max(a.weight, WEIGHT_FLOOR));
    const total = weights.reduce((sum, w) => sum + w, 0);
    let threshold = Math.random() * total;

    let index = pool.length - 1;
    for (let j = 0; j < pool.length; j++) {
      threshold -= weights[j];
      if (threshold <= 0) {
        index = j;
        break;
      }
    }

    picked.push(pool[index]);
    pool.splice(index, 1);
  }

  return picked;
}

/* ───────────────────────────────────────────────
 * 성격 벡터 → 말투 지침
 * 숫자를 프롬프트에 그대로 넣지 않고 문장으로 번역한다.
 * ─────────────────────────────────────────────── */

function band(value: number): "low" | "mid" | "high" {
  if (value < 0.4) return "low";
  if (value > 0.6) return "high";
  return "mid";
}

const AXIS_PHRASES: Record<keyof Personality, Record<"low" | "high", string>> = {
  warmth: {
    low: "요즘 말이 좀 건조해졌다. 살갑게 굴지 않는다.",
    high: "요즘 부쩍 다정해졌다. 상대를 먼저 챙긴다.",
  },
  intensity: {
    low: "감정의 진폭이 줄었다. 차분하게 말한다.",
    high: "감정이 세게 올라온다. 말에 힘이 실린다.",
  },
  verbosity: {
    low: "말수가 줄었다. 한 문장으로 끊는다.",
    high: "할 말이 많아졌다. 두세 문장까지 이어 말한다.",
  },
  optimism: {
    low: "낙관이 옅어졌다. 쉽게 괜찮아질 거라고 말하지 않는다.",
    high: "가능성 쪽을 먼저 본다. 다음을 이야기한다.",
  },
};

export function describePersonality(personality: Personality): string {
  const lines: string[] = [];
  for (const axis of PERSONALITY_AXES) {
    const b = band(personality[axis]);
    if (b !== "mid") lines.push(`- ${AXIS_PHRASES[axis][b]}`);
  }
  if (lines.length === 0) return "- 아직은 평소 모습 그대로다.";
  return lines.join("\n");
}

/* ───────────────────────────────────────────────
 * 성격 이동 / 가중치 갱신
 * ─────────────────────────────────────────────── */

/**
 * nudge 는 축마다 -1 ~ 1. 여기에 상한 0.05 를 곱한다.
 * → 한 번의 개입으로 성격이 0.05 보다 많이 움직일 수 있는 경로가 구조적으로 없다.
 */
export function applyPersonalityNudge(
  current: Personality,
  nudge: Partial<Record<keyof Personality, number>> | undefined,
): Personality {
  if (!nudge) return current;
  const next = { ...current };
  for (const axis of PERSONALITY_AXES) {
    const raw = nudge[axis];
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    const bounded = Math.min(1, Math.max(-1, raw));
    next[axis] = clamp01(current[axis] + bounded * MAX_PERSONALITY_SHIFT);
  }
  return next;
}

/** 새 weight = 기존값에서 공명도 쪽으로 35% 만큼 당긴다. 급변하지 않는다. */
export const WEIGHT_LERP = 0.35;

export function nextWeight(current: number, resonance: number): number {
  if (!Number.isFinite(resonance)) return clamp01(current);
  const target = clamp01(resonance);
  return clamp01(current + (target - current) * WEIGHT_LERP);
}

/* ───────────────────────────────────────────────
 * 대화 맥락 구성
 * ─────────────────────────────────────────────── */

export type ContextLine = { speaker: string; content: string };

export function buildContextLines(
  messages: AgentMessage[],
  agentsById: Map<string, Agent>,
): ContextLine[] {
  return messages.map((m) => ({
    speaker: agentsById.get(m.agent_id)?.name ?? "알 수 없는 감정",
    content: m.content,
  }));
}

export function renderContext(lines: ContextLine[]): string {
  if (lines.length === 0) return "(아직 아무도 말하지 않았다. 네가 먼저 입을 연다.)";
  return lines.map((l) => `${l.speaker}: ${l.content}`).join("\n");
}

/* ───────────────────────────────────────────────
 * 발화 후처리
 * ─────────────────────────────────────────────── */

/** 모델이 이름표나 따옴표를 붙여 오는 경우를 정리한다. */
export function cleanUtterance(raw: string, speakerName: string): string {
  let text = raw.trim();

  const namePrefix = new RegExp(`^${escapeRegExp(speakerName)}\\s*[:：]\\s*`);
  text = text.replace(namePrefix, "");

  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("“") && text.endsWith("”")) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1);
  }

  return text.trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
