import { NextResponse } from "next/server";
import { DEFAULT_SEED, loadActiveAgents } from "@/lib/agents";
import { fail, handleRouteError, UNAUTHORIZED } from "@/lib/api";
import { requireUser } from "@/lib/supabase/server";
import { NEUTRAL_PERSONALITY } from "@/lib/types";

export const runtime = "nodejs";

/**
 * 기본 5개 감정 복구.
 * 정상 흐름에서는 schema.sql 의 on_auth_user_created 트리거가 가입 시점에 넣어 준다.
 * 스키마를 나중에 적용한 계정을 위한 보조 경로다.
 */
export async function POST() {
  try {
    const { supabase, user } = await requireUser();
    if (!user) return UNAUTHORIZED();

    const active = await loadActiveAgents(supabase, user.id);
    if (active.length > 0) {
      return fail("이미 감정들이 함께하고 있습니다.");
    }

    const rows = DEFAULT_SEED.map((seed) => ({
      ...seed,
      user_id: user.id,
      is_seed: true,
      weight: 0.5,
      personality: NEUTRAL_PERSONALITY,
    }));

    const { data, error } = await supabase.from("agents").insert(rows).select();
    if (error) return fail(error.message);

    return NextResponse.json({ agents: data });
  } catch (error) {
    return handleRouteError(error);
  }
}
