/**
 * 토큰 사용량.
 *
 * 서버와 클라이언트가 같은 타입을 쓰므로 `server-only` 를 붙이지 않는다.
 * 여기에는 순수 함수만 둔다 — Anthropic SDK 를 건드리는 쪽은 `anthropic.ts` 다.
 */

export type TokenUsage = {
  /** 캐시되지 않은 입력 토큰 */
  inputTokens: number;
  outputTokens: number;
  /** 캐시에서 읽어 온 입력 토큰 (입력 토큰과 별도로 집계된다) */
  cacheReadTokens: number;
  /** 캐시에 새로 쓴 입력 토큰 */
  cacheCreationTokens: number;
  /** 합산에 들어간 LLM 호출 횟수 */
  calls: number;
};

export const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  calls: 0,
};

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    calls: a.calls + b.calls,
  };
}

/** 표시용 입력 토큰 — 캐시에서 읽은 것까지 포함한 실제 읽은 양. */
export function totalInput(usage: TokenUsage): number {
  return usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
}

export function totalTokens(usage: TokenUsage): number {
  return totalInput(usage) + usage.outputTokens;
}

/** 1234 → "1,234", 12345 → "12.3k" */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 10_000) return n.toLocaleString("ko-KR");
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/** 알 수 없는 입력을 신뢰하지 않고 TokenUsage 로 정규화한다. */
export function normalizeUsage(raw: unknown): TokenUsage {
  const source = (raw ?? {}) as Partial<Record<keyof TokenUsage, unknown>>;
  const num = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;

  return {
    inputTokens: num(source.inputTokens),
    outputTokens: num(source.outputTokens),
    cacheReadTokens: num(source.cacheReadTokens),
    cacheCreationTokens: num(source.cacheCreationTokens),
    calls: num(source.calls),
  };
}
