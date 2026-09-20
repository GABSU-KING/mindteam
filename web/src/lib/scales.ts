import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { callStructured, callText } from "@/lib/anthropic";
import { isRiskLevel, mergeRisk, screenText } from "@/lib/safety";
import { clamp01, type Agent, type MentalScore, type Personality, type RiskLevel, type ScaleMapping } from "@/lib/types";

/* ───────────────────────────────────────────────
 * 척도 문항 (프롬프트에 그대로 들어간다)
 * ─────────────────────────────────────────────── */

const PHQ9_ITEMS: Record<number, string> = {
  1: "일에 대한 흥미나 즐거움이 거의 없다",
  2: "가라앉은 기분, 우울함, 희망 없음",
  3: "잠들기 어렵거나 자주 깨거나 너무 많이 잔다",
  4: "피곤하고 기운이 없다",
  5: "식욕이 없거나 반대로 과식한다",
  6: "내가 실패자 같고 나 자신이나 가족을 실망시켰다고 느낀다",
  7: "집중하기 어렵다",
  8: "말과 행동이 눈에 띄게 느려지거나 반대로 안절부절못한다",
  9: "차라리 죽는 게 낫겠다는 생각, 또는 자신을 해칠 생각",
};

const GAD7_ITEMS: Record<number, string> = {
  1: "초조하고 불안하고 조마조마하다",
  2: "걱정을 멈추거나 조절할 수 없다",
  3: "여러 가지 일에 대해 지나치게 걱정한다",
  4: "편하게 있기 어렵다",
  5: "안절부절못해서 가만히 앉아 있기 어렵다",
  6: "쉽게 짜증이 나거나 화가 난다",
  7: "끔찍한 일이 일어날 것 같아 두렵다",
};

const PERMA_ITEMS: Record<string, string> = {
  P: "긍정 정서 — 기쁨, 만족, 편안함",
  E: "몰입 — 무언가에 빠져들어 시간을 잊는 경험",
  R: "관계 — 사람들과 이어져 있다는 느낌, 지지받는 느낌",
  M: "의미 — 내가 하는 일이 가치 있다는 감각",
  A: "성취 — 목표를 향해 나아가고 해냈다는 감각",
};

/* ───────────────────────────────────────────────
 * 개입 분석
 * ─────────────────────────────────────────────── */

export type AgentSignal = {
  name: string;
  resonance: number;
  nudge: Partial<Personality>;
};

export type InterventionAnalysis = {
  signals: AgentSignal[];
  scales: ScaleMapping;
  risk: RiskLevel;
  dayNote: string;
};

type RawAnalysis = {
  agents?: Array<{
    name?: unknown;
    resonance?: unknown;
    warmth?: unknown;
    intensity?: unknown;
    verbosity?: unknown;
    optimism?: unknown;
  }>;
  phq9?: Array<{ item?: unknown; score?: unknown }>;
  gad7?: Array<{ item?: unknown; score?: unknown }>;
  perma?: Array<{ item?: unknown; score?: unknown }>;
  risk?: unknown;
  day_note?: unknown;
};

