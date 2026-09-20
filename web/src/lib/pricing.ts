/**
 * 모델별 단가와 비용 계산.
 *
 * 월 예산 상한을 서버에서 강제하는 근거이므로, 토큰이 아니라 달러로 계산한다.
 * 서버와 클라이언트가 같은 단가를 보도록 `server-only` 를 붙이지 않는다.
 *
 * 단가는 Anthropic 공개 요금(100만 토큰당 USD) 기준이며 바뀔 수 있다.
 * 요금이 달라지면 이 표만 고치면 된다.
 */

import type { TokenUsage } from "@/lib/usage";

export type ModelPrice = {
  /** 캐시되지 않은 입력, 100만 토큰당 USD */
  input: number;
  output: number;
  /** 캐시에서 읽을 때. 통상 입력가의 0.1배 */
  cacheRead: number;
  /** 캐시에 쓸 때. 통상 입력가의 1.25배 */
  cacheWrite: number;
};

const PRICES: Record<string, ModelPrice> = {
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
};

/**
 * 모르는 모델은 표에서 가장 비싼 값으로 계산한다.
 * 예산 상한이 목적이니, 모를 때는 비싸게 쳐서 넘기지 않는 쪽이 안전하다.
 */
const FALLBACK_PRICE: ModelPrice = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };

export function priceOf(model: string): ModelPrice {
  // "claude-sonnet-4-6-20260101" 처럼 접미사가 붙어 와도 찾아낸다.
  const exact = PRICES[model];
  if (exact) return exact;

  for (const [id, price] of Object.entries(PRICES)) {
    if (model.startsWith(id)) return price;
  }
  return FALLBACK_PRICE;
}

export function isKnownModel(model: string): boolean {
  return Object.keys(PRICES).some((id) => model === id || model.startsWith(id));
}

/** 사용량 한 건의 비용(USD). */
export function costOf(model: string, usage: TokenUsage): number {
  const price = priceOf(model);
  return (
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.cacheRead +
      usage.cacheCreationTokens * price.cacheWrite) /
    1_000_000
  );
}

/** $0.0042 처럼 아주 작은 금액도 읽히게 쓴다. */
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "$0.00";
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  if (amount < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}
