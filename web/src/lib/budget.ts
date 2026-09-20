/**
 * 예산 상태 — 서버와 클라이언트가 함께 쓰는 타입과 순수 함수.
 *
 * 한도(limitUsd)는 서버가 내려보낸 값만 쓴다. 클라이언트에서 환경변수를 읽지 않는다.
 * DB 를 건드리는 쪽은 `budget-server.ts` 다.
 */

import { ESTIMATED_TOKENS, type LlmPurpose } from "@/lib/models";
import { costOf } from "@/lib/pricing";

export type BudgetStatus = {
  /** 이번 달 한도 (USD) */
  limitUsd: number;
  /** 이번 달 지금까지 쓴 금액 (USD) */
  spentUsd: number;
  /** 이번 달 LLM 호출 횟수 */
  calls: number;
  /** 집계 시작 시각 (이번 달 1일 00:00 KST) */
  since: string;
  /** 용도별 지출. 화면에서 어디에 돈이 갔는지 보여 준다. */
  byPurpose: { purpose: LlmPurpose; costUsd: number; calls: number }[];
};

export function remainingUsd(budget: BudgetStatus): number {
  return Math.max(0, budget.limitUsd - budget.spentUsd);
}

/** 0~1. 화면의 게이지에 쓴다. */
export function usedRatio(budget: BudgetStatus): number {
  if (budget.limitUsd <= 0) return 1;
  return Math.min(1, Math.max(0, budget.spentUsd / budget.limitUsd));
}

/**
 * 이 용도의 호출 한 건을 시작해도 되는가.
 * 실제 사용량은 호출 뒤에야 알 수 있으니, 넉넉한 추정치로 미리 막는다.
 */
export function estimatedCost(purpose: LlmPurpose, model: string): number {
  const est = ESTIMATED_TOKENS[purpose];
  return costOf(model, {
    inputTokens: est.input,
    outputTokens: est.output,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    calls: 1,
  });
}

/**
 * 호출 한 건의 실제 비용은 추정치보다 클 수 있다.
 * 추정치로만 막으면 마지막 호출이 한도를 살짝 넘어간다 — 그래서 추정치의 이 배수만큼
 * 남아 있을 때만 통과시킨다. 한도 근처에서 몇 센트를 남기는 대신 상한이 진짜 상한이 된다.
 */
export const OVERSHOOT_GUARD = 3;

export function canAfford(budget: BudgetStatus, purpose: LlmPurpose, model: string): boolean {
  return estimatedCost(purpose, model) * OVERSHOOT_GUARD <= remainingUsd(budget);
}

/** 너무 촘촘하면 읽을 수가 없다. 너무 뜸하면 "끊임없이" 가 아니다. */
export const MIN_INTERVAL_MS = 12_000;
export const MAX_INTERVAL_MS = 10 * 60_000;

/** 이 아래로는 더 벌리지 않는다 (= 최대 간격에 도달). */
const MIN_PACE = MIN_INTERVAL_MS / MAX_INTERVAL_MS;

/**
 * 대화 간격.
 *
 * "남은 예산을 한 달 벽시계 시간에 펴 바르기" 는 쓰지 않는다 — 그러면 사용자가 30일 내내
 * 지켜본다고 가정하게 되어, 예산이 꽉 차 있을 때도 10분에 한 번씩만 말하게 된다.
 *
 * 대신 두 비율을 견준다.
 *   - 예산이 얼마나 남았나 (remaining / limit)
 *   - 이번 달이 얼마나 남았나 (msLeft / monthLength)
 * 전자가 후자보다 크면 여유가 있다는 뜻이니 읽기 좋은 최소 간격으로 촘촘하게 돌린다.
 * 반대로 예산이 시간보다 빨리 줄고 있으면 그 비율만큼 간격을 벌린다.
 * → 월초에 몰아 쓰는 것도, 예산이 남았는데 뜸해지는 것도 막는다.
 */
export function pacingIntervalMs(params: {
  budget: BudgetStatus;
  /** 한 라운드에 발화하는 감정 수 (평균) */
  speakersPerRound: number;
  ambientModel: string;
  now?: Date;
}): number {
  const { budget, speakersPerRound, ambientModel } = params;
  const now = params.now ?? new Date();

  const perRound = estimatedCost("ambient", ambientModel) * Math.max(1, speakersPerRound);
  const remaining = remainingUsd(budget);

  // 한 라운드도 돌릴 수 없으면 루프를 멈춘다.
  if (perRound <= 0) return MIN_INTERVAL_MS;
  if (remaining < perRound * OVERSHOOT_GUARD) return Number.POSITIVE_INFINITY;

  const budgetLeftRatio = budget.limitUsd > 0 ? remaining / budget.limitUsd : 0;
  const timeLeftRatio = msUntilNextMonth(now) / monthLengthMs(now);

  // 시간이 거의 안 남았으면 남은 예산을 아낄 이유가 없다.
  if (timeLeftRatio <= 0.01) return MIN_INTERVAL_MS;

  const pace = budgetLeftRatio / timeLeftRatio;
  const factor = Math.min(1, Math.max(MIN_PACE, pace));

  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, MIN_INTERVAL_MS / factor));
}

/** 이번 달 전체 길이 (Asia/Seoul 기준). 월초에서 다음 달까지의 거리다. */
export function monthLengthMs(now: Date): number {
  return msUntilNextMonth(new Date(monthStartIso(now)));
}

/** 이번 달이 끝날 때까지 남은 밀리초 (Asia/Seoul 기준). */
export function msUntilNextMonth(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const year = get("year");
  const month = get("month");

  // KST 는 UTC+9, 서머타임이 없다. 다음 달 1일 00:00 KST = 전날 15:00 UTC.
  const nextMonthStartUtc = Date.UTC(
    month === 12 ? year + 1 : year,
    month === 12 ? 0 : month,
    1,
    -9,
  );

  return Math.max(60_000, nextMonthStartUtc - now.getTime());
}

/** 이번 달 1일 00:00 KST 를 ISO 로. 원장 합산의 시작점. */
export function monthStartIso(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return new Date(Date.UTC(get("year"), get("month") - 1, 1, -9)).toISOString();
}

/** 서버 응답을 신뢰하지 않고 정규화한다. */
export function normalizeBudget(raw: unknown, fallbackLimit = 20): BudgetStatus {
  const source = (raw ?? {}) as Record<string, unknown>;
  const num = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;

  return {
    limitUsd: num(source.limitUsd, fallbackLimit),
    spentUsd: num(source.spentUsd, 0),
    calls: num(source.calls, 0),
    since: typeof source.since === "string" ? source.since : monthStartIso(),
    byPurpose: Array.isArray(source.byPurpose)
      ? (source.byPurpose as BudgetStatus["byPurpose"])
      : [],
  };
}