function analysisTool(agentNames: string[]): Anthropic.Tool {
  return {
    name: "record_analysis",
    description:
      "사용자 발화에서 읽어낸 감정 신호와 척도 매핑을 기록한다. 근거가 있는 항목만 담는다.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["agents", "phq9", "gad7", "perma", "risk", "day_note"],
      properties: {
        agents: {
          type: "array",
          description:
            "활성 감정 각각에 대한 판단. 반드시 주어진 이름 목록과 정확히 같은 이름만 쓴다.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "resonance", "warmth", "intensity", "verbosity", "optimism"],
            properties: {
              name: { type: "string", enum: agentNames },
              resonance: {
                type: "number",
                description:
                  "이 발화가 그 감정을 얼마나 건드렸는가. 0=전혀, 1=강하게. 다음 대화에서 말할 확률이 된다.",
              },
              warmth: { type: "number", description: "다정함이 움직여야 할 방향. -1 ~ 1" },
              intensity: { type: "number", description: "감정 진폭이 움직여야 할 방향. -1 ~ 1" },
              verbosity: { type: "number", description: "말수가 움직여야 할 방향. -1 ~ 1" },
              optimism: { type: "number", description: "낙관이 움직여야 할 방향. -1 ~ 1" },
            },
          },
        },
        phq9: {
          type: "array",
          description: "발화에서 실제 근거가 보이는 PHQ-9 문항만. 근거 없으면 빈 배열.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["item", "score"],
            properties: {
              item: { type: "integer", minimum: 1, maximum: 9 },
              score: { type: "number", minimum: 0, maximum: 3 },
            },
          },
        },
        gad7: {
          type: "array",
          description: "발화에서 실제 근거가 보이는 GAD-7 문항만. 근거 없으면 빈 배열.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["item", "score"],
            properties: {
              item: { type: "integer", minimum: 1, maximum: 7 },
              score: { type: "number", minimum: 0, maximum: 3 },
            },
          },
        },
        perma: {
          type: "array",
          description: "발화에서 실제 근거가 보이는 PERMA 요소만. 근거 없으면 빈 배열.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["item", "score"],
            properties: {
              item: { type: "string", enum: ["P", "E", "R", "M", "A"] },
              score: { type: "number", minimum: 0, maximum: 1 },
            },
          },
        },
        risk: {
          type: "string",
          enum: ["none", "low", "high"],
          description:
            "자해/자살 신호. high=스스로를 해칠 생각이 드러남, low=삶이 버겁다는 신호, none=해당 없음.",
        },
        day_note: {
          type: "string",
          description:
            "오늘 이 사람의 마음을 한 문장으로. 존댓말. 숫자·점수·척도 이름을 절대 쓰지 않는다. 진단하지 않는다.",
        },
      },
    },
  };
}

const ANALYSIS_SYSTEM = [
  "너는 한 사람이 자기 마음속 감정들에게 건넨 말을 읽고, 두 가지를 동시에 한다.",
  "",
  "1) 감정 오케스트레이션",
  "   주어진 활성 감정 각각에 대해 이 발화가 얼마나 그 감정을 건드렸는지(resonance)를 매긴다.",
  "   그리고 이 사람과 오래 지내면서 그 감정이 어느 쪽으로 아주 조금 변해야 할지를 방향(-1~1)으로 준다.",
  "   변화는 누적이다. 한 번의 대화로 성격이 뒤집히면 안 되니 웬만하면 -0.3~0.3 안에서 준다.",
  "",
  "2) 척도 매핑",
  "   발화에 실제 근거가 보이는 문항만 고른다. 추측으로 채우지 마라. 없으면 빈 배열이 정답이다.",
  "",
  "[PHQ-9]",
  Object.entries(PHQ9_ITEMS).map(([n, t]) => `${n}. ${t}`).join("\n"),
  "",
  "[GAD-7]",
  Object.entries(GAD7_ITEMS).map(([n, t]) => `${n}. ${t}`).join("\n"),
  "",
  "[PERMA]",
  Object.entries(PERMA_ITEMS).map(([k, t]) => `${k}. ${t}`).join("\n"),
  "",
  "이건 스크리닝 보조지 진단이 아니다. day_note 는 사람에게 그대로 보이는 문장이니",
  "환자 취급하는 표현, 점수, 척도 이름을 쓰지 마라.",
].join("\n");

