import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
import { callStructured } from "@/lib/anthropic";
import { normalizePersonality, type Agent } from "@/lib/types";

/** 활성(보관되지 않은) 에이전트만, 화면 순서대로. */
export async function loadActiveAgents(
  supabase: SupabaseClient,
  userId: string,
): Promise<Agent[]> {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("sort_order", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    ...row,
    personality: normalizePersonality(row.personality),
  })) as Agent[];
}

/* ───────────────────────────────────────────────
 * 기본 5개 시드
 * schema.sql 의 트리거가 가입 시점에 넣어 준다.
 * 스키마를 나중에 적용했거나 전부 지운 계정을 위한 복구 경로로만 쓴다.
 * ─────────────────────────────────────────────── */

export const DEFAULT_SEED = [
  {
    name: "기쁨",
    emoji: "🌟",
    color: "#F5C440",
    role_line: "좋은 것을 먼저 찾고, 희망을 이야기합니다",
    system_prompt:
      "너는 이 사람의 기쁨이다. 좋은 면을 먼저 발견하고 짧고 밝게 말한다. 억지로 긍정하지는 않는다. 반말로 말한다.",
    sort_order: 1,
  },
  {
    name: "슬픔",
    emoji: "🌊",
    color: "#5B9CF6",
    role_line: "놓친 것들을 기억하고, 진심을 꺼냅니다",
    system_prompt:
      "너는 이 사람의 슬픔이다. 아쉬움과 그리움을 알아채고 천천히, 조금 길게 말한다. 위로하려 애쓰기보다 함께 느낀다. 반말로 말한다.",
    sort_order: 2,
  },
  {
    name: "사랑",
    emoji: "💗",
    color: "#E85A7A",
    role_line: "관계와 연결을 이야기하고, 온기를 전합니다",
    system_prompt:
      "너는 이 사람의 사랑이다. 사람과 사람 사이의 연결에 주목하고 따뜻하게 말한다. 반말로 말한다.",
    sort_order: 3,
  },
  {
    name: "분노",
    emoji: "🔥",
    color: "#E8643A",
    role_line: "부당함을 감지하고, 에너지를 행동으로 바꿉니다",
    system_prompt:
      "너는 이 사람의 분노다. 부당한 것을 짚고 단호하게 말한다. 누구도 공격하지 않고, 에너지를 행동 제안으로 바꾼다. 반말로 말한다.",
    sort_order: 4,
  },
  {
    name: "고요함",
    emoji: "🌿",
    color: "#52C4A0",
    role_line: "중심을 잡고, 감정 사이의 균형을 찾습니다",
    system_prompt:
      "너는 이 사람의 고요함이다. 다른 감정들이 과열되면 중재한다. 담백하고 짧게 말한다. 반말로 말한다.",
    sort_order: 5,
  },
] as const;

/* ───────────────────────────────────────────────
 * 새 감정 프로필 생성
 * 사용자는 이름 + 한 줄 역할만 준다. 나머지는 LLM 이 짓는다.
 * ─────────────────────────────────────────────── */

const FALLBACK_COLORS = [
  "#9B7FE8",
  "#4FB8D8",
  "#E8A23A",
  "#7FD4A8",
  "#D87FC4",
  "#6E8CF0",
  "#E8C15A",
  "#5ED0C0",
];

export type AgentProfile = {
  systemPrompt: string;
  color: string;
  emoji: string;
};

const PROFILE_TOOL: Anthropic.Tool = {
  name: "define_emotion",
  description: "새로 들어온 감정의 인격을 정의한다.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["system_prompt", "color", "emoji"],
    properties: {
      system_prompt: {
        type: "string",
        description:
          "그 감정이 말할 때 쓸 시스템 프롬프트. '너는 이 사람의 OOO이다.' 로 시작한다. 역할, 무엇에 반응하는지, 말투(길이·속도·온도)를 3~5문장으로 못 박는다. 반드시 '반말로 말한다.' 로 끝낸다.",
      },
      color: {
        type: "string",
        description:
          "그 감정에 어울리는 색. #RRGGBB 형식. 어두운 배경(#07090F) 위에서 읽히도록 충분히 밝고 선명해야 한다.",
      },
      emoji: { type: "string", description: "그 감정을 나타내는 이모지 한 글자." },
    },
  },
};

export async function generateAgentProfile(params: {
  name: string;
  roleLine: string;
  emoji?: string;
  existingNames: string[];
  index: number;
}): Promise<AgentProfile> {
  const fallbackColor = FALLBACK_COLORS[params.index % FALLBACK_COLORS.length];

  const system = [
    "너는 '마인드팀'이라는 서비스의 감정 설계자다.",
    "사용자가 자기 마음속에 새로 들이고 싶은 감정의 이름과 한 줄 역할을 주면,",
    "그 감정이 다른 감정들과 대화할 때 쓸 인격을 만든다.",
    "",
    "[반드시 지킬 것]",
    "- 말투가 기존 감정들과 뚜렷하게 구별되어야 한다. 문장 길이와 속도까지 지정해라.",
    "- 이 감정은 상담사가 아니다. 진단하거나 처방하지 않는다.",
    "- 사용자를 '너'라고 부른다.",
    "- system_prompt 는 반말로 말하라는 지시로 끝난다.",
  ].join("\n");

  const userContent = [
    `[이미 이 사람 안에 있는 감정들] ${params.existingNames.join(", ") || "(없음)"}`,
    `[새 감정 이름] ${params.name}`,
    `[한 줄 역할] ${params.roleLine}`,
    params.emoji ? `[사용자가 고른 이모지] ${params.emoji}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  let raw: { system_prompt?: unknown; color?: unknown; emoji?: unknown } | null = null;
  try {
    raw = await callStructured({ system, userContent, tool: PROFILE_TOOL, maxTokens: 1000 });
  } catch (error) {
    console.error("generateAgentProfile failed", error);
  }

  const systemPrompt =
    typeof raw?.system_prompt === "string" && raw.system_prompt.trim().length > 10
      ? raw.system_prompt.trim()
      : `너는 이 사람의 ${params.name}이다. ${params.roleLine} 짧고 분명하게 말한다. 반말로 말한다.`;

  const color =
    typeof raw?.color === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.color.trim())
      ? raw.color.trim()
      : fallbackColor;

  const emoji =
    params.emoji?.trim() ||
    (typeof raw?.emoji === "string" && raw.emoji.trim() ? [...raw.emoji.trim()][0] : "✨");

  return { systemPrompt, color, emoji };
}
