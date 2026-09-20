import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { callStructured } from "@/lib/anthropic";
import { stripNumbers } from "@/lib/scales";
import {
  IDENTITY_AXES,
  IDENTITY_AXIS_HINT,
  IDENTITY_AXIS_LABEL,
  NEUTRAL_IDENTITY,
  normalizeIdentityAxes,
  type IdentityAxes,
} from "@/lib/types";
import { EMPTY_USAGE, type TokenUsage } from "@/lib/usage";

/**
 * 자아 레이어.
 *
 * 두 개의 자아를 같은 축으로 재서 나란히 놓는다.
 * - 기준 자아: 사용자가 직접 쓴 자기 소개글에서 뽑아낸 축
 * - 자라난 자아: 감정들의 대화와 사용자의 개입이 쌓여 만들어진 축
 *
 * 축 값은 내부 저장만 하고 화면에는 문장으로 번역해서 보여준다 (CLAUDE.md 규칙 5의 정신).
 */

/** 이만큼 새 발화가 쌓이면 자아 스냅샷을 한 장 찍는다. */
export const SNAPSHOT_EVERY = 24;

const AXIS_GUIDE = IDENTITY_AXES.map(
  (axis) => `- ${axis} (${IDENTITY_AXIS_LABEL[axis]}): ${IDENTITY_AXIS_HINT[axis]}`,
).join("\n");

const AXES_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  required: [...IDENTITY_AXES],
  properties: Object.fromEntries(
    IDENTITY_AXES.map((axis) => [
      axis,
      { type: "number", minimum: 0, maximum: 1, description: IDENTITY_AXIS_HINT[axis] },
    ]),
  ),
};

/* ───────────────────────────────────────────────
 * 기준 자아 — 사용자가 쓴 글을 축으로 환산
 * ─────────────────────────────────────────────── */

const PORTRAIT_TOOL: Anthropic.Tool = {
  name: "read_portrait",
  description: "사람이 쓴 자기 소개글을 자아 축으로 환산한다.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["axes"],
    properties: { axes: AXES_SCHEMA },
  },
};

export type PortraitReading = {
  axes: IdentityAxes;
  usage: TokenUsage;
  model: string;
};

export async function readSelfPortrait(content: string): Promise<PortraitReading> {
  const system = [
    "너는 사람이 자기 자신을 설명한 글을 읽고, 정해진 축으로 환산한다.",
    "",
    "[축]",
    AXIS_GUIDE,
    "",
    "[규칙]",
    "- 0에 가까우면 그 감각이 옅고, 1에 가까우면 짙다.",
    "- 글에 근거가 없는 축은 0.5 로 둔다. 추측으로 극단값을 주지 마라.",
    "- 이 사람을 평가하거나 진단하지 않는다. 그냥 글에 적힌 대로 옮긴다.",
    "- 겸손한 표현을 낮은 점수로 오해하지 마라. 무엇을 하는 사람인지를 본다.",
  ].join("\n");

  try {
    const result = await callStructured<{ axes?: unknown }>({
      purpose: "identity",
      system,
      userContent: `[그 사람이 쓴 글]\n${content}`,
      tool: PORTRAIT_TOOL,
      maxTokens: 700,
    });

    return {
      axes: normalizeIdentityAxes(result.value?.axes),
      usage: result.usage,
      model: result.model,
    };
  } catch (error) {
    // 환산이 실패해도 글 자체는 저장된다. 축은 나중에 다시 읽으면 된다.
    console.error("readSelfPortrait failed", error);
    return { axes: NEUTRAL_IDENTITY, usage: EMPTY_USAGE, model: "" };
  }
}

/* ───────────────────────────────────────────────
 * 자라난 자아 — 대화에서 합성
 * ─────────────────────────────────────────────── */

const SYNTHESIS_TOOL: Anthropic.Tool = {
  name: "record_identity",
  description: "감정들의 대화에서 자라난 자아를 기록한다.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["axes", "summary", "drift_note"],
    properties: {
      axes: AXES_SCHEMA,
      summary: {
        type: "string",
        description:
          "대화 속에서 이 사람이 어떤 사람으로 자리 잡아 가는지 3~5문장. 존댓말. 숫자·점수·축 이름을 쓰지 않는다. 진단하지 않는다.",
      },
      drift_note: {
        type: "string",
        description:
          "그 사람이 쓴 자기 소개글과 대화 속 모습이 어디서 맞고 어디서 갈라지는지 2~4문장. 존댓말. 숫자를 쓰지 않는다. 어느 쪽이 옳다고 판정하지 말고, 차이를 그대로 보여 준다. 기준 글이 없으면 아직 비교할 기준이 없다고만 쓴다.",
      },
    },
  },
};