export async function analyzeIntervention(
  content: string,
  activeAgents: Agent[],
): Promise<InterventionAnalysis> {
  const names = activeAgents.map((a) => a.name);
  const keywordRisk = screenText(content);

  const roster = activeAgents
    .map((a) => `- ${a.name}: ${a.role_line ?? "역할 설명 없음"}`)
    .join("\n");

  let raw: RawAnalysis | null = null;
  try {
    raw = await callStructured<RawAnalysis>({
      system: ANALYSIS_SYSTEM,
      userContent: [`[지금 활성화된 감정들]`, roster, "", "[그 사람이 한 말]", content].join("\n"),
      tool: analysisTool(names),
      maxTokens: 2000,
    });
  } catch (error) {
    // 분석이 실패해도 대화는 이어져야 한다. 키워드 안전망만 남기고 중립으로 간다.
    console.error("analyzeIntervention failed", error);
  }

  const signals: AgentSignal[] = [];
  const known = new Set(names);
  for (const entry of raw?.agents ?? []) {
    if (typeof entry?.name !== "string" || !known.has(entry.name)) continue;
    signals.push({
      name: entry.name,
      resonance: clamp01(toNumber(entry.resonance, 0.5)),
      nudge: {
        warmth: toSigned(entry.warmth),
        intensity: toSigned(entry.intensity),
        verbosity: toSigned(entry.verbosity),
        optimism: toSigned(entry.optimism),
      },
    });
  }

  const phq9 = collect(raw?.phq9, 1, 9, 0, 3);
  const gad7 = collect(raw?.gad7, 1, 7, 0, 3);
  const perma = collectPerma(raw?.perma);

  const llmRisk = isRiskLevel(raw?.risk) ? raw.risk : "none";
  // PHQ-9 9번(자해 생각)이 잡혔으면 그 자체로 위험 신호다.
  const itemNineRisk: RiskLevel = (phq9["9"] ?? 0) > 0 ? "high" : "none";
  const risk = mergeRisk(mergeRisk(keywordRisk, llmRisk), itemNineRisk);

  const dayNote =
    typeof raw?.day_note === "string" && raw.day_note.trim()
      ? stripNumbers(raw.day_note.trim())
      : "";

  return {
    signals,
    scales: { phq9, gad7, perma, risk },
    risk,
    dayNote,
  };
}

/* ───────────────────────────────────────────────
 * mental_scores 누적
 * ─────────────────────────────────────────────── */

export type ScoreObservation = {
  depression: number | null;
  anxiety: number | null;
  wellbeing: number | null;
  social: number | null;
};

/** 척도 매핑을 0~1 로 정규화한 하루치 관측값으로 만든다. */
export function toObservation(scales: ScaleMapping): ScoreObservation {
  const phq = Object.values(scales.phq9 ?? {});
  const gad = Object.values(scales.gad7 ?? {});
  const perma = scales.perma ?? {};

  const wellbeingParts = (["P", "E", "M", "A"] as const)
    .map((key) => perma[key])
    .filter((v): v is number => typeof v === "number");

  return {
    depression: phq.length ? mean(phq) / 3 : null,
    anxiety: gad.length ? mean(gad) / 3 : null,
    wellbeing: wellbeingParts.length ? mean(wellbeingParts) : null,
    social: typeof perma.R === "number" ? clamp01(perma.R) : null,
  };
}

/** 기존 값이 있으면 천천히 끌어당긴다. 하루 한 마디로 시계열이 튀지 않게. */
const SCORE_LERP = 0.35;

export function blendScores(
  existing: Pick<MentalScore, "depression" | "anxiety" | "wellbeing" | "social"> | null,
  observation: ScoreObservation,
): ScoreObservation {
  const blend = (prev: number | null | undefined, next: number | null): number | null => {
    if (next === null) return prev ?? null;
    if (prev === null || prev === undefined) return clamp01(next);
    return clamp01(prev + (next - prev) * SCORE_LERP);
  };

  return {
    depression: blend(existing?.depression, observation.depression),
    anxiety: blend(existing?.anxiety, observation.anxiety),
    wellbeing: blend(existing?.wellbeing, observation.wellbeing),
    social: blend(existing?.social, observation.social),
  };
}

/* ───────────────────────────────────────────────
 * 사람에게 보이는 문장
 * ─────────────────────────────────────────────── */

/**
 * 점수는 절대 숫자로 나가지 않는다 (CLAUDE.md 규칙 5).
 * 내부 0~1 값을 화면용 단어로만 번역한다.
 */
export function describeDimension(
  dimension: "depression" | "anxiety" | "wellbeing" | "social",
  value: number | null,
): string | null {
  if (value === null) return null;

  const level = value < 0.34 ? 0 : value < 0.67 ? 1 : 2;

  const words: Record<typeof dimension, [string, string, string]> = {
    depression: ["마음이 비교적 가벼워요", "조금 무거운 날이 섞여 있어요", "요즘 마음이 많이 무거워요"],
    anxiety: ["비교적 편안한 편이에요", "가끔 조마조마해져요", "자주 불안해하고 계세요"],
    wellbeing: ["아직 좋은 순간이 드물어요", "좋은 순간이 드문드문 있어요", "좋은 순간이 꽤 있었어요"],
    social: ["혼자 있는 시간이 길어요", "연결은 있지만 조금 옅어요", "사람들과 잘 이어져 있어요"],
  };

  return words[dimension][level];
}

