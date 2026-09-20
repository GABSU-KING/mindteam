import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { mainModel, modelFor, type LlmPurpose } from "@/lib/models";
import { EMPTY_USAGE, type TokenUsage } from "@/lib/usage";

/**
 * Anthropic 호출은 전부 이 모듈을 통해서만 나간다.
 * `server-only` import 때문에 클라이언트 컴포넌트가 이 파일을 건드리면 빌드가 깨진다.
 * → API 키가 브라우저 번들에 섞여 들어갈 경로 자체가 없다. (CLAUDE.md 규칙 1)
 *
 * 모든 호출은 `purpose` 를 받는다. 용도가 모델을 고르고(models.ts), 원장에 기록될 항목이 되고,
 * 예산 검사의 단위가 된다. 용도 없이 부를 수 있는 경로를 두지 않는다.
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

/** 화면 표시용 기본 모델명. 비밀값이 아니다. */
export const MODEL = mainModel();

/** 응답에서 text 블록만 이어붙인다. */
export function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

/** SDK 의 usage 를 우리 타입으로 옮긴다. 캐시 필드는 모델·플랜에 따라 없을 수 있다. */
export function readUsage(message: Anthropic.Message): TokenUsage {
  return {
    inputTokens: message.usage.input_tokens ?? 0,
    outputTokens: message.usage.output_tokens ?? 0,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: message.usage.cache_creation_input_tokens ?? 0,
    calls: 1,
  };
}

export type LlmResult<T> = {
  value: T;
  usage: TokenUsage;
  model: string;
};

/**
 * 도구 호출을 강제해서 구조화된 JSON 을 받아온다.
 * 스키마에 맞지 않는 값이 와도 호출부에서 전부 clamp 하므로 여기서는 파싱만 책임진다.
 */
export async function callStructured<T>(params: {
  purpose: LlmPurpose;
  system: string;
  userContent: string;
  tool: Anthropic.Tool;
  maxTokens?: number;
}): Promise<LlmResult<T | null>> {
  const client = getAnthropic();
  const model = modelFor(params.purpose);

  const message = await client.messages.create({
    model,
    max_tokens: params.maxTokens ?? 2000,
    system: params.system,
    tools: [params.tool],
    tool_choice: { type: "tool", name: params.tool.name },
    messages: [{ role: "user", content: params.userContent }],
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );

  return {
    // tool_use.input 은 이미 파싱된 객체다. 문자열 매칭은 하지 않는다.
    value: toolUse ? (toolUse.input as T) : null,
    usage: readUsage(message),
    model: message.model || model,
  };
}

/** 자유 텍스트 한 덩어리를 받아온다. */
export async function callText(params: {
  purpose: LlmPurpose;
  system: string;
  userContent: string;
  maxTokens?: number;
}): Promise<LlmResult<string>> {
  const client = getAnthropic();
  const model = modelFor(params.purpose);

  const message = await client.messages.create({
    model,
    max_tokens: params.maxTokens ?? 1000,
    system: params.system,
    messages: [{ role: "user", content: params.userContent }],
  });

  return {
    value: textOf(message),
    usage: readUsage(message),
    model: message.model || model,
  };
}

/** LLM 호출이 실패했을 때 호출부가 쓸 빈 결과. */
export function emptyResult<T>(value: T, purpose: LlmPurpose): LlmResult<T> {
  return { value, usage: EMPTY_USAGE, model: modelFor(purpose) };
}
