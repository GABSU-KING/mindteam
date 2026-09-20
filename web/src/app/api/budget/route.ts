import { NextResponse } from "next/server";
import { handleRouteError, UNAUTHORIZED } from "@/lib/api";
import { readBudget } from "@/lib/budget-server";
import { ambientModel, mainModel } from "@/lib/models";
import { requireUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** 이번 달 지출 현황. 화면의 예산 게이지와 대화 간격 계산에 쓰인다. */
export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    if (!user) return UNAUTHORIZED();

    const budget = await readBudget(supabase);

    return NextResponse.json(
      { budget, models: { main: mainModel(), ambient: ambientModel() } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
