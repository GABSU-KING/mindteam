import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { callStructured } from "@/lib/anthropic";
import {
  cleanUtterance,
  describePersonality,
  MAX_STEPS,
  normalizeSteps,
  renderContext,
  type ContextLine,
} from "@/lib/dialogue-core";
import type { LlmPurpose } from "@/lib/models";
import { careGuidanceFor } from "@/lib/safety";
import type { Agent, RiskLevel, ThinkingStep } from "@/lib/types";
import { EMPTY_USAGE, type TokenUsage } from "@/lib/usage";

/** 순수 로직은 dialogue-core 에 있다. 라우트가 한 곳에서 가져다 쓰도록 여기서 다시 내보낸다. */
export {
  applyPersonalityNudge,
  buildContextLines,
  describePersonality,
  nextWeight,
  pickSpeakers,
  type ContextLine,
} from "@/lib/dialogue-core";

export type UtteranceRequest = {
  speaker: Agent;
  /** 같은 사람 안에 함께 있는 다른 활성 감정들 */
  roommates: Agent[];
  context: ContextLine[];
  /** 사용자가 방금 끼어든 말. 없으면 감정들끼리 떠드는 중. */
  userLine?: string;
  risk: RiskLevel;
};

export type Utterance = {
  content: string;
  /** 그 말에 도달하기까지 밟은 단계. 화면에 펼쳐 보여 준다. */
  steps: ThinkingStep[];
  usage: TokenUsage;
  model: string;
};

const SPEAK_TOOL: Anthropic.Tool = {
  name: "speak",
  description: "생각의 단계를 밟은 뒤 한 마디 한다.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["steps", "say"],
    properties: {
      steps: {
        type: "array",
        minItems: 2,
        maxItems: MAX_STEPS,
        description:
          "말하기 전에 실제로 거친 생각. 2~4단계. 단계 제목은 정해진 틀이 아니라 네 성격대로 지어라.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label", "detail"],
          properties: {
            label: {
              type: "string",
              description: "이 단계에서 뭘 하고 있는지 아주 짧게. 열 자 이내.",
            },
            detail: {
              type: "string",
              description: "그 단계에서 실제로 떠올린 것. 한 문장. 반말.",
            },
          },
        },
      },
      say: {
        type: "string",
        description: "실제로 입 밖에 내는 말. 1~3문장. 반말. 이름표나 따옴표를 붙이지 않는다.",
      },
    },
  },
};

export async function generateUtterance(req: UtteranceRequest): Promise<Utterance> {
  const { speaker, roommates, context, userLine, risk } = req;
  // 사용자가 끼어들었을 때만 좋은 모델을 쓴다. 평소 대화는 저렴한 쪽으로 오래 돌린다.
  const purpose: LlmPurpose = userLine ? "response" : "ambient";

  const others = roommates
    .filter((a) => a.id !== speaker.id)
    .map((a) => `${a.name}(${a.role_line ?? "역할 설명 없음"})`)
    .join(", ");

  const system = [
    speaker.system_prompt,
    "",
    "[지금 너의 상태]",
    describePersonality(speaker.personality),
    "",
    "[같이 있는 감정들]",
    others || "지금은 너 혼자다.",
    "",
    "[생각하고 말하는 방식]",
    "- 바로 답하지 마라. 먼저 생각의 단계를 밟고, 그 끝에서 한 마디 한다.",
    "- 단계는 2~4개. 짧게. 남에게 보여 주는 설명이 아니라 네 머릿속이다.",
    "- 단계 제목을 '상황 파악' 같은 교과서 말투로 짓지 마라. 너답게 지어라.",
    "- 단계는 실제로 결론에 영향을 줘야 한다. 결론을 정해 놓고 꾸며 붙이지 마라.",
    "",
    "[말할 때]",
    "- 너는 한 사람의 마음속 감정이다. 그 사람을 '너'라고 부른다.",
    "- 반말로 말한다. 존댓말을 섞지 않는다.",
    "- 1~3문장. 길어야 세 문장이다.",
    "- 이름표, 따옴표, 이모지, 괄호 안 지문을 붙이지 않는다.",
    "- 다른 감정이 방금 한 말에 실제로 반응해라. 혼잣말을 나열하지 마라.",
    "- 상담사처럼 굴지 마라. 진단하거나 처방하지 않는다.",
    careGuidanceFor(risk) ?? "",
  ]
    .filter(Boolean)
    .join("\n");

  const userContent = [
    "[최근 대화]",
    renderContext(context),
    "",
    userLine
      ? `[방금 그 사람이 끼어들어 한 말]\n${userLine}\n\n이 말을 듣고 ${speaker.name}으로서 생각한 뒤 한 마디 해라.`
      : `${speaker.name}으로서 이 흐름을 보고 생각한 뒤 한 마디 해라.`,
  ].join("\n");

  const result = await callStructured<{ steps?: unknown; say?: unknown }>({
    purpose,
    system,
    userContent,
    tool: SPEAK_TOOL,
    maxTokens: 900,
  });

  const say = typeof result.value?.say === "string" ? result.value.say : "";

  return {
    content: cleanUtterance(say, speaker.name),
    steps: normalizeSteps(result.value?.steps),
    usage: result.usage,
    model: result.model,
  };
}

export const EMPTY_UTTERANCE_USAGE = EMPTY_USAGE;
