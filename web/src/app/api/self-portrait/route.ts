import { NextResponse } from "next/server";
import { fail, handleRouteError, UNAUTHORIZED } from "@/lib/api";
import { assertAffordable, BudgetExceededError, recordUsage } from "@/lib/budget-server";
import { readSelfPortrait } from "@/lib/identity";
import { modelFor } from "@/lib/models";
import { requireUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_LENGTH = 4000;

/**
 * 기준 자아 — 사용자가 직접 쓴 자기 소개글을 저장하고, 같은 축으로 환산해 둔다.
 * 환산된 축은 나중에 대화에서 자라난 자아와 대조하는 기준이 된다.
 */
export async function PUT(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    if (!user) return UNAUTHORIZED();

    const body = (await request.json()) as { content?: string };
    const content = body.content?.trim() ?? "";

    if (!content) return fail("자기 소개글을 입력해 주세요.");
    if (content.length > MAX_LENGTH) {
      return fail(`${MAX_LENGTH}자까지 쓸 수 있습니다.`);
    }

    // 축 환산에도 LLM 을 쓰므로 예산을 확인한다.
    const budget = await assertAffordable(supabase, "identity", modelFor("identity"));

    const reading = await readSelfPortrait(content);
    const cost = reading.model
      ? await recordUsage(supabase, {
          userId: user.id,
          purpose: "identity",
          model: reading.model,
          usage: reading.usage,
        })
      : 0;

    const { data, error } = await supabase
      .from("self_portraits")
      .upsert(
        {
          user_id: user.id,
          content,
          axes: reading.axes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      )
      .select()
      .single();

    if (error) return fail(error.message);

    return NextResponse.json({
      portrait: data,
      usage: reading.usage,
      model: reading.model,
      budget: { ...budget, spentUsd: budget.spentUsd + cost, calls: budget.calls + reading.usage.calls },
    });
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      return NextResponse.json(
        { error: error.message, budget: error.budget, budgetExhausted: true },
        { status: 429 },
      );
    }
    return handleRouteError(error);
  }
}
