import "server-only";

import { callText } from "@/lib/anthropic";
import {
  cleanUtterance,
  describePersonality,
  renderContext,
  type ContextLine,
} from "@/lib/dialogue-core";
import { careGuidanceFor } from "@/lib/safety";
import type { Agent, RiskLevel } from "@/lib/types";

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

export async function generateUtterance(req: UtteranceRequest): Promise<string> {
  const { speaker, roommates, context, userLine, risk } = req;

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
    "[말하는 방식]",
    "- 너는 한 사람의 마음속 감정이다. 그 사람을 '너'라고 부른다.",
    "- 반말로 말한다. 존댓말을 섞지 않는다.",
    "- 1~3문장. 길어야 세 문장이다.",
    "- 이름표, 따옴표, 이모지, 괄호 안 지문을 붙이지 않는다. 발화 내용만 쓴다.",
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
      ? `[방금 그 사람이 끼어들어 한 말]\n${userLine}\n\n이 말을 듣고 ${speaker.name}으로서 한 마디 해라.`
      : `${speaker.name}으로서 이 흐름에 이어 한 마디 해라.`,
  ].join("\n");

  const text = await callText({ system, userContent, maxTokens: 300 });
  return cleanUtterance(text, speaker.name);
}