export type IdentitySynthesis = {
  axes: IdentityAxes;
  summary: string;
  driftNote: string;
  /** 자라난 자아 - 기준 자아. 기준이 없으면 null. */
  drift: Partial<IdentityAxes> | null;
  usage: TokenUsage;
  model: string;
};

export async function synthesizeIdentity(params: {
  /** 오래된 것 → 최신 순으로 정렬된 "이름: 발화" 줄 */
  conversation: string[];
  /** 사용자가 끼어든 말들 */
  interventions: string[];
  agentNames: string[];
  /** 사용자가 쓴 기준 자아. 없으면 비교 없이 자라난 자아만 만든다. */
  portrait: { content: string; axes: IdentityAxes | null } | null;
  /** 직전 스냅샷 요약. 자아가 이어지도록 맥락으로 준다. */
  previousSummary: string | null;
}): Promise<IdentitySynthesis> {
  const { conversation, interventions, agentNames, portrait, previousSummary } = params;

  const system = [
    "너는 한 사람의 마음속 감정들이 주고받은 대화를 읽고, 그 안에서 자라난 '자아'를 정리한다.",
    "",
    "[축]",
    AXIS_GUIDE,
    "",
    "[무엇을 보는가]",
    "- 감정들이 무엇을 반복해서 말하는가. 어떤 주제로 자꾸 돌아오는가.",
    "- 그 사람이 끼어들어 한 말이 대화의 방향을 어떻게 틀었는가.",
    "- 어느 감정이 자주 주도권을 갖는가. 어느 감정이 밀려나 있는가.",
    "",
    "[규칙]",
    "- 감정들의 말은 그 사람의 내면이지 사실 기록이 아니다. 단언하지 마라.",
    "- summary 와 drift_note 는 사람에게 그대로 보인다. 숫자·점수·축 이름을 쓰지 마라.",
    "- 환자 취급하지 마라. 진단하지 마라. 평가하지 말고 관찰한 것을 돌려준다.",
    "- 기준 글과 다르다는 것이 문제라는 뜻은 아니다. 그렇게 읽히게 쓰지 마라.",
    previousSummary
      ? "- 직전에 정리한 자아가 주어진다. 이어지는 이야기로 쓰되, 달라진 부분은 달라졌다고 써라."
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const userContent = [
    `[이 사람 안에 있는 감정들]\n${agentNames.join(", ")}`,
    "",
    portrait
      ? `[그 사람이 직접 쓴 자기 소개글]\n${portrait.content}`
      : "[그 사람이 직접 쓴 자기 소개글]\n(아직 쓰지 않았습니다. 비교할 기준이 없습니다.)",
    "",
    previousSummary ? `[직전에 정리한 자아]\n${previousSummary}\n` : "",
    `[감정들의 대화]\n${conversation.join("\n") || "(아직 대화가 없습니다)"}`,
    "",
    `[그 사람이 끼어들어 한 말]\n${
      interventions.length ? interventions.map((c) => `- ${c}`).join("\n") : "(아직 없습니다)"
    }`,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await callStructured<{
    axes?: unknown;
    summary?: unknown;
    drift_note?: unknown;
  }>({
    purpose: "identity",
    system,
    userContent,
    tool: SYNTHESIS_TOOL,
    maxTokens: 1600,
  });

  const axes = normalizeIdentityAxes(result.value?.axes);
  const baseline = portrait?.axes ?? null;

  let drift: Partial<IdentityAxes> | null = null;
  if (baseline) {
    drift = {};
    for (const axis of IDENTITY_AXES) {
      drift[axis] = Number((axes[axis] - baseline[axis]).toFixed(4));
    }
  }

  return {
    axes,
    summary: stripNumbers(asText(result.value?.summary)),
    driftNote: stripNumbers(asText(result.value?.drift_note)),
    drift,
    usage: result.usage,
    model: result.model,
  };
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 차이를 문장으로 옮기는 순수 로직은 identity-core 에 있다 (검증 가능하도록 분리). */
export {
  describeAxisLevel,
  describeDrift,
  driftBand,
  type DriftBand,
} from "@/lib/identity-core";