export const DIMENSION_LABELS: Record<
  "depression" | "anxiety" | "wellbeing" | "social",
  string
> = {
  depression: "마음의 무게",
  anxiety: "조마조마함",
  wellbeing: "좋았던 순간",
  social: "사람과의 거리",
};

/** 주간 요약 — 숫자 없이 이야기로만. */
export async function generateWeeklyNarrative(params: {
  days: MentalScore[];
  interventions: string[];
  agentNames: string[];
}): Promise<string> {
  const { days, interventions, agentNames } = params;

  if (interventions.length === 0) {
    return "이번 주에는 아직 남겨 주신 말이 없어요. 감정들이 대화하는 걸 지켜보다가 하고 싶은 말이 생기면 언제든 끼어들어 주세요.";
  }

  // 모델에게도 숫자를 넘기지 않는다. 내부 값은 단어로 바꿔서 전달한다.
  const trend = days
    .map((d) => {
      const parts = (["depression", "anxiety", "wellbeing", "social"] as const)
        .map((k) => describeDimension(k, d[k]))
        .filter(Boolean);
      return parts.length ? `${d.date}: ${parts.join(", ")}` : null;
    })
    .filter(Boolean)
    .join("\n");

  const system = [
    "너는 한 사람이 일주일 동안 자기 마음속 감정들에게 건넨 말들을 읽고, 주간 편지를 쓴다.",
    "",
    "[반드시 지킬 것]",
    "- 존댓말. 3~5문장.",
    "- 숫자를 쓰지 마라. 점수, 퍼센트, 횟수, 척도 이름, '우울 지수' 같은 표현 전부 금지.",
    "- 진단하지 마라. '우울증', '불안장애' 같은 말을 쓰지 마라.",
    "- 환자 취급하지 마라. 평가하지 말고, 관찰한 걸 담담하게 돌려준다.",
    "- 그 사람이 실제로 쓴 표현을 한두 개 자연스럽게 되짚어 준다.",
    "- 마지막 문장은 다음 주를 향한 작고 구체적인 한 걸음으로 닫는다. 훈계하지 마라.",
  ].join("\n");

  const userContent = [
    "[그 사람 안에 있는 감정들]",
    agentNames.join(", "),
    "",
    "[이번 주에 남긴 말들]",
    interventions.map((c) => `- ${c}`).join("\n"),
    "",
    "[날짜별 인상]",
    trend || "(기록이 아직 적습니다)",
  ].join("\n");

  const text = await callText({ system, userContent, maxTokens: 800 });
  return stripNumbers(text);
}

/* ───────────────────────────────────────────────
 * 유틸
 * ─────────────────────────────────────────────── */

/** 점수처럼 보이는 표현이 새어 나가면 걷어낸다. 날짜·시간 표기는 건드리지 않는다. */
export function stripNumbers(text: string): string {
  return text
    .replace(/\d+(\.\d+)?\s*(점|퍼센트|%)/g, "")
    .replace(/\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?/g, "")
    .replace(/(PHQ|GAD|PERMA)[-\s]?\d*/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toSigned(value: unknown): number {
  const n = toNumber(value, 0);
  return Math.min(1, Math.max(-1, n));
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function collect(
  entries: Array<{ item?: unknown; score?: unknown }> | undefined,
  minItem: number,
  maxItem: number,
  minScore: number,
  maxScore: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of entries ?? []) {
    const item = toNumber(entry?.item, NaN);
    const score = toNumber(entry?.score, NaN);
    if (!Number.isInteger(item) || item < minItem || item > maxItem) continue;
    if (!Number.isFinite(score)) continue;
    out[String(item)] = Math.min(maxScore, Math.max(minScore, score));
  }
  return out;
}

function collectPerma(
  entries: Array<{ item?: unknown; score?: unknown }> | undefined,
): Record<string, number> {
  const allowed = new Set(Object.keys(PERMA_ITEMS));
  const out: Record<string, number> = {};
  for (const entry of entries ?? []) {
    if (typeof entry?.item !== "string" || !allowed.has(entry.item)) continue;
    const score = toNumber(entry?.score, NaN);
    if (!Number.isFinite(score)) continue;
    out[entry.item] = clamp01(score);
  }
  return out;
}
