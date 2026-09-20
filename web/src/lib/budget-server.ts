import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canAfford,
  estimatedCost,
  monthStartIso,
  remainingUsd,
  type BudgetStatus,
} from "@/lib/budget";
import { isLlmPurpose, type LlmPurpose } from "@/lib/models";
import { costOf, formatUsd } from "@/lib/pricing";
import type { TokenUsage } from "@/lib/usage";

/**
 * 예산 상한의 강제 지점.
 *
 * 클라이언트 표시는 거들 뿐이다. 실제 차단은 여기서 일어난다 —
 * LLM 을 부르기 직전에 이번 달 지출을 합산해 보고, 추정 비용이 남은 예산을 넘으면 부르지 않는다.
 */

const DEFAULT_LIMIT_USD = 20;

export function monthlyLimitUsd(): number {
  const raw = Number(process.env.MONTHLY_BUDGET_USD);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_LIMIT_USD;
  return raw;
}

export class BudgetExceededError extends Error {
  constructor(
    readonly budget: BudgetStatus,
    readonly purpose: LlmPurpose,
  ) {
    super(
      `이번 달 예산 ${formatUsd(budget.limitUsd)}을 거의 다 썼습니다. ` +
        `(사용 ${formatUsd(budget.spentUsd)}) 다음 달에 다시 이어집니다.`,
    );
    this.name = "BudgetExceededError";
  }
}

/** 이번 달 지출 현황. DB 함수로 합산한다 (원장 전체를 내려받지 않는다). */
export async function readBudget(supabase: SupabaseClient): Promise<BudgetStatus> {
  const since = monthStartIso();
  const limitUsd = monthlyLimitUsd();

  const [totalResult, byPurposeResult] = await Promise.all([
    supabase.rpc("month_spend", { p_from: since }),
    supabase.rpc("month_spend_by_purpose", { p_from: since }),
  ]);

  if (totalResult.error) {
    // 원장을 못 읽으면 예산을 지킬 수 없다. 통과시키지 않는다.
    throw new Error(
      `예산 원장을 읽지 못했습니다. web/sql/02-identity-and-budget.sql 을 적용했는지 확인해 주세요. (${totalResult.error.message})`,
    );
  }

  // numeric 은 PostgREST 를 거치면 문자열로 온다.
  const head = Array.isArray(totalResult.data) ? totalResult.data[0] : totalResult.data;
  const spentUsd = Number(head?.cost ?? 0);
  const calls = Number(head?.calls ?? 0);

  const byPurpose: BudgetStatus["byPurpose"] = [];
  for (const row of (byPurposeResult.data ?? []) as {
    purpose?: unknown;
    cost?: unknown;
    calls?: unknown;
  }[]) {
    if (!isLlmPurpose(row.purpose)) continue;
    byPurpose.push({
      purpose: row.purpose,
      costUsd: Number(row.cost ?? 0),
      calls: Number(row.calls ?? 0),
    });
  }

  return {
    limitUsd,
    spentUsd: Number.isFinite(spentUsd) ? spentUsd : 0,
    calls: Number.isFinite(calls) ? calls : 0,
    since,
    byPurpose,
  };
}

/**
 * 이 용도의 호출을 시작해도 되는지 확인한다. 안 되면 던진다.
 * 호출부는 이 예외를 잡아 사용자에게 문장으로 전달한다.
 */
export async function assertAffordable(
  supabase: SupabaseClient,
  purpose: LlmPurpose,
  model: string,
): Promise<BudgetStatus> {
  const budget = await readBudget(supabase);
  if (!canAfford(budget, purpose, model)) {
    throw new BudgetExceededError(budget, purpose);
  }
  return budget;
}

/**
 * 호출이 끝난 뒤 실제 사용량을 원장에 남긴다.
 * 기록에 실패해도 사용자 흐름은 막지 않되, 조용히 넘기지 않고 로그를 남긴다
 * — 기록이 빠지면 예산 상한이 느슨해지기 때문이다.
 */
export async function recordUsage(
  supabase: SupabaseClient,
  params: {
    userId: string;
    purpose: LlmPurpose;
    model: string;
    usage: TokenUsage;
  },
): Promise<number> {
  const { userId, purpose, model, usage } = params;
  if (usage.calls <= 0) return 0;

  const cost = costOf(model, usage);

  const { error } = await supabase.from("usage_ledger").insert({
    user_id: userId,
    purpose,
    model,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cache_read_tokens: usage.cacheReadTokens,
    cache_write_tokens: usage.cacheCreationTokens,
    cost_usd: cost.toFixed(6),
  });

  if (error) {
    console.error("usage_ledger insert failed — 예산 집계에서 누락됩니다", error);
  }

  return cost;
}

/** 라운드 도중 예산이 소진되었는지 가볍게 다시 본다 (원장 재조회 없이). */
export function wouldExceed(
  budget: BudgetStatus,
  spentThisRound: number,
  purpose: LlmPurpose,
  model: string,
): boolean {
  const left = remainingUsd(budget) - spentThisRound;
  return estimatedCost(purpose, model) > left;
}
