import "server-only";

import Anthropic from "@anthropic-ai/sdk";

/**
 * Anthropic 호출은 전부 이 모듈을 통해서만 나간다.
 * `server-only` import 때문에 클라이언트 컴포넌트가 이 파일을 건드리면 빌드가 깨진다.
 * → API 키가 브라우저 번들에 섞여 들어갈 경로 자체가 없다. (CLAUDE.md 규칙 1)
 */

let cached: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AnthropicNotConfiguredError();
  }
  if (!cached) cached = new Anthropic({ apiKey });
  return cached;
}

export class AnthropicNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY 가 설정되지 않았습니다. web/.env.local 을 확인해 주세요.");
    this.name = "AnthropicNotConfiguredError";
  }
}

/** CLAUDE.md 지정 모델. .env.local 에서 바꿀 수 있다. */
export const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

/** 응답에서 text 블록만 이어붙인다. */
export function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

/**
 * 도구 호출을 강제해서 구조화된 JSON 을 받아온다.
 * 스키마에 맞지 않는 값이 와도 호출부에서 전부 clamp 하므로 여기서는 파싱만 책임진다.
 */
export async function callStructured<T>(params: {
  system: string;
  userContent: string;
  tool: Anthropic.Tool;
  maxTokens?: number;
}): Promise<T | null> {
  const client = getAnthropic();

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: params.maxTokens ?? 2000,
    system: params.system,
    tools: [params.tool],
    tool_choice: { type: "tool", name: params.tool.name },
    messages: [{ role: "user", content: params.userContent }],
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) return null;

  // tool_use.input 은 이미 파싱된 객체다. 문자열 매칭은 하지 않는다.
  return toolUse.input as T;
}

/** 자유 텍스트 한 덩어리를 받아온다. */
export async function callText(params: {
  system: string;
  userContent: string;
  maxTokens?: number;
}): Promise<string> {
  const client = getAnthropic();

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: params.maxTokens ?? 1000,
    system: params.system,
    messages: [{ role: "user", content: params.userContent }],
  });

  return textOf(message);
}
